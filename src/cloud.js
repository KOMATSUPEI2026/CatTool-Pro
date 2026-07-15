import { supabase } from './supabaseClient.js';
import { useStore } from './store.js';

/* 雲端層（Phase 1＝Supabase 版，行為等價 V45）：Supabase Auth（Google OAuth redirect）＋
   五張表（folders/documents/segments/terms/tm）全量 upsert＋比對刪除消失列＋自動儲存機制。
   V45 的 GIS 1 小時 token 整套防護（搶存/過期橫幅/401 重授權/暫停偵測）已隨 session 自動續期整段移除。
   與畫面相關的狀態（auth/cloudBusy/welcomeVisible/confirmModal）放 store，
   其餘（快照、計時器）留在本模組。所有資料庫請求走 db 物件（測試以假實作整組替換） */

const st = () => useStore.getState();
const toast = (msg) => st().showToast(msg);

/* ---------------- Supabase Auth：Google OAuth redirect 流程 ----------------
   signInWithOAuth 會離開頁面再返回（非 GIS popup）；工作資料靠 Phase 0 persist 不丟。
   session 由 SDK 存 localStorage 並自動續期，返站自動登入 */
const PENDING_SAVE_KEY = 'catToolPendingSave';   // 「先登入再儲存」流程跨 redirect 接力旗標

export function requestGoogleLogin(opts = {}){
  if(opts.pendingSave) sessionStorage.setItem(PENDING_SAVE_KEY, '1');
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + window.location.pathname }
  }).then(({ error }) => {
    if(error){
      sessionStorage.removeItem(PENDING_SAVE_KEY);
      toast('無法開始 Google 登入：' + error.message);
      throw error;
    }
  });
}

/* 登入後續（收歡迎面板＋載入或補存）每次頁面載入只跑一次：
   SIGNED_IN 可能因分頁重新聚焦等原因重複觸發 */
let _loginFlowDone = false;
const { data: { subscription: _authSub } } = supabase.auth.onAuthStateChange((event, session) => {
  if(session){
    st().setAuth({ token: session.access_token, email: session.user?.email || null });
    if(!_loginFlowDone && (event === 'INITIAL_SESSION' || event === 'SIGNED_IN')){
      _loginFlowDone = true;
      st().hideWelcome();
      toast('已登入：' + (session.user?.email || 'Google 帳號'));
      const pendingSave = sessionStorage.getItem(PENDING_SAVE_KEY) === '1';
      sessionStorage.removeItem(PENDING_SAVE_KEY);
      // 官方限制：onAuthStateChange 回呼內不可直接 await Supabase 呼叫（內部鎖會死結），移到下一個 tick
      setTimeout(() => { pendingSave ? saveAllToCloud() : tryAutoLoadFromCloud(); }, 0);
    }
  }else if(event === 'SIGNED_OUT'){
    st().setAuth({ token: null, email: null });
  }
});

export function logoutGoogle(){
  supabase.auth.signOut().then(({ error }) => { if(error) toast('登出失敗：' + error.message); });
  st().setAuth({ token: null, email: null });
  toast('已登出，改以訪客身分使用');
}
export function openLogoutConfirm(){
  st().openConfirm({
    title:'登出 Google',
    text:'登出後回到訪客模式，畫面上的資料保留不動（仍存在此瀏覽器），\n之後的變更不會再自動儲存至雲端。',
    cancelLabel:'取消', okLabel:'確定登出',
    onOk: logoutGoogle,
    wide: true
  });
}

/* ---------------- db：資料庫請求唯一出口（Puppeteer 假雲端整組替換這四個方法） ----------------
   PostgREST 單次回應上限 1000 列，一本書句段可能超過 → 讀取一律分頁撈到短頁為止；
   upsert/delete 分塊：upsert 控制單請求體積、delete 的 in() 走 query string 防網址過長 */
const PAGE_SIZE = 1000;
const CHUNK_UPSERT = 500;
const CHUNK_DELETE = 200;
const _ok = ({ data, error }) => { if(error) throw error; return data; };

async function selectAllRows(table, cols, orderCols){
  let from = 0, all = [];
  for(;;){
    let q = supabase.from(table).select(cols);
    orderCols.forEach(c => { q = q.order(c); });
    const rows = _ok(await q.range(from, from + PAGE_SIZE - 1));
    all = all.concat(rows);
    if(rows.length < PAGE_SIZE) return all;
    from += PAGE_SIZE;
  }
}

