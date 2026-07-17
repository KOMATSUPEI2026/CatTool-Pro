import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { cid, docPair, langJoiner } from './utils.js';

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

/* 目前檔案的句段陣列替換（翻譯工作區各 action 共用；順帶蓋 updatedAt） */
function withSegments(s, segments){
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
  // 雲端層（讀寫邏輯在 cloud.js，這裡只放需要驅動畫面的狀態）
  auth: { token: null, email: null },   // Supabase Auth session 映射（SDK 自動續期，無過期防護需求）
  cloudBusy: false,         // 儲存進行中（鎖「儲存至雲端」按鈕＋重入守門）
  cloudFlashSeq: 0,         // 全量儲存成功遞增：雲端鈕短暫轉實心雲 icon（V51）
  welcomeVisible: true,     // 歡迎面板（登入成功或選訪客後收起）
  confirmModal: null,       // 全域確認 Modal { title, text, cancelLabel, okLabel, onOk, wide }；雲端層等元件外程式碼用

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

  setAuth: (patch) => set(s => ({ auth: { ...s.auth, ...patch } })),
  hideWelcome: () => set({ welcomeVisible: false }),
  openConfirm: (cfg) => set({ confirmModal: cfg }),
  closeConfirm: () => set({ confirmModal: null }),

  // 入稿兩條路徑共用：建檔後自動切到專案管理區
  addDocuments: (docs) => set(s => ({ documents: [...s.documents, ...docs], currentTab: 'projects' })),

  showToast: (msg) => set(s => ({ toast: { msg, seq: (s.toast?.seq || 0) + 1 } })),

  addFolder: (name) => set(s => ({ folders: [...s.folders, { id: cid(), name }] })),
  deleteFolder: (folderId) => set(s => ({
    folders: s.folders.filter(f => f.id !== folderId),
    documents: s.documents.map(d => d.folderId === folderId ? { ...d, folderId: null } : d)
  })),
  toggleFolder: (folderId) => set(s => {
    const next = new Set(s.collapsedFolders);
    if(next.has(folderId)) next.delete(folderId); else next.add(folderId);
    return { collapsedFolders: next };
  }),
  deleteDocument: (docId) => set(s => ({
    documents: s.documents.filter(d => d.id !== docId),
    currentDocId: s.currentDocId === docId ? null : s.currentDocId
  })),
  setDocFolder: (docId, folderId) => set(s => ({
    documents: s.documents.map(d =>
      d.id === docId ? { ...d, folderId: folderId || null, updatedAt: Date.now() } : d)
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
    return {
      srUndoSnapshot: s.srUndoSnapshot?.docId === doc.id ? null : s.srUndoSnapshot,
      ...withSegments(s, kept)
    };
  }),

  // 排序：不改任何句段內容與狀態，復原快照以 segId 對回，仍然有效不作廢
  applySegOrder: (orderIds) => set(s => {
    const doc = s.documents.find(d => d.id === s.currentDocId);
    if(!doc) return {};
    return withSegments(s, orderIds.map(id => doc.segments.find(x => x.id === id)));
  }),

  // 合併：相鄰驗證由 Modal 把關；原文/譯文各依語系決定串接字元
  mergeSegments: (ids) => set(s => {
    const doc = s.documents.find(d => d.id === s.currentDocId);
    if(!doc) return {};
    const idSet = new Set(ids);
    const indices = doc.segments.map((x,i) => idSet.has(x.id) ? i : -1).filter(i => i >= 0);
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
    return {
      srUndoSnapshot: s.srUndoSnapshot?.docId === doc.id ? null : s.srUndoSnapshot,
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
    folders: s.folders
  })
}));
