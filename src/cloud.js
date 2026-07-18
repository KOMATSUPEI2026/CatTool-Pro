import { supabase } from './supabaseClient.js';
import { useStore } from './store.js';

/* 雲端層（Phase 2＝逐句即存版）：Supabase Auth（Google OAuth redirect）＋
   五張表（folders/documents/segments/terms/tm）全量 upsert＋比對刪除消失列＋自動儲存機制，
   V48 起 Tab 確認逐句即存（saveSegmentNow）＋segment_history 單句歷史（DB trigger 寫、前端只讀）。
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
    text:'登出後回到訪客模式，瀏覽器上的資料保留\n之後的變更不會再自動儲存至雲端',
    cancelLabel:'取消登出', okLabel:'確定登出',
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
  },
  // Phase 2：單句歷史（segment_history 由 DB trigger 寫入，前端只讀）；每句最多 5 筆
  async fetchSegHistory(segmentId){
    return _ok(await supabase.from('segment_history')
      .select('id, zh, saved_at')
      .eq('segment_id', segmentId)
      .order('saved_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(5));
  },
  // V54：使用者偏好（user_prefs 一人一列 jsonb；RLS 只見自己的列）；無列回 null
  async fetchPrefs(){
    const rows = _ok(await supabase.from('user_prefs').select('prefs').limit(1));
    return rows.length ? rows[0].prefs : null;
  },
  async upsertPrefs(prefs){
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id;
    if(!uid) return;   // 訪客/登出瞬間：偏好留在 localStorage 即可
    _ok(await supabase.from('user_prefs')
      .upsert({ user_id: uid, prefs, updated_at: new Date().toISOString() }, { onConflict: 'user_id' }));
  }
};

/* ---------------- store ↔ 資料表映射 ----------------
   store 慣例駝峰（folderId/srcLang/tmId），DB 慣例底線（folder_id/src_lang/tm_id）：
   寫入側以 rowToSnake 統一轉鍵名（不逐表手寫映射）；讀取側逐欄正規化（'' 與 null 的預設同 V45）。
   position＝陣列索引回填：srcNo 存 /1、/2 等 cowork 排版記號，不是排序鍵，句序只認 store 陣列順序 */
const toSnakeKey = (k) => k.replace(/[A-Z]/g, c => '_' + c.toLowerCase());
const rowToSnake = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [toSnakeKey(k), v]));

/* Phase 3：本視窗識別碼——每列寫入都帶上，Realtime 收到事件時據此忽略「自己寫入的回聲」
   （不忽略的話：本機打字比回聲新時，套用回聲會把譯文倒退回舊值） */
export const CLIENT_ID = crypto.randomUUID();

/* 單列組裝（全量儲存與逐句即存共用，欄位口徑一致；client_id 在此統一注入） */
const docRow = (d, i) => rowToSnake({
  clientId: CLIENT_ID,
  id: d.id, name: d.name, folderId: d.folderId || null,
  srcLang: d.srcLang || '', tgtLang: d.tgtLang || '',
  createdAt: new Date(d.createdAt || Date.now()).toISOString(),
  updatedAt: new Date(d.updatedAt || Date.now()).toISOString(),
  position: i
});
const segRow = (s, docId, j) => rowToSnake({
  clientId: CLIENT_ID,
  id: s.id, docId, position: j,
  srcNo: s.srcNo === null || s.srcNo === undefined || s.srcNo === '' ? null : String(s.srcNo),
  ja: s.ja || '', zh: s.zh || '',
  confirmed: !!s.confirmed, reviewed: !!s.reviewed, tmId: s.tmId || null
});
const tmRow = (t, i) => rowToSnake({
  clientId: CLIENT_ID,
  id: t.id, ja: t.ja || '', zh: t.zh || '', source: t.source || '',
  srcLang: t.srcLang || '', tgtLang: t.tgtLang || '', position: i
});

function serializeForCloud(){
  const { documents, termBase, tmSegments, folders } = st();
  const rows = { folders: [], documents: [], segments: [], terms: [], tm: [] };
  folders.forEach((f, i) => rows.folders.push({ id: f.id, name: f.name, position: i, client_id: CLIENT_ID }));
  documents.forEach((d, i) => {
    rows.documents.push(docRow(d, i));
    d.segments.forEach((s, j) => rows.segments.push(segRow(s, d.id, j)));
  });
  termBase.forEach((t, i) => rows.terms.push(rowToSnake({
    clientId: CLIENT_ID,
    id: t.id, ja: t.ja || '', zh: t.zh || '', note: t.note || '', source: t.source || '',
    srcLang: t.srcLang || '', tgtLang: t.tgtLang || '', tag: t.tag || '', position: i
  })));
  tmSegments.forEach((t, i) => rows.tm.push(tmRow(t, i)));
  return rows;
}

