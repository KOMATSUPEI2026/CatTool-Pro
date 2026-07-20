import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { cid, docPair, langJoiner, parseYouTubeId } from './utils.js';

/* ---- Phase 0 本機持久化：四大資料陣列鏡像到 localStorage ----
   延遲序列化 storage：updateSegZh 逐鍵觸發 setState，整本書逐鍵 JSON.stringify 會卡打字，
   故 setItem 只暫存物件參照（store 全面不可變更新，參照凍結安全），閒置 800ms 才序列化寫入；
   關頁/重整由 beforeunload 補 flush，最大遺失窗口即 800ms */
const PERSIST_KEY = 'catToolWorkData';
const PERSIST_FLUSH_MS = 800;
let _pendingPersist = null;
let _persistTimer = null;
function flushPersist(){
  if(_persistTimer){ clearTimeout(_persistTimer); _persistTimer = null; }
  if(!_pendingPersist) return;
  try{
    localStorage.setItem(_pendingPersist.name, JSON.stringify(_pendingPersist.value));
  }catch(e){ /* 配額滿等寫入失敗：資料仍在記憶體與雲端流程，不中斷操作 */ }
  _pendingPersist = null;
}
const lazyJSONStorage = {
  getItem: (name) => {
    try{
      const raw = localStorage.getItem(name);
      return raw ? JSON.parse(raw) : null;
    }catch(e){ return null; }
  },
  setItem: (name, value) => {
    _pendingPersist = { name, value };
    if(_persistTimer) clearTimeout(_persistTimer);
    _persistTimer = setTimeout(flushPersist, PERSIST_FLUSH_MS);
  },
  removeItem: (name) => {
    _pendingPersist = null;
    localStorage.removeItem(name);
  }
};
window.addEventListener('beforeunload', flushPersist);

/* V57：資料夾「有檔案→變空」的瞬間自動消滅；新建的空資料夾不受影響（消滅只由搬移/刪除觸發） */
function pruneEmptiedFolder(folders, documents, folderId){
  if(!folderId) return folders;
  return documents.some(d => d.folderId === folderId)
    ? folders
    : folders.filter(f => f.id !== folderId);
}

/* ---- 使用者偏好（V54）：標點三組＋標籤面板等「跟人走的工作習慣資產」 ----
   與 fontMode（裝置偏好）不同：跨裝置應一致，故獨立鍵存 localStorage 之外，
   登入後另由 cloud.js 同步 user_prefs 表（單列 jsonb，updatedAt 比大小＝最後寫入者贏）。
   normalizePrefs 兜底舊結構/缺鍵（雲端舊列、未來加鍵都走這裡補預設） */
