import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '../store.js';
import { cid, docStats, docPair, downloadJSON, findTermHits, langName } from '../utils.js';
import { autoGrow, autoGrowAll, insertIntoSeg } from '../workActions.js';
import { saveSegmentNow } from '../cloud.js';
import ConfirmModal from '../components/ConfirmModal.jsx';
import TermTip from '../components/TermTip.jsx';
import TermModal from '../components/TermModal.jsx';
import { SegEditModal, SegOrderModal, SegMergeModal, SegAddModal, SegDeleteModal } from '../components/SegToolModals.jsx';
import PagePreview from '../components/PagePreview.jsx';

const VIEW_MODES = [
  { key: 'review',    label: '校閱模式' },
  { key: 'translate', label: '翻譯模式' },
  { key: 'readonly',  label: '純譯文模式' }
];

/* 原文加術語高亮（最長優先、不重疊）；hover／點擊開術語提示卡 */
function HighlightedSrc({ text, segId, termBase, doc }) {
  const setTermTip = useStore(s => s.setTermTip);
  const hits = findTermHits(text, termBase, doc);
  if (hits.length === 0) return text;

  const openTip = (h, e) => {
    const r = e.currentTarget.getBoundingClientRect();
    setTermTip({
      segId, termId: h.term.id, ja: h.term.ja, zh: h.term.zh,
      anchor: { top: r.top, bottom: r.bottom, left: r.left }
    });
  };
  const out = [];
  let cursor = 0;
  hits.forEach((h, i) => {
    if (h.start > cursor) out.push(text.slice(cursor, h.start));
    out.push(
      <span key={i} className="term-hit" data-seg={segId} data-termid={h.term.id}
            onMouseOver={e => openTip(h, e)}
            onClick={e => { e.stopPropagation(); openTip(h, e); }}>
        {text.slice(h.start, h.end)}
      </span>
    );
    cursor = h.end;
  });
  out.push(text.slice(cursor));
  return out;
}

function SegRow({ seg, index, doc, active, viewKey }) {
  const termBase = useStore(s => s.termBase);
  const textScale = useStore(s => s.textScale);
  const workMode = useStore(s => s.workMode);
  const updateSegZh = useStore(s => s.updateSegZh);
  const confirmSegment = useStore(s => s.confirmSegment);
  const unconfirmSegment = useStore(s => s.unconfirmSegment);
  const setSegReviewed = useStore(s => s.setSegReviewed);
  const setLastFocusedSeg = useStore(s => s.setLastFocusedSeg);
  const showToast = useStore(s => s.showToast);
  const taRef = useRef(null);

  // 隱藏面板 scrollHeight 為 0：只在分頁可見時量測；檢視模式/防老花切換會改寬度與字級，一併補算
  useLayoutEffect(() => {
    if (active) autoGrow(taRef.current);
  }, [seg.zh, active, viewKey, textScale]);

  /* 點徽章切換狀態（V52，Termsoup 式）：依工作模式切翻譯或校對；
     標記完成一律要求譯文非空（confirmed 綁 TM，空句進 TM 是污染）；
     校對模式點未翻譯句段＝一次到位（confirmed＋reviewed＋TM 覆寫同筆） */
  const onBadgeClick = () => {
    if (workMode === 'translate') {
      if (seg.confirmed) unconfirmSegment(seg.id);
      else if (!(seg.zh || '').trim()) { showToast('譯文為空白，無法標記為已翻譯。'); return; }
      else confirmSegment(seg.id, seg.zh);
    } else {
      if (seg.reviewed) setSegReviewed(seg.id, false);
      else if (seg.confirmed) setSegReviewed(seg.id, true);
      else if (!(seg.zh || '').trim()) { showToast('譯文為空白，無法標記為已校對。'); return; }
      else confirmSegment(seg.id, seg.zh, true);
    }
    saveSegmentNow(seg.id);
  };

  return (
    <div className={'seg' + (seg.confirmed ? ' confirmed' : '') + (seg.reviewed ? ' reviewed' : '')}>
      <div className="seg-num">
        {/* 氣泡提示會被 .seg 的 overflow:hidden 裁切，徽章用原生 title */}
        <span className="badge" onClick={onBadgeClick}
              title={workMode === 'translate' ? '點擊切換已翻譯狀態' : '點擊切換已校對狀態'}>{index + 1}</span>
      </div>
      <div className="seg-body">
        <div className="seg-src">
          <div className="label"><span>原文 {langName(doc.srcLang || 'ja')}（{doc.srcLang || 'ja'}）</span></div>
          <div className="src-text">
            <HighlightedSrc text={seg.ja} segId={seg.id} termBase={termBase} doc={doc} />
          </div>
        </div>
        <div className="seg-tgt">
          <div className="label"><span>譯文 {langName(doc.tgtLang || 'zh-TW')}（{doc.tgtLang || 'zh-TW'}）</span></div>
          <textarea ref={taRef} data-seg={seg.id} placeholder="輸入譯文，按 Tab 確認並存入記憶…"
                    value={seg.zh || ''}
                    onChange={e => updateSegZh(seg.id, e.target.value)}
                    onFocus={() => setLastFocusedSeg(seg.id)}
                    onKeyDown={e => {
                      // Shift+Tab 是反向移動焦點，不觸發確認（避免往回瀏覽時誤存 TM）
                      // Zustand set 同步完成，confirmSegment 後即存讀到的是確認後狀態
                      // V52：校對模式 Tab＝一次到位（confirmed＋reviewed＋TM 覆寫同筆，改稿後不用切回翻譯模式）
                      if (e.key === 'Tab' && !e.shiftKey) {
                        confirmSegment(seg.id, e.target.value, workMode === 'review');
                        saveSegmentNow(seg.id);
                      }
                    }} />
        </div>
      </div>
    </div>
  );
}