/* 讀取側：DB 列 → store 形狀（segments 依 doc_id 掛回 documents；欄位正規化同 V45 讀 Sheets）
   逐表轉換器抽出共用——全量載入與 Realtime 單列套用（applyRemoteChange）用同一把尺 */
function segRowToStore(r){
  return {
    id: r.id,
    srcNo: r.src_no === null || r.src_no === '' ? null
         : (isNaN(Number(r.src_no)) ? r.src_no : Number(r.src_no)),
    ja: r.ja || '', zh: r.zh || '',
    confirmed: !!r.confirmed,
    reviewed: !!r.reviewed,
    tmId: r.tm_id || null
  };
}
function docRowToStore(r){   // 不含 segments，由呼叫端掛
  return {
    id: r.id, name: r.name, folderId: r.folder_id || null,
    srcLang: r.src_lang || '', tgtLang: r.tgt_lang || '',
    createdAt: Date.parse(r.created_at) || Date.now(),
    updatedAt: Date.parse(r.updated_at) || Date.now()
  };
}
function termRowToStore(r){
  return {
    id: r.id, ja: r.ja || '', zh: r.zh || '', note: r.note || '', source: r.source || '',
    srcLang: r.src_lang || '', tgtLang: r.tgt_lang || '', tag: r.tag || ''   // V54：標籤（舊列缺欄視為空）
  };
}
function tmRowToStore(r){
  return {
    id: r.id, ja: r.ja || '', zh: r.zh || '', source: r.source || '',
    srcLang: r.src_lang || '', tgtLang: r.tgt_lang || ''
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
    documents: t.documents.map(r => ({ ...docRowToStore(r), segments: segsByDoc.get(r.id) || [] })),
    termBase: t.terms.map(termRowToStore),
    tmSegments: t.tm.map(tmRowToStore)
  };
}

/* ---------------- 儲存：全量 upsert＋比對刪除消失列（Phase 1 維持「一鍵全存」語意） ----------------
   不用 delete-all＋insert：Phase 2 的 segment_history 掛在 segments 外鍵 cascade 上，
   整刪重建會把歷史一併炸掉，故一開始就用 upsert 語意 */
export async function saveAllToCloud(opts = {}){
  if(opts.auto && _syncPendingCheck()) return;   // 同步斷線中：暫停全量自動存防舊蓋新，重連追趕後補存
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
    useStore.setState(s => ({ cloudFlashSeq: s.cloudFlashSeq + 1 }));   // 雲端鈕短暫轉實心雲
  }catch(err){
    toast('儲存失敗：' + (err.message || String(err)));
  }finally{
    useStore.setState({ cloudBusy: false });
  }
}

/* ---------------- Phase 2 逐句即存：Tab 確認當下即存該句 ----------------
   範圍＝該句段列＋所屬文件列（updatedAt）＋確認產生/覆寫的 TM 列，各一筆 upsert；
   雲端 trigger 只在「被覆蓋的舊值是已確認版本」時把舊譯文推進 segment_history（每句留 5 筆）。
   訪客與全量儲存進行中一律靜默跳過（閒置/保底全量機制會補）；
   文件或資料夾還沒上過雲端（FK 23503）表示單列補不齊，改觸發一次全量自動儲存 */
export async function saveSegmentNow(segId){
  const s = st();
  if(!s.auth.token || s.cloudBusy) return;
  const doc = s.documents.find(d => d.segments.some(x => x.id === segId));
  if(!doc) return;
  const docIdx = s.documents.indexOf(doc);
  const segIdx = doc.segments.findIndex(x => x.id === segId);
  const seg = doc.segments[segIdx];
  const tmIdx = seg.tmId ? s.tmSegments.findIndex(t => t.id === seg.tmId) : -1;
  try{
    await db.upsert('documents', [docRow(doc, docIdx)]);   // 先文件後句段，守外鍵
    await db.upsert('segments', [segRow(seg, doc.id, segIdx)]);
    if(tmIdx >= 0) await db.upsert('tm', [tmRow(s.tmSegments[tmIdx], tmIdx)]);
    patchSnapshotAfterSegSave(doc.id, segId, tmIdx >= 0 ? s.tmSegments[tmIdx].id : null);
  }catch(err){
    if(err && err.code === '23503'){ saveAllToCloud({ auto: true }); return; }
    toast('句段即時儲存失敗：' + (err.message || String(err)));
  }
}