export const db = {
  // 五表全量讀取（RLS 只回自己的列）；順序以 position 為準（store 陣列序＝句序/列序的事實來源）
  async fetchTables(){
    const [folders, documents, segments, terms, tm] = await Promise.all([
      selectAllRows('folders',   '*', ['position', 'id']),
      selectAllRows('documents', '*', ['position', 'id']),
      selectAllRows('segments',  '*', ['doc_id', 'position', 'id']),
      selectAllRows('terms',     '*', ['position', 'id']),
      selectAllRows('tm',        '*', ['position', 'id'])
    ]);
    return { folders, documents, segments, terms, tm };
  },
  async selectIds(table){
    const rows = await selectAllRows(table, 'id', ['id']);
    return rows.map(r => r.id);
  },
  async upsert(table, rows){
    for(let i = 0; i < rows.length; i += CHUNK_UPSERT)
      _ok(await supabase.from(table).upsert(rows.slice(i, i + CHUNK_UPSERT), { onConflict: 'id' }));
  },
  async deleteIds(table, ids){
    for(let i = 0; i < ids.length; i += CHUNK_DELETE)
      _ok(await supabase.from(table).delete().in('id', ids.slice(i, i + CHUNK_DELETE)));
  }
};

/* ---------------- store ↔ 資料表映射 ----------------
   store 慣例駝峰（folderId/srcLang/tmId），DB 慣例底線（folder_id/src_lang/tm_id）：
   寫入側以 rowToSnake 統一轉鍵名（不逐表手寫映射）；讀取側逐欄正規化（'' 與 null 的預設同 V45）。
   position＝陣列索引回填：srcNo 存 /1、/2 等 cowork 排版記號，不是排序鍵，句序只認 store 陣列順序 */
const toSnakeKey = (k) => k.replace(/[A-Z]/g, c => '_' + c.toLowerCase());
const rowToSnake = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [toSnakeKey(k), v]));

function serializeForCloud(){
  const { documents, termBase, tmSegments, folders } = st();
  const rows = { folders: [], documents: [], segments: [], terms: [], tm: [] };
  folders.forEach((f, i) => rows.folders.push({ id: f.id, name: f.name, position: i }));
  documents.forEach((d, i) => {
    rows.documents.push(rowToSnake({
      id: d.id, name: d.name, folderId: d.folderId || null,
      srcLang: d.srcLang || '', tgtLang: d.tgtLang || '',
      createdAt: new Date(d.createdAt || Date.now()).toISOString(),
      updatedAt: new Date(d.updatedAt || Date.now()).toISOString(),
      position: i
    }));
    d.segments.forEach((s, j) => rows.segments.push(rowToSnake({
      id: s.id, docId: d.id, position: j,
      srcNo: s.srcNo === null || s.srcNo === undefined || s.srcNo === '' ? null : String(s.srcNo),
      ja: s.ja || '', zh: s.zh || '',
      confirmed: !!s.confirmed, tmId: s.tmId || null
    })));
  });
  termBase.forEach((t, i) => rows.terms.push(rowToSnake({
    id: t.id, ja: t.ja || '', zh: t.zh || '', note: t.note || '', source: t.source || '',
    srcLang: t.srcLang || '', tgtLang: t.tgtLang || '', position: i
  })));
  tmSegments.forEach((t, i) => rows.tm.push(rowToSnake({
    id: t.id, ja: t.ja || '', zh: t.zh || '', source: t.source || '',
    srcLang: t.srcLang || '', tgtLang: t.tgtLang || '', position: i
  })));
  return rows;
}

/* 讀取側：DB 列 → store 形狀（segments 依 doc_id 掛回 documents；欄位正規化同 V45 讀 Sheets） */
function segRowToStore(r){
  return {
    id: r.id,
    srcNo: r.src_no === null || r.src_no === '' ? null
         : (isNaN(Number(r.src_no)) ? r.src_no : Number(r.src_no)),
    ja: r.ja || '', zh: r.zh || '',
    confirmed: !!r.confirmed,
    tmId: r.tm_id || null
  };
}
async function fetchAllFromCloud(){
  const t = await db.fetchTables();
  const segsByDoc = new Map();
  t.segments.forEach(r => {
    if(!segsByDoc.has(r.doc_id)) segsByDoc.set(r.doc_id, []);
    segsByDoc.get(r.doc_id).push(segRowToStore(r));
  });
  return {
    folders: t.folders.map(r => ({ id: r.id, name: r.name })),
    documents: t.documents.map(r => ({
      id: r.id, name: r.name, folderId: r.folder_id || null,
      srcLang: r.src_lang || '', tgtLang: r.tgt_lang || '',
      createdAt: Date.parse(r.created_at) || Date.now(),
      updatedAt: Date.parse(r.updated_at) || Date.now(),
      segments: segsByDoc.get(r.id) || []
    })),
    termBase: t.terms.map(r => ({
      id: r.id, ja: r.ja || '', zh: r.zh || '', note: r.note || '', source: r.source || '',
      srcLang: r.src_lang || '', tgtLang: r.tgt_lang || ''
    })),
    tmSegments: t.tm.map(r => ({
      id: r.id, ja: r.ja || '', zh: r.zh || '', source: r.source || '',
      srcLang: r.src_lang || '', tgtLang: r.tgt_lang || ''
    }))
  };
}