const PREFS_KEY = 'catToolPrefs';
export const DEFAULT_PUNCT_KEYS = ['，','。','；','：','、','「」','『』','！','？','“”'];
const defaultPrefs = () => ({
  punctSets: [[...DEFAULT_PUNCT_KEYS], Array(10).fill(''), Array(10).fill('')],
  punctSetIdx: 0,
  punctPinned: false,
  termTagPalette: Array(7).fill(''),
  tmThreshold: 70,   // TM 靈敏度門檻（V56）：側欄相似模式只列相似度 ≥ 此值的結果（0–100、步進 5）
  pvTransparency: 50,   // 整頁預覽毛玻璃透明度 %（V63）：越高越透；alpha＝(100−值)/100，50＝V53 定案原值
  pvBlur: 15,           // 整頁預覽毛玻璃模糊度 px（V63）：0–30；15＝V53 定案原值
  ytUrl: '',            // 白噪音 YouTube 連結（V63）：header 音樂鈕播放來源
  musicVolume: 100,     // 白噪音音量 %（V63 微調）：0–100 步進 5；100＝YouTube 預設音量
  musicStartPct: 0,     // 白噪音播放起始位置 %（V63 微調）：0–100 整數，起始秒數＝總長×比例、只在首播套用；0＝從頭
  updatedAt: 0
});
export function normalizePrefs(raw){
  const d = defaultPrefs();
  if(!raw || typeof raw !== 'object') return d;
  return {
    punctSets: (Array.isArray(raw.punctSets) && raw.punctSets.length === 3)
      ? raw.punctSets.map(g => Array.from({ length: 10 }, (_, i) => (g && typeof g[i] === 'string') ? g[i] : ''))
      : d.punctSets,
    punctSetIdx: [0, 1, 2].includes(raw.punctSetIdx) ? raw.punctSetIdx : 0,
    punctPinned: !!raw.punctPinned,
    termTagPalette: Array.isArray(raw.termTagPalette)
      ? Array.from({ length: 7 }, (_, i) => typeof raw.termTagPalette[i] === 'string' ? raw.termTagPalette[i] : '')
      : d.termTagPalette,
    tmThreshold: (typeof raw.tmThreshold === 'number' && raw.tmThreshold >= 0 && raw.tmThreshold <= 100)
      ? Math.round(raw.tmThreshold / 5) * 5
      : d.tmThreshold,
    pvTransparency: (typeof raw.pvTransparency === 'number' && raw.pvTransparency >= 0 && raw.pvTransparency <= 100)
      ? Math.round(raw.pvTransparency / 5) * 5
      : d.pvTransparency,
    pvBlur: (typeof raw.pvBlur === 'number' && raw.pvBlur >= 0 && raw.pvBlur <= 30)
      ? Math.round(raw.pvBlur)
      : d.pvBlur,
    ytUrl: typeof raw.ytUrl === 'string' ? raw.ytUrl : d.ytUrl,
    musicVolume: (typeof raw.musicVolume === 'number' && raw.musicVolume >= 0 && raw.musicVolume <= 100)
      ? Math.round(raw.musicVolume / 5) * 5
      : d.musicVolume,
    musicStartPct: (typeof raw.musicStartPct === 'number' && raw.musicStartPct >= 0 && raw.musicStartPct <= 100)
      ? Math.round(raw.musicStartPct)
      : d.musicStartPct,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0
  };
}
function loadLocalPrefs(){
  try{ return normalizePrefs(JSON.parse(localStorage.getItem(PREFS_KEY))); }
  catch(e){ return defaultPrefs(); }
}
function saveLocalPrefs(prefs){
  try{ localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); }
  catch(e){ /* 無痕模式等寫入失敗：本次仍生效 */ }
}

/* 目前檔案的句段陣列替換（翻譯工作區各 action 共用；順帶蓋 updatedAt）。
   V68 方向 B（比照 pruneEmptiedFolder）：句段被清光→文件一併自動移除。
   只有「刪除句子」與「編輯 Modal 清空全部原文」兩條路徑會傳入空陣列（其餘 action 皆等長 map 或增段），
   故集中在此守住「不留空文件」不變量；留言鏡像 cascade、清 currentDocId/焦點/復原快照、
   順手消滅變空的資料夾，TM/術語不動（核心決策 1：刪文件不牽連 TM/術語） */
function withSegments(s, segments){
  if(segments.length === 0){
    const doc = s.documents.find(d => d.id === s.currentDocId);
    if(doc){
      const documents = s.documents.filter(d => d.id !== doc.id);
      return {
        documents,
        comments: s.comments.filter(c => c.docId !== doc.id),
        currentDocId: null,
        lastFocusedSegId: null,
        srUndoSnapshot: s.srUndoSnapshot?.docId === doc.id ? null : s.srUndoSnapshot,
        folders: pruneEmptiedFolder(s.folders, documents, doc.folderId),
        toast: { msg: `文件「${doc.name}」已因句段全數刪除而移除`, seq: (s.toast?.seq || 0) + 1 }
      };
    }
  }
  return {
    documents: s.documents.map(d =>
      d.id === s.currentDocId ? { ...d, segments, updatedAt: Date.now() } : d)
  };
}