/* 即存成功後把「已同步快照」修補到與雲端一致：只回填這次真的上傳的三列
   （文件 updatedAt、該句段、該 TM 列）。若期間還有其他未儲存變動，快照仍對不上
   ＝維持未同步狀態，交給閒置/保底全量儲存，不會誤判已存 */
function patchSnapshotAfterSegSave(docId, segId, tmId){
  try{
    const snap = JSON.parse(_lastCloudSnapshot);
    const s = st();
    const doc = s.documents.find(d => d.id === docId);
    const sd = snap.documents.find(d => d.id === docId);
    if(!doc || !sd) return;   // 快照裡沒這份文件（如剛全量儲存前建立）：維持未同步
    sd.updatedAt = doc.updatedAt;
    const segIdx = doc.segments.findIndex(x => x.id === segId);
    const i = sd.segments.findIndex(x => x.id === segId);
    if(i >= 0) sd.segments[i] = doc.segments[segIdx];
    else if(segIdx === sd.segments.length) sd.segments.push(doc.segments[segIdx]);
    if(tmId){
      const tmIdx = s.tmSegments.findIndex(t => t.id === tmId);
      const k = snap.tmSegments.findIndex(t => t.id === tmId);
      if(k >= 0) snap.tmSegments[k] = s.tmSegments[tmIdx];
      else if(tmIdx === snap.tmSegments.length) snap.tmSegments.push(s.tmSegments[tmIdx]);
    }
    _lastCloudSnapshot = JSON.stringify(snap);
  }catch(e){ /* 快照修補失敗只影響「是否再多存一次」，不影響資料正確性 */ }
}

/* 歷史側欄查詢：回傳 [{id, zh, saved_at}]，新→舊 */
export function fetchSegHistory(segId){
  return db.fetchSegHistory(segId);
}

/* ---------------- Phase 3 即時同步：遠端變更套用層 ----------------
   realtime.js（傳輸層）收到 postgres_changes 事件後呼叫 applyRemoteChange，
   本模組負責把單列變更套進 store 與「已同步快照」（遠端變更＝雲端現狀，
   不同步修補快照的話，本視窗會把別視窗的變更誤判成自己的未儲存變更）。
   衝突規則＝最後寫入者贏（單人多視窗；已確認版本有 segment_history 兜底）。
   刪除級聯不在前端重做：FK cascade / set null 由 Postgres 對受影響列另發事件 */

// 對 store 形狀的資料集套用單列變更；回傳有變動的欄位 patch（無事可做回 null）
function applyOpToDataset(ds, table, eventType, row){
  const isDel = eventType === 'DELETE';
  const upsertAt = (arr, item, pos) => {
    const i = arr.findIndex(x => x.id === item.id);
    const next = [...arr];
    if(i >= 0) next[i] = item;
    else next.splice(Math.min(pos ?? next.length, next.length), 0, item);
    return next;
  };
  if(table === 'folders'){
    if(isDel) return ds.folders.some(f => f.id === row.id)
      ? { folders: ds.folders.filter(f => f.id !== row.id) } : null;
    return { folders: upsertAt(ds.folders, { id: row.id, name: row.name }, row.position) };
  }
  if(table === 'documents'){
    if(isDel) return ds.documents.some(d => d.id === row.id)
      ? { documents: ds.documents.filter(d => d.id !== row.id) } : null;
    const old = ds.documents.find(d => d.id === row.id);
    const item = { ...docRowToStore(row), segments: old ? old.segments : [] };
    return { documents: upsertAt(ds.documents, item, row.position) };
  }
  if(table === 'segments'){
    if(isDel){   // DELETE 事件只帶主鍵，逐文件找
      const doc = ds.documents.find(d => d.segments.some(x => x.id === row.id));
      if(!doc) return null;
      return { documents: ds.documents.map(d => d.id !== doc.id
        ? d : { ...d, segments: d.segments.filter(x => x.id !== row.id) }) };
    }
    const doc = ds.documents.find(d => d.id === row.doc_id);
    if(!doc) return null;   // 文件事件未到（正常寫入順序不會發生）：略過，交給重連追趕
    return { documents: ds.documents.map(d => d.id !== doc.id
      ? d : { ...d, segments: upsertAt(d.segments, segRowToStore(row), row.position) }) };
  }
  if(table === 'terms'){
    if(isDel) return ds.termBase.some(t => t.id === row.id)
      ? { termBase: ds.termBase.filter(t => t.id !== row.id) } : null;
    return { termBase: upsertAt(ds.termBase, termRowToStore(row), row.position) };
  }
  if(table === 'tm'){
    if(isDel) return ds.tmSegments.some(t => t.id === row.id)
      ? { tmSegments: ds.tmSegments.filter(t => t.id !== row.id) } : null;
    return { tmSegments: upsertAt(ds.tmSegments, tmRowToStore(row), row.position) };
  }
  return null;
}