/* ---------------- 儲存：全量 upsert＋比對刪除消失列（Phase 1 維持「一鍵全存」語意） ----------------
   不用 delete-all＋insert：Phase 2 的 segment_history 掛在 segments 外鍵 cascade 上，
   整刪重建會把歷史一併炸掉，故一開始就用 upsert 語意 */
export async function saveAllToCloud(opts = {}){
  if(st().cloudBusy){ if(!opts.auto) toast('儲存進行中，請稍候…'); return; }
  if(!st().auth.token){
    if(opts.auto) return;   // 訪客不打擾（自動儲存守門，同 V45）
    st().openConfirm({
      title:'尚未登入',
      text:'儲存至雲端前，請先登入 Google 帳號。\n登入會離開再返回本頁（資料已保存在本機，不會遺失），\n返回後會自動完成這次儲存。',
      cancelLabel:'取消', okLabel:'立即登入',
      onOk: () => { requestGoogleLogin({ pendingSave: true }).catch(() => {}); },
      wide: true
    });
    return;
  }
  useStore.setState({ cloudBusy: true });
  try{
    const snapAtStart = cloudSnapshot();   // 儲存期間若又打字，快照對不上=仍視為未儲存
    const rows = serializeForCloud();
    const TABLES = ['folders', 'documents', 'segments', 'terms', 'tm'];
    const existing = {};
    await Promise.all(TABLES.map(async t => { existing[t] = await db.selectIds(t); }));

    // upsert 順序守外鍵：folders → documents → segments；terms/tm 無依賴
    for(const t of TABLES) await db.upsert(t, rows[t]);

    // 刪除消失列：documents 先刪（cascade 帶走其句段；已 cascade 的 id 再刪一次是無害空操作）
    const missing = (t) => {
      const keep = new Set(rows[t].map(r => r.id));
      return existing[t].filter(id => !keep.has(id));
    };
    for(const t of ['documents', 'segments', 'folders', 'terms', 'tm'])
      await db.deleteIds(t, missing(t));

    _lastCloudSnapshot = snapAtStart;
    const { documents, termBase, tmSegments } = st();
    const now = new Date();
    const hhmm = String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0');
    toast(`${opts.auto ? '已自動儲存至雲端' : '已儲存至雲端'}（${documents.length} 份文件、${termBase.length} 條術語、${tmSegments.length} 句記憶｜${hhmm}）`);
  }catch(err){
    toast('儲存失敗：' + (err.message || String(err)));
  }finally{
    useStore.setState({ cloudBusy: false });
  }
}

/* ---------------- 載入：登入後自動比對雲端與本機 ----------------
   Phase 0 persist 後本機是首載前的資料源，返站每次都彈「覆蓋確認」會變騷擾，
   故先撈雲端做內容比對：一致→靜默視為已同步；本機空→直接載入；不一致→才彈確認（同 V45 防覆蓋精神）。
   比對用欄位投影（排除 createdAt/updatedAt 與物件鍵序差異），本機缺欄（如 srcNo）不誤判 */
function canonSnapshot(data){
  return JSON.stringify({
    folders: data.folders.map(f => [f.id, f.name]),
    documents: data.documents.map(d => [d.id, d.name, d.folderId || '', d.srcLang || '', d.tgtLang || '',
      d.segments.map(s => [s.id, s.srcNo === null || s.srcNo === undefined ? '' : String(s.srcNo),
                           s.ja || '', s.zh || '', !!s.confirmed, s.tmId || ''])]),
    terms: data.termBase.map(t => [t.id, t.ja || '', t.zh || '', t.note || '', t.source || '', t.srcLang || '', t.tgtLang || '']),
    tm: data.tmSegments.map(t => [t.id, t.ja || '', t.zh || '', t.source || '', t.srcLang || '', t.tgtLang || ''])
  });
}

/* 覆蓋 store 資料並重置各區選取狀態（React 由訂閱自動重繪） */
function applyCloudData(next){
  useStore.setState({
    documents: next.documents,
    termBase: next.termBase,
    tmSegments: next.tmSegments,
    folders: next.folders,
    currentDocId: null,
    lastFocusedSegId: null,
    collapsedFolders: new Set(),
    termTip: null,
    srUndoSnapshot: null,      // 復原快照對的是載入前的句段，覆蓋後一律作廢
    currentTab: 'projects'     // 載入完成直接帶到專案區看見文件清單
  });
  _lastCloudSnapshot = cloudSnapshot();   // 剛載入＝與雲端同步
}

