import { supabase } from './supabaseClient.js';
import { useStore } from './store.js';
import { applyRemoteChange, catchUpAfterReconnect, registerSyncPendingCheck, autoSaveTick } from './cloud.js';

/* Phase 3 即時同步——傳輸層（V49）：訂閱五表 postgres_changes，事件一律轉交
   cloud.js 的 applyRemoteChange 套用（回聲過濾、store／快照修補都在那邊）。
   本模組只管連線生命週期：登入訂閱／登出退訂／斷線降級／重連追趕。
   前提：五表已加入 supabase_realtime publication＋client_id 欄位（校譯台_Phase3_realtime.sql）。
   RLS 照常把關（只收到自己的列）；DELETE 事件僅帶主鍵。 */

const TABLES = ['folders', 'documents', 'segments', 'terms', 'tm', 'comments'];   // comments 自 V55

let _channel = null;
let _everSubscribed = false;   // 本次登入是否成功同步過（沒同步過＝行為同 V48，不降級）
let _syncPending = false;      // 斷線中：可能漏接別視窗變更 → cloud.js 暫停全量自動存
let _degradeToasted = false;
let _disabled = false;         // 測試後門：假資料庫環境不開真 WebSocket

registerSyncPendingCheck(() => _syncPending);

function subscribe(){
  if(_channel || _disabled || typeof supabase.channel !== 'function') return;
  let ch = supabase.channel('cattool-sync');
  TABLES.forEach(t => {
    ch = ch.on('postgres_changes', { event: '*', schema: 'public', table: t }, (payload) => {
      const row = payload.eventType === 'DELETE' ? payload.old : payload.new;
      applyRemoteChange(t, payload.eventType, row);
    });
  });
  _channel = ch.subscribe((status) => {
    if(status === 'SUBSCRIBED'){
      _degradeToasted = false;
      if(_everSubscribed && _syncPending){
        // 斷線重連：先追趕漏接的變更（衝突時 catchUp 會等使用者作答才 resolve，V64），
        // 追趕完成才清 pending 並補存斷線期間的本機變更；
        // catch 必須在 then 之後——追趕失敗才真的維持 _syncPending，下次重連再試
        catchUpAfterReconnect()
          .then(() => { _syncPending = false; autoSaveTick(); })
          .catch(() => {});
      }else{
        _everSubscribed = true;
        _syncPending = false;
      }
    }else if(status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED'){
      // 從未同步成功（如尚未跑 Phase 3 SQL、離線起站）不降級：行為等同 V48
      if(_everSubscribed && _channel && !_syncPending){
        _syncPending = true;
        if(!_degradeToasted){
          _degradeToasted = true;
          useStore.getState().showToast('雲端同步連線中斷，自動儲存暫停中，重新連上後會自動補存');
        }
      }
    }
  });
}

function unsubscribe(){
  if(!_channel) return;
  const ch = _channel;
  _channel = null;           // 先清再移除：removeChannel 觸發的 CLOSED 不算斷線
  supabase.removeChannel(ch);
  _everSubscribed = false;
  _syncPending = false;
  _degradeToasted = false;
}

/* 登入/登出連動（Realtime 授權由 SDK 隨 session 自動帶上，RLS 才收得到自己的列） */
let _lastToken = null;
function onAuthChange(token){
  if(token === _lastToken) return;
  _lastToken = token;
  token ? subscribe() : unsubscribe();
}
const _unsubStore = useStore.subscribe((s) => onAuthChange(s.auth.token));
onAuthChange(useStore.getState().auth.token);   // 模組載入時可能已登入（INITIAL_SESSION 先到）

/* 測試後門：Puppeteer 環境走假資料庫，不開真 WebSocket；
   setSyncPending 供驗證「斷線暫停全量自動存」 */
export const _test = {
  disable(){ _disabled = true; unsubscribe(); },
  setSyncPending(v){ _syncPending = !!v; },
  state(){ return { subscribed: !!_channel, everSubscribed: _everSubscribed, syncPending: _syncPending }; }
};

// vite dev HMR 換版時收掉連線與訂閱，避免重複
if(import.meta.hot) import.meta.hot.dispose(() => {
  unsubscribe();
  _unsubStore();
});