export function applyRemoteChange(table, eventType, row){
  if(!row || !row.id) return;
  if(eventType !== 'DELETE' && row.client_id === CLIENT_ID) return;   // 自己寫入的回聲
  const s = st();
  const patch = applyOpToDataset(
    { documents: s.documents, termBase: s.termBase, tmSegments: s.tmSegments, folders: s.folders },
    table, eventType, row);
  if(patch){
    // 開啟中的文件被別視窗刪除：退回未開檔狀態（工作區顯示空狀態）
    if(table === 'documents' && eventType === 'DELETE' && s.currentDocId === row.id){
      patch.currentDocId = null;
      patch.lastFocusedSegId = null;
    }
    if(s.srUndoSnapshot && (table === 'documents' || table === 'segments'))
      patch.srUndoSnapshot = null;   // 取代復原快照對的是變更前句段，遠端一動一律作廢
    useStore.setState(patch);
  }
  // 快照同樣套用（即使 store 無變化也套：快照可能落後一步）
  try{
    const snap = JSON.parse(_lastCloudSnapshot);
    const snapPatch = applyOpToDataset(snap, table, eventType, row);
    if(snapPatch) _lastCloudSnapshot = JSON.stringify({ ...snap, ...snapPatch });
  }catch(e){ /* 快照修補失敗只影響「是否再多存一次」 */ }
}

/* 就地套用整份雲端資料（斷線追趕用）：不像 applyCloudData 會重置選取並跳分頁，
   停留在目前畫面、開啟中的文件還在就不動 */
function applyCloudDataInPlace(next){
  useStore.setState(s => ({
    documents: next.documents,
    termBase: next.termBase,
    tmSegments: next.tmSegments,
    folders: next.folders,
    currentDocId: next.documents.some(d => d.id === s.currentDocId) ? s.currentDocId : null,
    srUndoSnapshot: null,
    termTip: null
  }));
  _lastCloudSnapshot = cloudSnapshot();
}

/* 斷線重連追趕：比對「現在的雲端」vs「最後已知的雲端」（不是 vs 本機——
   離線期間只有本機在改時，雲端沒動＝沒漏接，不該彈任何確認）。
   雲端動了且本機乾淨→無感套用；兩邊都動→才彈衝突確認 */
export async function catchUpAfterReconnect(){
  const next = await fetchAllFromCloud();
  const lastKnown = JSON.parse(_lastCloudSnapshot);
  if(canonSnapshot(next) === canonSnapshot(lastKnown)) return;   // 斷線期間雲端沒動
  if(!hasUnsavedChanges()){
    applyCloudDataInPlace(next);
    toast('已同步其他視窗／裝置的變更');
    return;
  }
  st().openConfirm({
    title:'雲端資料已變更',
    text:'連線中斷期間，雲端（其他視窗或裝置）與本機都有變更。\n載入雲端會覆蓋本機未儲存的修改；\n保留本機則之後儲存會以本機為準回寫。',
    cancelLabel:'保留本機', okLabel:'載入雲端（覆蓋本機）',
    onOk: () => {
      fetchAllFromCloud().then(applyCloudDataInPlace)
        .catch(err => toast('雲端載入失敗：' + (err.message || String(err))));
    },
    wide: true
  });
}

/* realtime.js 註冊「同步斷線中」查詢：斷線期間本視窗可能漏接別視窗的變更，
   全量自動儲存會拿舊資料蓋掉雲端＝暫停（手動儲存與逐句即存照常，使用者明確動作） */