export async function tryAutoLoadFromCloud(){
  try{
    const next = await fetchAllFromCloud();
    const s = st();
    const local = { documents: s.documents, termBase: s.termBase, tmSegments: s.tmSegments, folders: s.folders };
    const cloudHas = next.documents.length || next.termBase.length || next.tmSegments.length || next.folders.length;
    const localHas = local.documents.length || local.termBase.length || local.tmSegments.length || local.folders.length;
    if(!cloudHas) return;   // 雲端全空（首次使用）：沿用本機，等第一次儲存
    if(canonSnapshot(local) === canonSnapshot(next)){
      _lastCloudSnapshot = cloudSnapshot();   // 內容一致：靜默標記已同步，不動畫面
      return;
    }
    const doLoad = async () => {
      // 確認 Modal 可能停留一陣子，套用前重撈一次，避免用到過時資料
      const fresh = await fetchAllFromCloud();
      applyCloudData(fresh);
      toast(`已從雲端載入 ${fresh.documents.length} 份文件、${fresh.termBase.length} 條術語、${fresh.tmSegments.length} 句記憶`);
    };
    if(!localHas){ await doLoad(); return; }
    st().openConfirm({
      title:'載入雲端資料',
      text:'雲端資料與本機不同。\n載入雲端會覆蓋目前畫面上的所有內容；\n若要以本機為準，請選「保留本機資料」後按「儲存至雲端」回寫。',
      cancelLabel:'保留本機資料', okLabel:'載入雲端（覆蓋本機）',
      onOk: () => { doLoad().catch(err => toast('雲端載入失敗：' + (err.message || String(err)))); },
      wide: true
    });
  }catch(err){
    toast('雲端載入失敗：' + (err.message || String(err)));
  }
}

/* ---------------- 雲端自動儲存與關頁守門：以資料快照比對偵測未儲存變更 ----------------
   Supabase 無 Sheets 的每分鐘配額，debounce 不再是被逼的，但 Phase 1 求最小改動原樣保留；
   Phase 2 改逐句即存後再精簡 */
const AUTO_SAVE_MS = 20 * 60 * 1000;   // 20 分鐘保底
function cloudSnapshot(){
  const { documents, termBase, tmSegments, folders } = st();
  return JSON.stringify({documents, termBase, tmSegments, folders});
}
let _lastCloudSnapshot = cloudSnapshot();   // 初始＝載入當下的本機狀態
export function hasUnsavedChanges(){ return cloudSnapshot() !== _lastCloudSnapshot; }

export function autoSaveTick(){
  if(!hasUnsavedChanges()) return;
  if(!st().auth.token) return;   // 訪客不打擾
  saveAllToCloud({auto:true});
}

/* 閒置自動存（debounce）：改動後停手 3 分鐘即上傳；20 分鐘定時為保底 */
const IDLE_SAVE_MS = 3 * 60 * 1000;
const IDLE_POLL_MS = 30 * 1000;
let _lastSeenSnapshot = _lastCloudSnapshot;
let _lastChangeAt = 0;
export function idleSaveCheck(){
  const snap = cloudSnapshot();
  if(snap !== _lastSeenSnapshot){          // 還在改動：重新起算閒置時間
    _lastSeenSnapshot = snap;
    _lastChangeAt = Date.now();
    return;
  }
  if(!hasUnsavedChanges()) return;
  if(_lastChangeAt && Date.now() - _lastChangeAt >= IDLE_SAVE_MS) autoSaveTick();   // 共用訪客守門
}

const _timers = [setInterval(autoSaveTick, AUTO_SAVE_MS), setInterval(idleSaveCheck, IDLE_POLL_MS)];
function _beforeUnload(e){
  if(!hasUnsavedChanges()) return;
  e.preventDefault();
  e.returnValue = '';   // 需設值 Chrome 才顯示原生「確定離開？」
}
window.addEventListener('beforeunload', _beforeUnload);
// vite dev HMR 換版時清掉舊計時器/監聽/auth 訂閱，避免重複註冊
if(import.meta.hot) import.meta.hot.dispose(() => {
  _timers.forEach(clearInterval);
  window.removeEventListener('beforeunload', _beforeUnload);
  _authSub?.unsubscribe();
});

/* 句段整理五功能送出後即時存雲端（已登入才觸發；訪客沿用手動儲存流程） */
export function autoSaveAfterSegTool(){
  if(st().auth.token) saveAllToCloud({auto:true});
}

/* 測試後門：Puppeteer 驗收需撥快「最後改動時間」模擬閒置（同 vanilla 直接改全域變數） */
export const _test = {
  setLastChangeAt(ts){ _lastChangeAt = ts; }
};