/* 資料模型原樣搬遷（欄位與 ja/zh 內部鍵名慣例不變，見 docs/cat-tool-handoff.md）：
   documents = [{ id, name, folderId, srcLang, tgtLang, segments:[{id, ja, zh, confirmed, reviewed, tmId, srcNo}], createdAt, updatedAt }]
   （V52 起 confirmed＝已翻譯、reviewed＝已校對；reviewed 不可領先 confirmed，舊資料缺 reviewed 視為 false）
   termBase   = [{ id, ja, zh, note, source, srcLang, tgtLang }]
   tmSegments = [{ id, ja, zh, source, srcLang, tgtLang }]
   folders    = [{ id, name }]
   後續各輪把 vanilla 的資料變動函式逐一收成 actions */
export const useStore = create(persist((set) => ({
  documents: [],
  termBase: [],
  tmSegments: [],
  folders: [],
  // 留言（V55）：錨定某句段原文的一段文字（start/end＝字元位移、quote＝選取當下原文，錨點回貼用）
  // comments = [{ id, docId, segId, start, end, quote, body, resolved, createdAt, updatedAt }]
  comments: [],
  currentTab: 'ingest',
  currentDocId: null,
  collapsedFolders: new Set(),
  toast: null,   // { msg, seq }：seq 遞增讓同文字連發也能觸發重播（單例頂替）
  // 入稿區語系配對（入稿前必選；文件建立時定格記錄）。放 store 供術語庫新增詞條當後備配對
  ingestSrcLang: '',
  ingestTgtLang: '',
  // 翻譯工作區狀態
  lastFocusedSegId: null,   // 最後聚焦的句段（TM 側欄相似比對的基準）
  srUndoSnapshot: null,     // 搜尋取代的復原快照 { docId, items:[{segId, zh, confirmed, reviewed, tmId}] }
  workMode: 'translate',    // 工作區模式（V52）：translate＝翻譯、review＝校對；決定 Tab/點徽章切的狀態
  termTip: null,            // 術語提示卡 { segId, termId, ja, zh, anchor }；跨元件互斥（標點快捷鍵讓路）用
  textScale: 1,             // 防老花模式 ×scale（1/1.2/1.4）
  // 字級模式（V51）：desktop＝12/14/16/18/26、laptop＝10/12/14/16/24（27 吋與 13 吋螢幕各有舒適刻度）
  // 屬於裝置偏好：獨立鍵存 localStorage（不走 persist——那是工作資料的鏡像）
  fontMode: (() => { try{ return localStorage.getItem('catToolFontMode') === 'laptop' ? 'laptop' : 'desktop'; }catch(e){ return 'desktop'; } })(),
  // 使用者偏好（V54）：標點三組/組別/固定、術語標籤面板；localStorage 即載，登入後與雲端對時
  prefs: loadLocalPrefs(),
  // 雲端層（讀寫邏輯在 cloud.js，這裡只放需要驅動畫面的狀態）
  auth: { token: null, email: null, uid: null },   // Supabase Auth session 映射（SDK 自動續期，無過期防護需求）；uid＝V65 換帳號守門用
  cmtOpenSeq: 0,            // 留言側欄展開請求（V55）：卡片留言 icon 點擊遞增，側欄訂閱後展開並固定
  cloudBusy: false,         // 儲存進行中（鎖「儲存至雲端」按鈕＋重入守門）
  cloudFlashSeq: 0,         // 全量儲存成功遞增：雲端鈕短暫轉實心雲 icon（V51）
  musicPlaying: false,      // 白噪音播放中（V63）：header 音樂鈕開關；純畫面暫態不落地、不進 prefs
  musicDuration: null,      // 白噪音影片總長秒數（V63 微調）：null＝未知（未播放/尚未就緒）、0＝直播無總長；
                            // App 端 onStateChange PLAYING 時回填，時間軸滑桿據此換算顯示；純畫面暫態不落地
  welcomeVisible: true,     // 歡迎面板（登入成功或選訪客後收起）
  confirmModal: null,       // 全域確認 Modal { title, text, cancelLabel, okLabel, onOk, onCancel, wide }；雲端層等元件外程式碼用

  activateTab: (key) => set({ currentTab: key, termTip: null }),
  setWorkMode: (mode) => set({ workMode: mode, termTip: null }),
  openDoc: (docId) => set({ currentDocId: docId, currentTab: 'work' }),
  setLastFocusedSeg: (segId) => set({ lastFocusedSegId: segId }),
  setTermTip: (tip) => set({ termTip: tip }),
  cycleTextScale: () => set(s => {
    const scales = [1, 1.2, 1.4];
    return { textScale: scales[(scales.indexOf(s.textScale) + 1) % scales.length], termTip: null };
  }),
  toggleFontMode: () => set(s => {
    const next = s.fontMode === 'desktop' ? 'laptop' : 'desktop';
    try{ localStorage.setItem('catToolFontMode', next); }catch(e){ /* 無痕模式等寫入失敗：本次仍生效 */ }
    return { fontMode: next, termTip: null };
  }),
  setIngestLang: (which, value) => set(which === 'src' ? { ingestSrcLang: value } : { ingestTgtLang: value }),
  setMusicPlaying: (on) => set({ musicPlaying: !!on }),
  setMusicDuration: (n) => set({ musicDuration: n }),
  // 白噪音開關（V63）：header 音樂鈕與個人設定區播放鈕共用；連結無效以 Toast 引導
  toggleMusic: () => set(s => {
    if (s.musicPlaying) return { musicPlaying: false, musicDuration: null };
    if (!parseYouTubeId(s.prefs.ytUrl)) {
      return { toast: { msg: '請先在「個人設定區」輸入有效的 YouTube 連結', seq: (s.toast?.seq || 0) + 1 } };
    }
    return { musicPlaying: true };
  }),

  // 偏好變更唯一入口：蓋 updatedAt＋寫 localStorage；雲端上傳由 cloud.js 訂閱 prefs 參照變化觸發
  patchPrefs: (patch) => set(s => {
    const prefs = { ...s.prefs, ...patch, updatedAt: Date.now() };
    saveLocalPrefs(prefs);
    return { prefs };
  }),
  // 雲端套用（cloud.js 對時後呼叫）：不蓋 updatedAt（保留雲端時間戳），同樣落地 localStorage
  setPrefsFromCloud: (raw) => set(() => {
    const prefs = normalizePrefs(raw);
    saveLocalPrefs(prefs);
    return { prefs };
  }),

  /* ---- 留言（V55）：CRUD 一律走這四個 actions；雲端即存由呼叫端接手 ---- */
  addComment: (c) => set(s => ({ comments: [...s.comments, c] })),
  updateCommentBody: (id, body) => set(s => ({
    comments: s.comments.map(c => c.id === id ? { ...c, body, updatedAt: Date.now() } : c)
  })),
  setCommentResolved: (id, on) => set(s => ({
    comments: s.comments.map(c => c.id === id ? { ...c, resolved: !!on, updatedAt: Date.now() } : c)
  })),
  deleteComment: (id) => set(s => ({ comments: s.comments.filter(c => c.id !== id) })),
  openCommentSidebar: () => set(s => ({ cmtOpenSeq: s.cmtOpenSeq + 1 })),

  setAuth: (patch) => set(s => ({ auth: { ...s.auth, ...patch } })),
  hideWelcome: () => set({ welcomeVisible: false }),
  openConfirm: (cfg) => set({ confirmModal: cfg }),
  closeConfirm: () => set({ confirmModal: null }),

  // 入稿兩條路徑共用：建檔後自動切到專案管理區
  addDocuments: (docs) => set(s => ({ documents: [...s.documents, ...docs], currentTab: 'projects' })),

  showToast: (msg) => set(s => ({ toast: { msg, seq: (s.toast?.seq || 0) + 1 } })),

  addFolder: (name) => set(s => ({ folders: [...s.folders, { id: cid(), name }] })),
  // 刪資料夾一律走 batchDelete（V58 起專案區工具列批次刪除）＋自動消滅空資料夾（pruneEmptiedFolder），
  // 故不再保留獨立的 deleteFolder action（V66 移除死碼）
  toggleFolder: (folderId) => set(s => {
    const next = new Set(s.collapsedFolders);
    if(next.has(folderId)) next.delete(folderId); else next.add(folderId);
    return { collapsedFolders: next };
  }),
  deleteDocument: (docId) => set(s => {
    const gone = s.documents.find(d => d.id === docId);
    const documents = s.documents.filter(d => d.id !== docId);
    return {
      documents,
      comments: s.comments.filter(c => c.docId !== docId),   // 鏡像 DB cascade：留言跟文件走
      currentDocId: s.currentDocId === docId ? null : s.currentDocId,
      folders: pruneEmptiedFolder(s.folders, documents, gone && gone.folderId)
    };
  }),
  setDocFolder: (docId, folderId) => set(s => {
    const doc = s.documents.find(d => d.id === docId);
    const next = folderId || null;
    if(!doc || (doc.folderId || null) === next) return {};
    const documents = s.documents.map(d =>
      d.id === docId ? { ...d, folderId: next, updatedAt: Date.now() } : d);
    return { documents, folders: pruneEmptiedFolder(s.folders, documents, doc.folderId) };
  }),
  /* V58 批次搬移：勾選的文件一次移入同一資料夾（''/null＝未分類）；被搬空的來源夾自動消滅 */
  moveDocsToFolder: (docIds, folderId) => set(s => {
    const ids = new Set(docIds);
    const next = folderId || null;
    const srcFolders = new Set();
    let changed = false;
    const documents = s.documents.map(d => {
      if(!ids.has(d.id) || (d.folderId || null) === next) return d;
      if(d.folderId) srcFolders.add(d.folderId);
      changed = true;
      return { ...d, folderId: next, updatedAt: Date.now() };
    });
    if(!changed) return {};
    let folders = s.folders;
    srcFolders.forEach(fid => { folders = pruneEmptiedFolder(folders, documents, fid); });
    return { documents, folders };
  }),
  /* V58 批次刪除：勾選的文件刪除（留言鏡像 cascade）、勾選的資料夾刪除（夾內未勾選文件回未分類）；
     未勾選但被刪文件清空的資料夾照 V57 規則自動消滅 */
  batchDelete: (docIds, folderIds) => set(s => {
    const dIds = new Set(docIds), fIds = new Set(folderIds);
    const touched = new Set();
    s.documents.forEach(d => { if(dIds.has(d.id) && d.folderId) touched.add(d.folderId); });
    const documents = s.documents
      .filter(d => !dIds.has(d.id))
      .map(d => d.folderId && fIds.has(d.folderId) ? { ...d, folderId: null } : d);
    let folders = s.folders.filter(f => !fIds.has(f.id));
    touched.forEach(fid => { if(!fIds.has(fid)) folders = pruneEmptiedFolder(folders, documents, fid); });
    return {
      documents, folders,
      comments: s.comments.filter(c => !dIds.has(c.docId)),
      currentDocId: dIds.has(s.currentDocId) ? null : s.currentDocId
    };
  }),
  renameFolder: (folderId, name) => set(s => ({
    folders: s.folders.map(f => f.id === folderId ? { ...f, name } : f)
  })),
  renameDocument: (docId, name) => set(s => ({
    documents: s.documents.map(d =>
      d.id === docId ? { ...d, name, updatedAt: Date.now() } : d)
  })),

  addTerm: (term) => set(s => ({ termBase: [term, ...s.termBase] })),
  updateTerm: (id, field, value) => set(s => ({
    termBase: s.termBase.map(t => t.id === id ? { ...t, [field]: value } : t)
  })),
  deleteTerm: (id) => set(s => ({ termBase: s.termBase.filter(t => t.id !== id) })),
  importTerms: (rows) => set(s => ({ termBase: [...s.termBase, ...rows] })),

  // 刪 TM 不清譯文：懸空參照的句段徽章退回未確認，譯文文字保留（核心設計決策 1）
  deleteTmSegment: (tmId) => set(s => ({
    tmSegments: s.tmSegments.filter(t => t.id !== tmId),
    documents: s.documents.map(d => d.segments.some(seg => seg.tmId === tmId)
      ? { ...d, segments: d.segments.map(seg =>
          seg.tmId === tmId ? { ...seg, tmId: null, confirmed: false, reviewed: false } : seg) }
      : d)
  })),
  importTmSegments: (rows) => set(s => ({ tmSegments: [...s.tmSegments, ...rows] })),

  patchTerm: (id, patch) => set(s => ({
    termBase: s.termBase.map(t => t.id === id ? { ...t, ...patch } : t)
  })),

  /* ---- 翻譯工作區：句段編輯與確認 ---- */

  // 譯文改動（打字/術語帶入/標點插入/側欄套用共用）：
  // V28 編輯即退回未確認，tmId 保留 → 重按 Tab 覆寫同一筆 TM，不產生重複紀錄
  // V52：內容變了兩階段認證都失效，reviewed 一併退回
  updateSegZh: (segId, val) => set(s => {
    const doc = s.documents.find(d => d.id === s.currentDocId);
    if(!doc) return {};
    return withSegments(s, doc.segments.map(seg =>
      seg.id === segId ? { ...seg, zh: val, confirmed: false, reviewed: false } : seg));
  }),

  // Tab 確認：進 TM 的唯一入口（核心設計決策 1）
  // V52：review=true＝校對模式確認一次到位（confirmed＋reviewed 同時成立，TM 覆寫同筆）；
  //      review=false＝翻譯模式確認，reviewed 維持原值（沒改稿重按 Tab 不摘掉已校對）
  confirmSegment: (segId, val, review = false) => set(s => {
    const doc = s.documents.find(d => d.id === s.currentDocId);
    const seg = doc && doc.segments.find(x => x.id === segId);
    if(!seg) return {};

    if(!val.trim()){
      // 譯文被清空：退回未確認未校對、解除與 TM 的參照關係，
      // 但 TM 紀錄本身是歷史翻譯知識庫，保留不動、不自動刪除或清空
      return withSegments(s, doc.segments.map(x =>
        x.id === segId ? { ...x, zh: val, confirmed: false, reviewed: false, tmId: null } : x));
    }

    let tmSegments = s.tmSegments;
    let tmId = seg.tmId;
    if(tmId && tmSegments.some(t => t.id === tmId)){
      tmSegments = tmSegments.map(t => t.id === tmId ? { ...t, zh: val, source: doc.name } : t);
    } else {
      const p = docPair(doc);
      const nt = { id: cid(), ja: seg.ja, zh: val, source: doc.name, srcLang: p.src, tgtLang: p.tgt };
      tmSegments = [...tmSegments, nt];
      tmId = nt.id;
    }
    // 已重新確認儲存的句段，不能再透過「復原」還原：從復原快照中移除
    let srUndoSnapshot = s.srUndoSnapshot;
    if(srUndoSnapshot && srUndoSnapshot.docId === doc.id){
      const items = srUndoSnapshot.items.filter(it => it.segId !== segId);
      srUndoSnapshot = items.length ? { ...srUndoSnapshot, items } : null;
    }
    return {
      tmSegments, srUndoSnapshot,
      ...withSegments(s, doc.segments.map(x =>
        x.id === segId ? { ...x, zh: val, confirmed: true, reviewed: review ? true : !!x.reviewed, tmId } : x))
    };
  }),

  // 點徽章取消確認（翻譯模式 toggle off）：兩階段一併退回；tmId 保留 → 重確認覆寫同筆 TM
  unconfirmSegment: (segId) => set(s => {
    const doc = s.documents.find(d => d.id === s.currentDocId);
    if(!doc) return {};
    return withSegments(s, doc.segments.map(x =>
      x.id === segId ? { ...x, confirmed: false, reviewed: false } : x));
  }),

  // 點徽章切換校對狀態（校對模式）：標記已校對以「已翻譯」為前提（reviewed 不可領先 confirmed）
  setSegReviewed: (segId, on) => set(s => {
    const doc = s.documents.find(d => d.id === s.currentDocId);
    const seg = doc && doc.segments.find(x => x.id === segId);
    if(!seg || (on && !seg.confirmed)) return {};
    return withSegments(s, doc.segments.map(x =>
      x.id === segId ? { ...x, reviewed: !!on } : x));
  }),

  // TM 側欄卡片 Tab：直接更新該筆翻譯記憶的譯文
  updateTmZh: (tmId, val) => set(s => ({
    tmSegments: s.tmSegments.map(t => t.id === tmId ? { ...t, zh: val } : t)
  })),

  // 重置翻譯進度（翻譯模式重置鈕）：全文件退回未翻譯，校對一併退回（reviewed 不可領先）；
  // tmId 保留 → 重按 Tab 覆寫同一筆 TM
  resetConfirmed: () => set(s => {
    const doc = s.documents.find(d => d.id === s.currentDocId);
    if(!doc) return {};
    return {
      // 取代的復原快照存有舊的 confirmed 狀態，重置後不可再復原，一律作廢
      srUndoSnapshot: s.srUndoSnapshot?.docId === doc.id ? null : s.srUndoSnapshot,
      ...withSegments(s, doc.segments.map(x => ({ ...x, confirmed: false, reviewed: false })))
    };
  }),

  // 重置校對進度（校對模式重置鈕）：只退 reviewed，翻譯狀態與 TM 皆不動
  resetReviewed: () => set(s => {
    const doc = s.documents.find(d => d.id === s.currentDocId);
    if(!doc) return {};
    return withSegments(s, doc.segments.map(x => ({ ...x, reviewed: false })));
  }),

  /* ---- 搜尋譯文並取代（僅作用於目前檔案） ---- */
  executeSearchReplace: (query, replaceWith) => set(s => {
    const doc = s.documents.find(d => d.id === s.currentDocId);
    if(!doc || !query) return {};
    const snapshot = [];
    const segments = doc.segments.map(seg => {
      if(!(seg.zh||'').includes(query)) return seg;
      snapshot.push({ segId: seg.id, zh: seg.zh, confirmed: seg.confirmed, reviewed: !!seg.reviewed, tmId: seg.tmId });
      // 受影響句段退回未確認未校對、解除 TM 參照，TM 紀錄本身保留不動
      return { ...seg, zh: seg.zh.split(query).join(replaceWith), confirmed: false, reviewed: false, tmId: null };
    });
    return { srUndoSnapshot: { docId: doc.id, items: snapshot }, ...withSegments(s, segments) };
  }),

  undoSearchReplace: () => set(s => {
    const snap = s.srUndoSnapshot;
    const doc = snap && s.documents.find(d => d.id === snap.docId);
    if(!doc) return { srUndoSnapshot: null };
    const byId = new Map(snap.items.map(it => [it.segId, it]));
    return {
      srUndoSnapshot: null,
      documents: s.documents.map(d => d.id !== doc.id ? d : {
        ...d, updatedAt: Date.now(),
        segments: d.segments.map(seg => {
          const it = byId.get(seg.id);
          return it ? { ...seg, zh: it.zh, confirmed: it.confirmed, reviewed: !!it.reviewed, tmId: it.tmId } : seg;
        })
      })
    };
  }),

  /* ---- 句段整理五功能（改原文＝與 TM 對不上：退回未確認＋解除參照；TM 紀錄保留） ---- */

  // 編輯／分割：items=[{segId, ja}]，segId=null 為分割出的新句；清空的句子視同刪除
  applySegEdit: (items) => set(s => {
    const doc = s.documents.find(d => d.id === s.currentDocId);
    if(!doc) return {};
    const kept = [];
    items.forEach(it => {
      if(!it.ja.trim()) return;
      if(it.segId){
        const seg = doc.segments.find(x => x.id === it.segId);
        if(seg){
          kept.push(seg.ja !== it.ja ? { ...seg, ja: it.ja, confirmed: false, reviewed: false, tmId: null } : seg);
          return;
        }
      }
      // 分割出的後半句：譯文留在前半句，這裡從空白開始
      kept.push({ id: cid(), ja: it.ja, zh: '', confirmed: false, reviewed: false, tmId: null });
    });
    // 被清空（視同刪除）的句段：留言鏡像 cascade 一併清；保留句的留言不動（錨點渲染時回貼）
    const keptIds = new Set(kept.map(x => x.id));
    return {
      srUndoSnapshot: s.srUndoSnapshot?.docId === doc.id ? null : s.srUndoSnapshot,
      comments: s.comments.filter(c => c.docId !== doc.id || keptIds.has(c.segId)),
      ...withSegments(s, kept)
    };
  }),

  // 排序：不改任何句段內容與狀態，復原快照以 segId 對回，仍然有效不作廢。
  // 防禦（V64）：Modal 開啟期間 Realtime 遠端變更會讓 orderIds 過期——
  // 過期 id 略過、不在清單內的現存句段依原相對順序附掛尾端，任何情況都不讓 undefined 進陣列
  applySegOrder: (orderIds) => set(s => {
    const doc = s.documents.find(d => d.id === s.currentDocId);
    if(!doc) return {};
    const byId = new Map(doc.segments.map(x => [x.id, x]));
    const ordered = [];
    orderIds.forEach(id => {
      const seg = byId.get(id);
      if(seg){ ordered.push(seg); byId.delete(id); }
    });
    return withSegments(s, [...ordered, ...byId.values()]);
  }),

  // 合併：相鄰驗證由 Modal 把關；原文/譯文各依語系決定串接字元。
  // 防禦（V64）：Modal 開啟期間 Realtime 遠端變更可能讓選取漂移——
  // 現存句段湊不滿兩句或不再相鄰時放棄合併（splice 連續範圍的前提不成立，硬做會刪錯句段）
  mergeSegments: (ids) => set(s => {
    const doc = s.documents.find(d => d.id === s.currentDocId);
    if(!doc) return {};
    const idSet = new Set(ids);
    const indices = doc.segments.map((x,i) => idSet.has(x.id) ? i : -1).filter(i => i >= 0);
    if(indices.length < 2 || !indices.every((v, k) => v === indices[0] + k)){
      return { toast: { msg: '句段已被其他視窗變更，合併未執行，請重新開啟合併視窗。', seq: (s.toast?.seq || 0) + 1 } };
    }
    const group = indices.map(i => doc.segments[i]);
    const p = docPair(doc);
    const first = {
      ...group[0],
      ja: group.map(x => x.ja).join(langJoiner(p.src)),
      zh: group.map(x => x.zh||'').filter(t => t.trim()).join(langJoiner(p.tgt)),
      confirmed: false, reviewed: false, tmId: null
    };
    const segments = [...doc.segments];
    segments.splice(indices[0], indices.length, first);
    // 被併掉的後續句段消失：其留言鏡像 cascade 清掉（首句留言保留，錨點渲染時回貼）
    const goneIds = new Set(group.slice(1).map(x => x.id));
    return {
      srUndoSnapshot: s.srUndoSnapshot?.docId === doc.id ? null : s.srUndoSnapshot,
      comments: s.comments.filter(c => !goneIds.has(c.segId)),
      ...withSegments(s, segments)
    };
  }),

  // 新增：pos=0 插為第一句、i+1 插在第 i+1 句之後；不影響既有句段，復原快照不作廢
  addSegment: (pos, text) => set(s => {
    const doc = s.documents.find(d => d.id === s.currentDocId);
    if(!doc) return {};
    const segments = [...doc.segments];
    segments.splice(pos, 0, { id: cid(), ja: text, zh: '', confirmed: false, reviewed: false, tmId: null });
    return withSegments(s, segments);
  }),

  deleteSegments: (ids) => set(s => {
    const doc = s.documents.find(d => d.id === s.currentDocId);
    if(!doc) return {};
    const idSet = new Set(ids);
    return {
      srUndoSnapshot: s.srUndoSnapshot?.docId === doc.id ? null : s.srUndoSnapshot,
      comments: s.comments.filter(c => !idSet.has(c.segId)),   // 鏡像 DB cascade：留言跟句段走
      ...withSegments(s, doc.segments.filter(x => !idSet.has(x.id)))
    };
  })
}), {
  name: PERSIST_KEY,
  version: 1,
  storage: lazyJSONStorage,
  // 只持久化資料欄位；auth 與 UI 狀態一律排除，憑證不落地（Supabase session 由 SDK 自行管理）
  partialize: (s) => ({
    documents: s.documents,
    termBase: s.termBase,
    tmSegments: s.tmSegments,
    folders: s.folders,
    comments: s.comments
  })
}));