let _syncPendingCheck = () => false;
export function registerSyncPendingCheck(fn){ _syncPendingCheck = fn; }

/* ---------------- 載入：登入後自動比對雲端與本機 ----------------
   Phase 0 persist 後本機是首載前的資料源，返站每次都彈「覆蓋確認」會變騷擾，
   故先撈雲端做內容比對：一致→靜默視為已同步；本機空→直接載入；不一致→才彈確認（同 V45 防覆蓋精神）。
   比對用欄位投影（排除 createdAt/updatedAt 與物件鍵序差異），本機缺欄（如 srcNo）不誤判 */
function canonSnapshot(data){
  return JSON.stringify({
    folders: data.folders.map(f => [f.id, f.name]),
    documents: data.documents.map(d => [d.id, d.name, d.folderId || '', d.srcLang || '', d.tgtLang || '',
      d.segments.map(s => [s.id, s.srcNo === null || s.srcNo === undefined ? '' : String(s.srcNo),
                           s.ja || '', s.zh || '', !!s.confirmed, !!s.reviewed, s.tmId || ''])]),
    terms: data.termBase.map(t => [t.id, t.ja || '', t.zh || '', t.note || '', t.source || '', t.srcLang || '', t.tgtLang || '', t.tag || '']),
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

/* ---------------- V54 使用者偏好同步（user_prefs 單列 jsonb） ----------------
   低風險資料走「最後寫入者贏」：prefs.updatedAt 比大小對時，不彈確認、不掛 Realtime。
   上傳＝訂閱 store 的 prefs 參照變化（debounce 2 秒）；剛從雲端套用的那次以時間戳擋回聲 */
const PREFS_SAVE_MS = 2000;
let _prefsSaveTimer = null;
let _lastSyncedPrefsAt = -1;
function schedulePrefsSave(){
  if(!st().auth.token) return;   // 訪客：localStorage 已落地，登入時再對時上雲
  clearTimeout(_prefsSaveTimer);
  _prefsSaveTimer = setTimeout(() => {
    const prefs = st().prefs;
    _lastSyncedPrefsAt = prefs.updatedAt || 0;
    db.upsertPrefs(prefs).catch(() => { /* 偏好非關鍵資料：失敗靜默，下次變更再試 */ });
  }, PREFS_SAVE_MS);
}
let _prevPrefsRef = st().prefs;
const _prefsUnsub = useStore.subscribe((s) => {
  if(s.prefs === _prevPrefsRef) return;
  _prevPrefsRef = s.prefs;
  if((s.prefs.updatedAt || 0) === _lastSyncedPrefsAt) return;   // setPrefsFromCloud 的回聲
  schedulePrefsSave();
});
async function syncPrefsWithCloud(){
  try{
    const cloud = await db.fetchPrefs();
    const local = st().prefs;
    if(cloud && (cloud.updatedAt || 0) >= (local.updatedAt || 0)){
      _lastSyncedPrefsAt = cloud.updatedAt || 0;
      st().setPrefsFromCloud(cloud);
    } else {
      _lastSyncedPrefsAt = local.updatedAt || 0;
      await db.upsertPrefs(local);   // 雲端無列或較舊：以本機回寫
    }
  }catch(e){ /* user_prefs 表未建等情況：偏好退回純本機，不擋工作資料載入 */ }
}

export async function tryAutoLoadFromCloud(){
  syncPrefsWithCloud();   // 偏好與五表載入互不阻擋（各自 try/catch）
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
      text:'雲端資料與本機不符！\n載入雲端資料：載入後會覆蓋目本機內容\n保留本機資料：保留後需按「儲存至雲端」覆寫',
      cancelLabel:'保留本機資料', okLabel:'載入雲端資料',
      onOk: () => { doLoad().catch(err => toast('雲端載入失敗：' + (err.message || String(err)))); },
      wide: true
    });
  }catch(err){
    toast('雲端載入失敗：' + (err.message || String(err)));
  }
}

/* ---------------- 雲端自動儲存與關頁守門：以資料快照比對偵測未儲存變更 ----------------
   V48 定案全數保留為保底：逐句即存只涵蓋 Tab 確認的句段，
   未確認草稿、術語/TM/資料夾/句段整理等其餘變動仍靠這裡上雲 */
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
  clearTimeout(_prefsSaveTimer);
  _prefsUnsub();
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
