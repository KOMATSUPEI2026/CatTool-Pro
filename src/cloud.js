import axios from 'axios';
import { useStore } from './store.js';

/* 雲端層：Google 授權（GIS popup token 流程）＋ Sheets 三表全量覆寫讀寫＋自動儲存三機制。
   自 vanilla 版原樣搬遷；與畫面相關的狀態（auth/cloudBusy/welcomeVisible/confirmModal）放 store，
   其餘（快照、計時器、token client）留在本模組。access token 約 1 小時失效；
   Sheets 讀寫一律走 sheetsApi，401 自動重授權後重試 */

const st = () => useStore.getState();
const toast = (msg) => st().showToast(msg);

/* ---------------- Google 授權 ---------------- */
const GOOGLE_CLIENT_ID = '686110770281-h5n162o95vvbf5hcuihb7n89ef46cuok.apps.googleusercontent.com';
const GOOGLE_SCOPES = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.email';
let _tokenClient = null;
let _authWaiters = [];
let _skipAutoLoadOnce = false;   // 401 重授權/儲存前登入時，不觸發登入後自動載入

function _settleAuthWaiters(ok){
  _authWaiters.forEach(w => ok ? w.resolve() : w.reject(new Error('auth-failed')));
  _authWaiters = [];
}
function initTokenClient(){
  if(_tokenClient || !window.google?.accounts?.oauth2) return;
  _tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: GOOGLE_SCOPES,
    callback: async (resp) => {
      if(resp.error){
        toast('Google 授權失敗：' + resp.error);
        _settleAuthWaiters(false);
        return;
      }
      st().setAuth({
        token: resp.access_token,
        expiresAt: Date.now() + Math.max(0, resp.expires_in - 60) * 1000
      });
      // 拿到新 token＝授權週期重新起算：收掉過期橫幅、重置搶存/過期提示的一次性旗標
      st().setAuthExpiredPause(false);
      _preExpirySaved = false;
      _expiredNoticeShown = false;
      await fetchGoogleEmail();
      st().hideWelcome();
      const email = st().auth.email;
      toast(email ? '已登入：' + email : 'Google 帳號已連結');
      _settleAuthWaiters(true);
      if(!_skipAutoLoadOnce) tryAutoLoadFromCloud();
      _skipAutoLoadOnce = false;
    },
    error_callback: (err) => {
      toast('無法完成 Google 授權：' + (err.type || err.message || '未知錯誤'));
      _settleAuthWaiters(false);
    }
  });
}
export function requestGoogleLogin(opts = {}){
  _skipAutoLoadOnce = !!opts.skipAutoLoad;
  initTokenClient();
  if(!_tokenClient){
    toast('Google 登入元件尚未載入，請確認網路後再試');
    return Promise.reject(new Error('gis-not-loaded'));
  }
  const p = new Promise((resolve, reject) => _authWaiters.push({resolve, reject}));
  _tokenClient.requestAccessToken();
  return p;
}
async function fetchGoogleEmail(){
  try{
    const r = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo',
      { headers:{ Authorization:'Bearer ' + st().auth.token } });
    st().setAuth({ email: r.data.email || null });
  }catch(_){ st().setAuth({ email: null }); }   // 拿不到 email 不影響授權本身
}
export function logoutGoogle(){
  const token = st().auth.token;
  if(token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token);
  st().setAuth({ token: null, email: null, expiresAt: 0 });
  st().setAuthExpiredPause(false);   // 回訪客模式：過期橫幅失去意義，一併收掉
  toast('已登出 Google，改以訪客身分使用');
}
export function openLogoutConfirm(){
  st().openConfirm({
    title:'登出 Google',
    text:'登出後回到訪客模式，畫面上的資料保留不動，\n但僅存在瀏覽器記憶體，請記得先儲存至雲端或匯出 JSON。',
    cancelLabel:'取消', okLabel:'確定登出',
    onOk: logoutGoogle,
    wide: true
  });
}

/* ---------------- axios 骨架：Sheets 請求統一出口 ---------------- */
export const sheetsApi = axios.create({ baseURL:'https://sheets.googleapis.com/v4/spreadsheets' });
sheetsApi.interceptors.request.use((cfg) => {
  cfg.headers.Authorization = 'Bearer ' + st().auth.token;
  return cfg;
});
sheetsApi.interceptors.response.use(null, async (err) => {
  if(err.response?.status === 401 && !err.config._retried){
    err.config._retried = true;
    await requestGoogleLogin({skipAutoLoad:true});   // token 過期：重新彈授權視窗，完成後重試原請求
    return sheetsApi(err.config);
  }
  return Promise.reject(err);
});