/* 反白原文的「+ 新增術語」浮動按鈕（先隱形量寬再定位） */
function SelectionAddButton({ sel, onAdd }) {
  const btnRef = useRef(null);
  const [pos, setPos] = useState(null);
  useLayoutEffect(() => {
    const btnW = btnRef.current.offsetWidth;
    let top = sel.rect.top - 38;
    if (top < 8) top = sel.rect.bottom + 8;
    let left = sel.rect.left;
    if (left + btnW > window.innerWidth - 8) left = window.innerWidth - btnW - 8;
    setPos({ top, left });
  }, [sel]);
  return (
    <button id="sel-add-btn" ref={btnRef} className="selection-add-btn"
            style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}
            onClick={e => { e.stopPropagation(); onAdd(); }}>
      + 新增術語
    </button>
  );
}

export default function WorkTab() {
  const documents = useStore(s => s.documents);
  const termBase = useStore(s => s.termBase);
  const currentDocId = useStore(s => s.currentDocId);
  const currentTab = useStore(s => s.currentTab);
  const srUndoSnapshot = useStore(s => s.srUndoSnapshot);
  const workMode = useStore(s => s.workMode);
  const setWorkMode = useStore(s => s.setWorkMode);
  const setTermTip = useStore(s => s.setTermTip);
  const resetConfirmed = useStore(s => s.resetConfirmed);
  const resetReviewed = useStore(s => s.resetReviewed);
  const executeSearchReplace = useStore(s => s.executeSearchReplace);
  const undoSearchReplace = useStore(s => s.undoSearchReplace);
  const addTerm = useStore(s => s.addTerm);
  const patchTerm = useStore(s => s.patchTerm);
  const deleteTerm = useStore(s => s.deleteTerm);
  const showToast = useStore(s => s.showToast);

  const [viewIdx, setViewIdx] = useState(0);
  const [srQuery, setSrQuery] = useState('');
  const [srReplace, setSrReplace] = useState('');
  const [selBtn, setSelBtn] = useState(null);   // 反白新增術語 { text, rect }
  const [modal, setModal] = useState(null);
  // {type:'reset', n} | {type:'srConfirm', n} | {type:'term', term, prefillJa} | {type:'delTerm', term}
  // | {type:'segEdit'|'segOrder'|'segMerge'|'segAdd'|'segDelete'} | {type:'pagePreview'}

  const doc = documents.find(d => d.id === currentDocId) || null;
  const active = currentTab === 'work';
  const st = doc ? docStats(doc) : { confirmedPct: 0, reviewedPct: 0 };
  const viewKey = VIEW_MODES[viewIdx].key;

  const kw = srQuery.trim();
  const srCount = (doc && kw)
    ? doc.segments.reduce((n, seg) => n + ((seg.zh || '').split(kw).length - 1), 0)
    : 0;

  /* 反白原文 → 浮動新增術語按鈕（vanilla 的 document 層監聽原樣搬遷） */
  useEffect(() => {
    const onMouseUp = (e) => {
      if (e.target.closest('#sel-add-btn') || e.target.closest('.modal-overlay')) return;
      setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) { setSelBtn(null); return; }
        const anchorEl = sel.anchorNode && sel.anchorNode.nodeType === 3 ? sel.anchorNode.parentElement : sel.anchorNode;
        const srcEl = anchorEl ? anchorEl.closest('.src-text') : null;
        if (!srcEl) { setSelBtn(null); return; }
        const text = sel.toString().trim();
        if (!text) { setSelBtn(null); return; }
        const r = sel.getRangeAt(0).getBoundingClientRect();
        setSelBtn({ text, rect: { top: r.top, bottom: r.bottom, left: r.left } });
      }, 0);
    };
    const onMouseDown = (e) => {
      if (e.target.id === 'sel-add-btn') return;
      if (!e.target.closest('.src-text')) setSelBtn(null);
    };
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('mousedown', onMouseDown);
    return () => {
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, []);

  /* 視窗縮放改變欄寬 → 全部譯文框補量一次（150ms debounce，同 vanilla） */
  useEffect(() => {
    let timer = null;
    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(() => autoGrowAll('#seg-list textarea'), 150);
    };
    window.addEventListener('resize', onResize);
    return () => { clearTimeout(timer); window.removeEventListener('resize', onResize); };
  }, []);

  const onSegTool = (type) => {
    if (!doc) return;
    if (type !== 'segAdd' && doc.segments.length === 0) { showToast('目前檔案沒有句段。'); return; }
    if ((type === 'segOrder' || type === 'segMerge') && doc.segments.length < 2) {
      showToast(type === 'segOrder' ? '至少需要兩個句段才能排序。' : '至少需要兩個句段才能合併。');
      return;
    }
    setModal({ type });
  };

  // 重置進度（V52）：依工作模式各管各的——翻譯模式退翻譯（校對連動退）、校對模式只退校對
  const onResetConfirm = () => {
    if (!doc) return;
    const n = doc.segments.filter(s => workMode === 'translate' ? s.confirmed : s.reviewed).length;
    if (n === 0) { showToast(workMode === 'translate' ? '目前檔案沒有已翻譯的句段。' : '目前檔案沒有已校對的句段。'); return; }
    setModal({ type: 'reset', n });
  };

  // 整頁預覽（V53）：無檔案/無句段擋下（空預覽沒有意義）；開啟前收術語提示卡
  const onPagePreview = () => {
    if (!doc) { showToast('請先開啟一個檔案'); return; }
    if (doc.segments.length === 0) { showToast('目前檔案沒有句段。'); return; }
    setTermTip(null);
    setModal({ type: 'pagePreview' });
  };

  const onReplace = () => {
    if (!doc) { showToast('請先開啟一個檔案'); return; }
    if (!kw) { showToast('請先在搜尋框輸入要搜尋的譯文字詞'); return; }
    if (srCount === 0) { showToast('目前檔案的譯文中找不到「' + kw + '」'); return; }
    setModal({ type: 'srConfirm', n: srCount });
  };

  const onUndo = () => {
    if (!srUndoSnapshot) { showToast('目前沒有可復原的取代'); return; }
    if (!documents.some(d => d.id === srUndoSnapshot.docId)) { showToast('找不到原檔案，無法復原'); }
    undoSearchReplace();
  };

  const onExport = () => {
    if (!doc) return;
    const p = docPair(doc);
    downloadJSON(doc.segments.map(s => ({
      [p.src]: s.ja, [p.tgt]: s.zh,
      confirmed: !!s.confirmed, reviewed: !!s.reviewed, source: doc.name, srcLang: p.src, tgtLang: p.tgt
    })), (doc.name || 'segments') + '.json');
  };

  /* 術語 Modal 送出（新增/編輯共用；提示卡編輯與反白新增都走這裡）；V54 帶標籤 */
  const onTermSubmit = (ja, zh, note, tag) => {
    if (modal.term) {
      patchTerm(modal.term.id, { ja, zh, note, tag: tag || '' });
    } else {
      const p = docPair(doc);
      addTerm({ id: cid(), ja, zh, note, tag: tag || '', source: doc ? doc.name : '', srcLang: p.src, tgtLang: p.tgt });
    }
    setModal(null);
  };

  const anyShown = doc && doc.segments.some(seg => !kw || (seg.zh || '').includes(kw));

  return (
    <>
      <div className="doc-context-bar">
        <div className="doc-context-top">
          <span><i className="bi bi-file-earmark-text"></i> 目前檔案：<span className="doc-name" id="current-doc-name">{doc ? doc.name : '—'}</span></span>
          <span style={{ display: 'inline-flex', gap: 10 }}>
            {/* 工作模式切換（V52，Termsoup 式）：取代返回鈕（返回走頂部分頁列）；決定 Tab/點徽章切的狀態 */}
            <span className="wk-mode-switch" role="group">
              <button className={'wk-mode-btn' + (workMode === 'translate' ? ' active' : '')} id="btn-mode-translate"
                      data-tip="翻譯模式：Tab／點徽章＝確認翻譯並存入記憶"
                      onClick={() => setWorkMode('translate')}>
                <i className="bi bi-translate"></i>
              </button>
              <button className={'wk-mode-btn' + (workMode === 'review' ? ' active' : '')} id="btn-mode-review"
                      data-tip="校對模式：Tab／點徽章＝標記已校對"
                      onClick={() => setWorkMode('review')}>
                <i className="bi bi-check-square-fill"></i>
              </button>
            </span>
            <button className="icon-btn" id="btn-reset-confirm"
                    data-tip={workMode === 'translate' ? '重置翻譯進度：全句段退回未翻譯' : '重置校對進度：全句段退回未校對'}
                    onClick={onResetConfirm}>
              <i className="bi bi-arrow-counterclockwise"></i>
            </button>
            <button className="icon-btn" id="btn-seg-edit" data-tip="編輯／分割原文" onClick={() => onSegTool('segEdit')}><i className="bi bi-pencil-square"></i></button>
            <button className="icon-btn" id="btn-seg-reorder" data-tip="重新排列原文" onClick={() => onSegTool('segOrder')}><i className="bi bi-arrow-down-up"></i></button>
            <button className="icon-btn" id="btn-seg-merge" data-tip="合併原文" onClick={() => onSegTool('segMerge')}><i className="bi bi-arrows-collapse"></i></button>
            <button className="icon-btn" id="btn-seg-add" data-tip="新增原文" onClick={() => onSegTool('segAdd')}><i className="bi bi-plus-lg"></i></button>
            <button className="icon-btn tip-right" id="btn-seg-delete" data-tip="刪除原文" onClick={() => onSegTool('segDelete')}><i className="bi bi-trash3"></i></button>
          </span>
        </div>
        {/* V52：進度全面改「明確標記制」——翻譯進度＝已翻譯（confirmed）、校對進度＝已校對（reviewed）；
            舊制「有字就前進」的 draftPct 不再上進度條（狀態混淆源頭） */}
        <div className="progress-row">
          <span className="progress-label">翻譯進度</span>
          <div className="progress-track"><div className="progress-fill fill-translate" id="pg-translate" style={{ width: st.confirmedPct + '%' }}></div></div>
          <span className="progress-pct" id="pg-translate-pct">{st.confirmedPct}%</span>
        </div>
        <div className="progress-row">
          <span className="progress-label">校對進度</span>
          <div className="progress-track"><div className="progress-fill fill-confirm" id="pg-confirm" style={{ width: st.reviewedPct + '%' }}></div></div>
          <span className="progress-pct" id="pg-confirm-pct">{st.reviewedPct}%</span>
        </div>
      </div>

      <div className="view-toolbar">
        <span className="hint">提示：選取原文中的文字可以新增術語・Mac：Ctrl+N、Win：Alt+N 快速帶入術語</span>
        <button className="icon-btn" id="btn-page-preview"
                data-tip="整頁預覽：原文與譯文整頁通讀"
                onClick={onPagePreview}>
          <i className="bi bi-book"></i>
        </button>
        <button className="icon-btn tip-right" id="btn-view-mode"
                data-tip={`檢視模式：${VIEW_MODES[viewIdx].label}，點擊切換`}
                onClick={() => { setViewIdx((viewIdx + 1) % VIEW_MODES.length); setTermTip(null); }}>
          <i className="bi bi-layout-wtf"></i>
        </button>
      </div>

      <div className="sr-bar">
        <span className="sr-label">搜尋譯文並取代：</span>
        <input type="text" id="sr-query" placeholder="搜尋框" value={srQuery} onChange={e => setSrQuery(e.target.value)} />
        <span className="sr-arrow"><i className="bi bi-arrow-right"></i></span>
        <input type="text" id="sr-replace" placeholder="取代為…" value={srReplace} onChange={e => setSrReplace(e.target.value)} />
        <button className="btn small vermilion" id="sr-replace-btn" onClick={onReplace}>取代</button>
        <button className="btn small outline" id="sr-undo-btn" onClick={onUndo}>復原</button>
        <span className="sr-count" id="sr-count">{kw ? `命中 ${srCount} 處` : ''}</span>
      </div>

      <div id="seg-list" className={'mode-' + viewKey}>
        {doc && doc.segments.map((seg, i) =>
          (!kw || (seg.zh || '').includes(kw)) &&
            <SegRow key={seg.id} seg={seg} index={i} doc={doc} active={active} viewKey={viewKey} />)}
        {doc && doc.segments.length > 0 && kw && !anyShown &&
          <div className="empty">沒有譯文包含「{kw}」的句段。</div>}
      </div>
      <div className="empty" id="seg-empty"
           style={{ display: (!doc || doc.segments.length === 0) ? 'block' : 'none' }}>
        {doc ? '這個檔案沒有任何句段。' : '尚未開啟任何檔案。請先到「專案管理區」開啟一個檔案。'}
      </div>

      <div className="import-row" style={{ marginTop: 10, display: (doc && doc.segments.length > 0) ? 'flex' : 'none' }} id="export-row">
        <span className="hint">完成的句段可匯出，銜接後續排版流程</span>
        <button className="btn outline small" id="btn-export-work" onClick={onExport}>匯出 JSON</button>
      </div>

      <TermTip
        onEdit={(term, prefillJa) => setModal({ type: 'term', term, prefillJa })}
        onDelete={(term) => setModal({ type: 'delTerm', term })} />

      {selBtn &&
        <SelectionAddButton sel={selBtn}
          onAdd={() => { setModal({ type: 'term', term: null, prefillJa: selBtn.text }); setSelBtn(null); }} />}

      {modal?.type === 'term' &&
        <TermModal term={modal.term} prefillJa={modal.prefillJa}
                   onCancel={() => setModal(null)} onSubmit={onTermSubmit} />}

      {modal?.type === 'delTerm' &&
        <ConfirmModal title="刪除術語" cancelLabel="取消刪除" okLabel="確定刪除"
                      onCancel={() => setModal(null)}
                      onOk={() => { deleteTerm(modal.term.id); setModal(null); }}>
          確定要刪除術語嗎？此操作無法復原。
        </ConfirmModal>}

      {modal?.type === 'reset' && workMode === 'translate' &&
        <ConfirmModal title="重置翻譯進度" cancelLabel="取消重置" okLabel="確定重置" wide
                      onCancel={() => setModal(null)}
                      onOk={() => { resetConfirmed(); setModal(null); }}>
          有 {modal.n} 句已翻譯（校對）句段將退回未翻譯。<br />譯文＆翻譯記憶皆保留，請重新逐句按 Tab 確認。
        </ConfirmModal>}

      {modal?.type === 'reset' && workMode === 'review' &&
        <ConfirmModal title="重置校對進度" cancelLabel="取消重置" okLabel="確定重置" wide
                      onCancel={() => setModal(null)}
                      onOk={() => { resetReviewed(); setModal(null); }}>
          有 {modal.n} 句已校對的句段將退回未校對。<br />翻譯狀態、譯文、翻譯記憶皆保留。
        </ConfirmModal>}

      {modal?.type === 'srConfirm' &&
        <ConfirmModal title="取代譯文" cancelLabel="取消取代" okLabel="確定取代"
                      onCancel={() => setModal(null)}
                      onOk={() => { executeSearchReplace(kw, srReplace); setModal(null); }}>
          有 {modal.n} 處會被取代，句段會退回未確認狀態。
        </ConfirmModal>}

      {modal?.type === 'pagePreview' && <PagePreview doc={doc} onClose={() => setModal(null)} />}

      {modal?.type === 'segEdit'   && <SegEditModal   doc={doc} onClose={() => setModal(null)} />}
      {modal?.type === 'segOrder'  && <SegOrderModal  doc={doc} onClose={() => setModal(null)} />}
      {modal?.type === 'segMerge'  && <SegMergeModal  doc={doc} onClose={() => setModal(null)} />}
      {modal?.type === 'segAdd'    && <SegAddModal    doc={doc} onClose={() => setModal(null)} />}
      {modal?.type === 'segDelete' && <SegDeleteModal doc={doc} onClose={() => setModal(null)} />}
    </>
  );
}