/* ---------------- Google Sheets 讀寫：三份試算表全量覆寫＋登入自動載入 ----------------
   文件庫（_索引/_資料夾 常駐＋每文件一分頁）、術語庫、翻譯記憶。
   spreadsheetId 存 localStorage（只存 ID 不存資料，鍵名沿用 vanilla：既有連結直接帶入）；
   scope 不能搜 Drive，遺失以貼網址重連復原 */
const SHEET_IDS_KEY = 'catToolSheetIds';
const SHEET_FILE_TITLES = { docs:'校譯台－文件庫', terms:'校譯台－術語庫', tm:'校譯台－翻譯記憶' };
const INDEX_HEADER  = ['docId','檔名','資料夾ID','srcLang','tgtLang','createdAt','updatedAt','分頁標題'];
const FOLDER_HEADER = ['folderId','名稱'];
const DOC_HEADER    = ['segId','srcNo','原文','譯文','confirmed','tmId'];
const TERM_HEADER   = ['id','原文','譯名','備註','出處','srcLang','tgtLang'];
const TM_HEADER     = ['id','原文','譯文','出處','srcLang','tgtLang'];

export function loadSheetIds(){
  try{ return JSON.parse(localStorage.getItem(SHEET_IDS_KEY)) || {}; }
  catch(_){ return {}; }
}
function saveSheetIds(ids){
  localStorage.setItem(SHEET_IDS_KEY, JSON.stringify(ids));
  _missingIdsNoticeShown = false;   // 連結已更新（建檔/重連）：缺 ID 提示重新武裝
}

/* 缺 ID 守門：ID 只存 localStorage，被瀏覽器清掉（或第一次儲存）時絕不靜默建檔——
   曾在正式站踩過「連結遺失→靜默重建三件套」造成 Drive 重複檔案與讀取混亂 */
const SHEET_KIND_LABELS = { docs:'文件庫', terms:'術語庫', tm:'翻譯記憶' };
let _missingIdsNoticeShown = false;   // 自動儲存的缺 ID 提示只吐一次，避免每 30 秒輪詢洗版
function missingSheetKinds(){
  const ids = loadSheetIds();
  return Object.keys(SHEET_KIND_LABELS).filter(k => !ids[k]).map(k => SHEET_KIND_LABELS[k]);
}

/* 分頁標題不可含 []/\*?: 與引號、不可撞常駐分頁；重名加 (2) 尾碼，實際標題記回 _索引 */
function sheetTitleForDoc(name, used){
  let t = String(name || '未命名').replace(/[\[\]\/\\\*\?:'"]/g, '·').slice(0, 60).trim() || '未命名';
  if(t.startsWith('_')) t = '·' + t.slice(1);
  let final = t, n = 2;
  while(used.has(final)) final = t + ' (' + (n++) + ')';
  used.add(final);
  return final;
}

function serializeForCloud(){
  const { documents, termBase, tmSegments, folders } = st();
  const used = new Set(['_索引', '_資料夾']);
  const docSheets = documents.map(d => ({
    title: sheetTitleForDoc(d.name, used),
    doc: d,
    rows: d.segments.map(s => [s.id, s.srcNo ?? '', s.ja || '', s.zh || '', s.confirmed ? 'TRUE' : 'FALSE', s.tmId || ''])
  }));
  return {
    docSheets,
    indexRows:  docSheets.map(ds => [ds.doc.id, ds.doc.name, ds.doc.folderId || '', ds.doc.srcLang || '',
                                     ds.doc.tgtLang || '', String(ds.doc.createdAt || ''), String(ds.doc.updatedAt || ''), ds.title]),
    folderRows: folders.map(f => [f.id, f.name]),
    termRows:   termBase.map(t => [t.id, t.ja || '', t.zh || '', t.note || '', t.source || '', t.srcLang || '', t.tgtLang || '']),
    tmRows:     tmSegments.map(t => [t.id, t.ja || '', t.zh || '', t.source || '', t.srcLang || '', t.tgtLang || ''])
  };
}

/* 缺哪份建哪份；建立時一併寫好標記分頁（載入與貼網址辨識都認這些分頁名）。
   每建成一份立刻記下 ID：三份全建完才存的話，中途 401 重授權沒走完會丟失已建的 ID，
   在 Drive 留下無主檔、下次儲存又建一批（正式站踩過的洩漏） */
async function ensureCloudFiles(){
  const ids = loadSheetIds();
  if(!ids.docs){
    const r = await sheetsApi.post('', { properties:{title:SHEET_FILE_TITLES.docs},
      sheets:[{properties:{title:'_索引'}}, {properties:{title:'_資料夾'}}] });
    ids.docs = r.data.spreadsheetId;
    saveSheetIds(ids);
  }
  if(!ids.terms){
    const r = await sheetsApi.post('', { properties:{title:SHEET_FILE_TITLES.terms},
      sheets:[{properties:{title:'術語庫'}}] });
    ids.terms = r.data.spreadsheetId;
    saveSheetIds(ids);
  }
  if(!ids.tm){
    const r = await sheetsApi.post('', { properties:{title:SHEET_FILE_TITLES.tm},
      sheets:[{properties:{title:'翻譯記憶'}}] });
    ids.tm = r.data.spreadsheetId;
    saveSheetIds(ids);
  }
  return ids;
}

export async function saveAllToCloud(opts = {}){
  if(st().cloudBusy){ if(!opts.auto) toast('儲存進行中，請稍候…'); return; }
  if(!st().auth.token){
    st().openConfirm({
      title:'尚未連結 Google',
      text:'儲存至雲端前，請先登入 Google 帳號。',
      cancelLabel:'取消', okLabel:'立即登入',
      onOk: () => { requestGoogleLogin({skipAutoLoad:true}).then(saveAllToCloud).catch(()=>{}); }
    });
    return;
  }
  /* 缺 ID 不靜默建檔：手動存先確認（既有試算表可能還在 Drive，先給重連的機會）；
     自動存直接暫停並提示一次（自動流程絕不該擅自建新檔） */
  const missing = missingSheetKinds();
  if(missing.length && !opts.allowCreate){
    if(opts.auto){
      if(!_missingIdsNoticeShown){
        toast('自動儲存暫停：找不到雲端試算表連結，請手動儲存或到帳號視窗重新連結');
        _missingIdsNoticeShown = true;
      }
    }else{
      st().openConfirm({
        title:'建立新試算表',
        text:`在這個瀏覽器找不到「${missing.join('、')}」的試算表連結。\n第一次儲存屬正常；若之前存過，可能是瀏覽器清除了記錄，\n請先到帳號視窗貼網址重新連結，避免建出重複的試算表。`,
        cancelLabel:'取消', okLabel:'建立新檔並儲存',
        onOk: () => saveAllToCloud({...opts, allowCreate:true}),
        wide: true
      });
    }
    return;
  }
  useStore.setState({ cloudBusy: true });
  try{
    const snapAtStart = cloudSnapshot();   // 儲存期間若又打字，快照對不上=仍視為未儲存
    const ids = await ensureCloudFiles();
    const data = serializeForCloud();

    /* 文件庫：刪舊文件分頁＋建新分頁（_索引/_資料夾 常駐，保證恆有分頁在），再全量寫值 */
    const meta = await sheetsApi.get(`/${ids.docs}`, {params:{fields:'sheets.properties'}});
    const requests = [];
    meta.data.sheets.map(s => s.properties)
      .filter(p => p.title !== '_索引' && p.title !== '_資料夾')
      .forEach(p => requests.push({deleteSheet:{sheetId:p.sheetId}}));
    // 分頁指定實際大小（預設 1000×26 格會虛耗配額：每份試算表上限一千萬格）
    data.docSheets.forEach(ds => requests.push({addSheet:{properties:{
      title: ds.title,
      gridProperties:{rowCount: ds.rows.length + 1, columnCount: DOC_HEADER.length}
    }}}));
    if(requests.length) await sheetsApi.post(`/${ids.docs}:batchUpdate`, {requests});
    await sheetsApi.post(`/${ids.docs}/values:batchClear`, {ranges:['_索引', '_資料夾']});
    await sheetsApi.post(`/${ids.docs}/values:batchUpdate`, {valueInputOption:'RAW', data:[
      {range:'_索引!A1',   values:[INDEX_HEADER,  ...data.indexRows]},
      {range:'_資料夾!A1', values:[FOLDER_HEADER, ...data.folderRows]},
      ...data.docSheets.map(ds => ({range:`'${ds.title}'!A1`, values:[DOC_HEADER, ...ds.rows]}))
    ]});

    await sheetsApi.post(`/${ids.terms}/values:batchClear`, {ranges:['術語庫']});
    await sheetsApi.post(`/${ids.terms}/values:batchUpdate`, {valueInputOption:'RAW',
      data:[{range:'術語庫!A1', values:[TERM_HEADER, ...data.termRows]}]});
    await sheetsApi.post(`/${ids.tm}/values:batchClear`, {ranges:['翻譯記憶']});
    await sheetsApi.post(`/${ids.tm}/values:batchUpdate`, {valueInputOption:'RAW',
      data:[{range:'翻譯記憶!A1', values:[TM_HEADER, ...data.tmRows]}]});

    _lastCloudSnapshot = snapAtStart;
    _expiredNoticeShown = false;
    const { documents, termBase, tmSegments } = st();
    const t = new Date();
    const hhmm = String(t.getHours()).padStart(2,'0') + ':' + String(t.getMinutes()).padStart(2,'0');
    toast(`${opts.auto ? '已自動儲存至雲端' : '已儲存至雲端'}（${documents.length} 份文件、${termBase.length} 條術語、${tmSegments.length} 句記憶｜${hhmm}）`);
  }catch(err){
    // 404＝連結的試算表已被刪（含垃圾桶清空）：手動存提供 App 內自救，免開 DevTools 清 localStorage；
    // 自動存不彈窗（維持只報錯），使用者手動存時再處理
    if(err.response?.status === 404 && !opts.auto) offerUnlinkDeadSheets();
    else toast('儲存失敗：' + (err.response?.data?.error?.message || err.message));
  }finally{
    useStore.setState({ cloudBusy: false });
  }
}

/* 儲存遇 404 的自救：逐份健檢三個 ID，只清掉找不到的（仍在的保留沿用，不重複建），
   再以 allowCreate 重存——缺哪份建哪份，接回 ensureCloudFiles 原有流程 */
function offerUnlinkDeadSheets(){
  st().openConfirm({
    title:'找不到雲端試算表',
    text:'連結的試算表可能已被刪除。\n要解除失效連結並重新儲存嗎？\n仍存在的試算表會保留沿用，只為找不到的部分建立新檔。',
    cancelLabel:'取消', okLabel:'解除失效連結並儲存',
    onOk: async () => {
      try{
        const ids = loadSheetIds();
        for(const k of Object.keys(SHEET_KIND_LABELS)){
          if(!ids[k]) continue;
          const alive = await sheetsApi.get(`/${ids[k]}`, {params:{fields:'spreadsheetId'}})
            .then(() => true)
            .catch(e => { if(e.response?.status === 404) return false; throw e; });
          if(!alive) delete ids[k];
        }
        saveSheetIds(ids);
        saveAllToCloud({allowCreate:true});
      }catch(err){
        toast('儲存失敗：' + (err.response?.data?.error?.message || err.message));
      }
    },
    wide: true
  });
}

/* 讀取：batchGet 需重複 ranges 參數，手組 query string（axios 陣列序列化格式 Google 不收） */
async function fetchRanges(spreadsheetId, ranges){
  const qs = ranges.map(r => 'ranges=' + encodeURIComponent(r)).join('&');
  const r = await sheetsApi.get(`/${spreadsheetId}/values:batchGet?${qs}`);
  return r.data.valueRanges.map(v => v.values || []);
}
const _cell = (row, i) => row[i] === undefined || row[i] === null ? '' : String(row[i]);

async function fetchAllFromCloud(){
  const ids = loadSheetIds();
  const next = { documents:[], termBase:[], tmSegments:[], folders:[] };
  if(ids.docs){
    const [idxRows, folderRows] = await fetchRanges(ids.docs, ['_索引', '_資料夾']);
    next.folders = folderRows.slice(1).filter(r => _cell(r,0)).map(r => ({id:_cell(r,0), name:_cell(r,1)}));
    const docMetas = idxRows.slice(1).filter(r => _cell(r,0)).map(r => ({
      id:_cell(r,0), name:_cell(r,1), folderId:_cell(r,2) || null,
      srcLang:_cell(r,3), tgtLang:_cell(r,4),
      createdAt:Number(_cell(r,5)) || Date.now(), updatedAt:Number(_cell(r,6)) || Date.now(),
      sheetTitle:_cell(r,7)
    }));
    if(docMetas.length){
      const segRangeRows = await fetchRanges(ids.docs, docMetas.map(m => `'${m.sheetTitle}'!A2:F`));
      next.documents = docMetas.map((m, i) => ({
        id:m.id, name:m.name, folderId:m.folderId, srcLang:m.srcLang, tgtLang:m.tgtLang,
        createdAt:m.createdAt, updatedAt:m.updatedAt,
        segments: segRangeRows[i].filter(r => _cell(r,0)).map(r => ({
          id:_cell(r,0),
          srcNo:_cell(r,1) === '' ? null : (isNaN(Number(_cell(r,1))) ? _cell(r,1) : Number(_cell(r,1))),
          ja:_cell(r,2), zh:_cell(r,3),
          confirmed:_cell(r,4) === 'TRUE',
          tmId:_cell(r,5) || null
        }))
      }));
    }
  }
  if(ids.terms){
    const [rows] = await fetchRanges(ids.terms, ['術語庫!A2:G']);
    next.termBase = rows.filter(r => _cell(r,0)).map(r => ({
      id:_cell(r,0), ja:_cell(r,1), zh:_cell(r,2), note:_cell(r,3), source:_cell(r,4),
      srcLang:_cell(r,5), tgtLang:_cell(r,6)
    }));
  }
  if(ids.tm){
    const [rows] = await fetchRanges(ids.tm, ['翻譯記憶!A2:F']);
    next.tmSegments = rows.filter(r => _cell(r,0)).map(r => ({
      id:_cell(r,0), ja:_cell(r,1), zh:_cell(r,2), source:_cell(r,3),
      srcLang:_cell(r,4), tgtLang:_cell(r,5)
    }));
  }
  return next;
}

/* 覆蓋 store 資料並重置各區選取狀態（React 由訂閱自動重繪，無幽靈畫面手工重繪清單） */
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
  const ids = loadSheetIds();
  if(!ids.docs && !ids.terms && !ids.tm) return;
  const doLoad = async () => {
    try{
      const next = await fetchAllFromCloud();
      applyCloudData(next);
      toast(`已從雲端載入 ${next.documents.length} 份文件、${next.termBase.length} 條術語、${next.tmSegments.length} 句記憶`);
    }catch(err){
      toast('雲端載入失敗：' + (err.response?.status === 404
        ? '找不到試算表（可能已被刪除，可到帳號視窗重新連結）'
        : (err.response?.data?.error?.message || err.message)));
    }
  };
  const { documents, termBase, tmSegments, folders } = st();
  const hasLocal = documents.length || termBase.length || tmSegments.length || folders.length;
  if(hasLocal){
    st().openConfirm({
      title:'載入雲端資料',
      text:'偵測到本機已有資料。\n載入雲端會覆蓋目前畫面上的所有內容，要繼續嗎？',
      cancelLabel:'保留本機資料', okLabel:'載入雲端（覆蓋本機）',
      onOk: doLoad,
      wide: true
    });
  }else{
    await doLoad();
  }
}

/* 貼網址重連：標記分頁自動辨識（帳號 Modal 用） */
export async function relinkSpreadsheet(url){
  const m = /spreadsheets\/d\/([A-Za-z0-9_-]+)/.exec(url);
  if(!m){ toast('無法從網址解析試算表 ID'); return false; }
  try{
    const meta = await sheetsApi.get(`/${m[1]}`, {params:{fields:'sheets.properties'}});
    const titles = meta.data.sheets.map(s => s.properties.title);
    const ids = loadSheetIds();
    let kind = null;
    if(titles.includes('_索引'))          { ids.docs = m[1];  kind = '文件庫'; }
    else if(titles.includes('術語庫'))    { ids.terms = m[1]; kind = '術語庫'; }
    else if(titles.includes('翻譯記憶'))  { ids.tm = m[1];    kind = '翻譯記憶'; }
    if(!kind){ toast('辨識失敗：這份試算表沒有校譯台的標記分頁'); return false; }
    saveSheetIds(ids);
    toast(`已重新連結「${kind}」`);
    return true;
  }catch(err){
    toast('連結失敗：' + (err.response?.data?.error?.message || err.message));
    return false;
  }
}

/* ---------------- 雲端自動儲存與關頁守門：以資料快照比對偵測未儲存變更 ---------------- */
const AUTO_SAVE_MS = 20 * 60 * 1000;   // 20 分鐘
function cloudSnapshot(){
  const { documents, termBase, tmSegments, folders } = st();
  return JSON.stringify({documents, termBase, tmSegments, folders});
}
let _lastCloudSnapshot = cloudSnapshot();   // 初始＝空狀態
let _expiredNoticeShown = false;
export function hasUnsavedChanges(){ return cloudSnapshot() !== _lastCloudSnapshot; }

export function autoSaveTick(){
  if(!hasUnsavedChanges()) return;
  if(!st().auth.token) return;                  // 訪客不打擾
  if(Date.now() >= st().auth.expiresAt){        // 過期不能無手勢彈授權視窗（會被瀏覽器攔）
    st().setAuthExpiredPause(true);             // 開常駐橫幅：一次性吐司易錯過，停擺狀態需持續可見
    if(!_expiredNoticeShown){
      toast('自動儲存暫停：Google 授權已過期，請由上方橫幅重新授權');
      _expiredNoticeShown = true;
    }
    return;
  }
  saveAllToCloud({auto:true});
}

/* 過期前搶存（每個 token 週期只搶一次）：token 剩不到 5 分鐘且有未儲存變更時，
   不等閒置條件立刻上傳——把「過期後自動儲存停擺」的資料風險窗口壓到過期前一刻 */
const NEAR_EXPIRY_MS = 5 * 60 * 1000;
let _preExpirySaved = false;
export function preExpirySaveCheck(){
  if(_preExpirySaved) return;
  if(!st().auth.token || !hasUnsavedChanges()) return;
  const left = st().auth.expiresAt - Date.now();
  if(left <= 0 || left > NEAR_EXPIRY_MS) return;
  _preExpirySaved = true;   // 失敗不重試：之後仍有閒置/定時儲存接手，過期後由橫幅收尾
  saveAllToCloud({auto:true});
}

/* 過期橫幅「重新授權並儲存」：點擊本身是使用者手勢，可直接彈 GIS 視窗；
   成功後補存一次（登入 callback 已重置橫幅與旗標），失敗時授權層已吐司、不重複提示 */
export function reauthAndSave(){
  return requestGoogleLogin({skipAutoLoad:true})
    .then(() => saveAllToCloud({auto:true}))
    .catch(() => {});
}

/* 閒置自動存（debounce）：改動後停手 3 分鐘即上傳——翻譯節奏中不打 API（每存一次
   約 8~10 個請求，寫入配額 60 請求/分，逐句即存會撞限）；20 分鐘定時為保底 */
const IDLE_SAVE_MS = 3 * 60 * 1000;
const IDLE_POLL_MS = 30 * 1000;
let _lastSeenSnapshot = _lastCloudSnapshot;
let _lastChangeAt = 0;
export function idleSaveCheck(){
  preExpirySaveCheck();   // 搶存不等閒置：連續打字中 token 快過期也要先存，放在改動偵測之前
  const snap = cloudSnapshot();
  if(snap !== _lastSeenSnapshot){          // 還在改動：重新起算閒置時間
    _lastSeenSnapshot = snap;
    _lastChangeAt = Date.now();
    return;
  }
  if(!hasUnsavedChanges()) return;
  if(_lastChangeAt && Date.now() - _lastChangeAt >= IDLE_SAVE_MS) autoSaveTick();   // 共用訪客/過期守門
}

const _timers = [setInterval(autoSaveTick, AUTO_SAVE_MS), setInterval(idleSaveCheck, IDLE_POLL_MS)];
function _beforeUnload(e){
  if(!hasUnsavedChanges()) return;
  e.preventDefault();
  e.returnValue = '';   // 需設值 Chrome 才顯示原生「確定離開？」
}
window.addEventListener('beforeunload', _beforeUnload);
// vite dev HMR 換版時清掉舊計時器與監聽，避免重複註冊
if(import.meta.hot) import.meta.hot.dispose(() => {
  _timers.forEach(clearInterval);
  window.removeEventListener('beforeunload', _beforeUnload);
});

/* 句段整理五功能送出後即時存雲端（已登入才觸發；訪客沿用手動儲存流程） */
export function autoSaveAfterSegTool(){
  if(st().auth.token) saveAllToCloud({auto:true});
}

/* 測試後門：Puppeteer 驗收需撥快「最後改動時間」模擬閒置（同 vanilla 直接改全域變數） */
export const _test = {
  setLastChangeAt(ts){ _lastChangeAt = ts; }
};
