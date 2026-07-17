import { useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '../store.js';
import { samePair, similarity } from '../utils.js';
import { autoGrow } from '../workActions.js';
import { flushSync } from 'react-dom';

const SIDE_SCALES = [1, 1.2, 1.4];

/* TM 卡片（相似/搜尋兩模式共用）：Tab 更新記憶、Enter 套用至左側句段
   linked＝聚焦句段連結中的那筆（tmId 相符），掛小圖釘標示——同原文的無主舊紀錄並排時可辨識 */
function TmCard({ t, score, scale, active, linked }) {
  const updateTmZh = useStore(s => s.updateTmZh);
  const updateSegZh = useStore(s => s.updateSegZh);
  const [val, setVal] = useState(t.zh);
  const taRef = useRef(null);
  const lastZh = useRef(t.zh);

  // TM 紀錄被外部改動（工作區 Tab 確認覆寫）時重新對齊卡片內容
  if (t.zh !== lastZh.current) { lastZh.current = t.zh; setVal(t.zh); }

  // 側欄在非工作分頁是 display:none（量測陷阱）：只在可見時撐高，切回工作區時補算
  useLayoutEffect(() => { if (active) autoGrow(taRef.current); }, [val, scale, active]);

  const onKeyDown = (e) => {
    // Shift+Tab 是反向移動焦點，不觸發更新（與工作區句段的 Tab 確認同一原則）
    if (e.key === 'Tab' && !e.shiftKey) {
      if (val.trim()) updateTmZh(t.id, val);
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const { lastFocusedSegId, documents, currentDocId } = useStore.getState();
      const doc = documents.find(d => d.id === currentDocId);
      const seg = doc && doc.segments.find(x => x.id === lastFocusedSegId);
      const segTa = document.querySelector(`#seg-list textarea[data-seg="${lastFocusedSegId}"]`);
      if (!seg || !segTa) return;
      // 套用即是編輯：已確認句段退回未確認（保留 tmId），需重按 Tab 重新校對
      flushSync(() => updateSegZh(lastFocusedSegId, val));
      segTa.focus();
    }
  };

  return (
    <div className="tm-card" data-tmid={t.id}>
      <div className="tm-card-src">
        <span className="mini-label">原文
          {linked && <span className="tm-linked" title="聚焦句段連結中的翻譯記憶"><i className="bi bi-pin-angle"></i> 本句連結</span>}
        </span>
        {t.ja}
      </div>
      <div className="tm-card-tgt">
        <span className="mini-label">譯文（Tab 更新・Enter 套用）</span>
        <textarea ref={taRef} data-tmid={t.id} value={val}
                  onChange={e => setVal(e.target.value)} onKeyDown={onKeyDown} />
      </div>
      <div className="tm-card-foot">
        <span>出處：{t.source || '—'}</span>
        {score != null && <span className="tm-pct">TM {Math.round(score * 100)}%</span>}
      </div>
    </div>
  );
}

export default function TmSidebar() {
  const currentTab = useStore(s => s.currentTab);
  const documents = useStore(s => s.documents);
  const tmSegments = useStore(s => s.tmSegments);
  const currentDocId = useStore(s => s.currentDocId);
  const lastFocusedSegId = useStore(s => s.lastFocusedSegId);

  const [pinned, setPinned] = useState(false);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('similar');   // 'similar' | 'search'
  const [scaleIdx, setScaleIdx] = useState(0);
  // IME 相容結構：搜尋框常駐（query）＋只依 committed 重繪結果區，組字期間不重繪
  const [query, setQuery] = useState('');
  const [committed, setCommitted] = useState('');
  const composingRef = useRef(false);

  const inWork = currentTab === 'work';
  const isOpen = inWork && open;
  if (!inWork && (open || pinned)) { setOpen(false); setPinned(false); }

  const doc = documents.find(d => d.id === currentDocId) || null;
  const seg = doc ? doc.segments.find(x => x.id === lastFocusedSegId) : null;
  const scale = SIDE_SCALES[scaleIdx];

  /* 把手：hover 展開對應模式，點擊切換固定/隱藏；點另一把手則切換模式 */
  const handleEnter = (m) => { if (!pinned) { setMode(m); setOpen(true); } };
  const handleClick = (m) => {
    if (mode !== m) { setMode(m); setPinned(true); setOpen(true); }
    else { const p = !pinned; setPinned(p); setOpen(p); }
  };
  const handleCls = (m) =>
    'tm-handle' + (inWork ? ' visible' : '') + (isOpen ? ' shifted' : '') + (pinned && mode === m ? ' active' : '');

  let body;
  if (mode === 'search') {
    const kwT = committed.trim();
    const found = kwT
      ? tmSegments.filter(t => (!doc || samePair(t, doc)) && (t.ja.includes(kwT) || t.zh.includes(kwT)))
      : null;
    body = (
      <>
        <input type="text" className="tm-search" id="tm-sidebar-search" placeholder="輸入原文或譯文關鍵字…"
               value={query}
               onCompositionStart={() => { composingRef.current = true; }}
               onCompositionEnd={e => { composingRef.current = false; setCommitted(e.target.value); }}
               onChange={e => { setQuery(e.target.value); if (!composingRef.current) setCommitted(e.target.value); }} />
        <div id="tm-search-results">
          {!kwT
            ? <div className="tm-sidebar-empty">輸入原文或譯文關鍵字<br />搜尋翻譯記憶</div>
            : found.length
              ? found.map(t => <TmCard key={t.id} t={t} score={seg ? similarity(seg.ja, t.ja) : null} scale={scale} active={inWork}
                                       linked={!!seg && seg.tmId === t.id} />)
              : <div className="tm-sidebar-empty">找不到符合的翻譯記憶。</div>}
        </div>
      </>
    );
  } else if (!seg) {
    body = <div className="tm-sidebar-empty">點擊左側任一句段的譯文欄，<br />這裡會列出相似的翻譯記憶。</div>;
  } else {
    const matches = tmSegments
      .filter(t => samePair(t, doc))
      .map(t => ({ t, score: similarity(seg.ja, t.ja) }))
      .filter(m => m.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
    body = matches.length
      ? matches.map(m => <TmCard key={m.t.id} t={m.t} score={m.score} scale={scale} active={inWork}
                                 linked={seg.tmId === m.t.id} />)
      : <div className="tm-sidebar-empty">沒有與這一句相似的翻譯記憶。</div>;
  }

  return (
    <>
      <button className={handleCls('similar')} id="tm-handle"
              onMouseEnter={() => handleEnter('similar')} onClick={() => handleClick('similar')}>翻譯記憶</button>
      <button className={handleCls('search')} id="tm-handle-search"
              onMouseEnter={() => handleEnter('search')} onClick={() => handleClick('search')}>搜尋翻譯記憶</button>
      <aside className={'tm-sidebar' + (inWork ? ' visible' : '') + (isOpen ? ' open' : '')} id="tm-sidebar"
             style={{ '--side-scale': scale }}
             onMouseLeave={() => { if (!pinned) setOpen(false); }}>
        <div className="tm-sidebar-header">
          <span>翻譯記憶</span>
          <button className="side-scale-btn" id="tm-scale-btn"
                  onClick={e => { e.stopPropagation(); setScaleIdx((scaleIdx + 1) % SIDE_SCALES.length); }}>
            <i className="bi bi-zoom-in"></i> {scale}x
          </button>
        </div>
        <div className="tm-tabs">
          <button id="tm-tab-similar" className={mode === 'similar' ? 'active' : ''} onClick={() => setMode('similar')}>翻譯記憶</button>
          <button id="tm-tab-search" className={mode === 'search' ? 'active' : ''} onClick={() => setMode('search')}>搜尋翻譯記憶</button>
        </div>
        <div className="tm-sidebar-body" id="tm-sidebar-body">{body}</div>
      </aside>
    </>
  );
}
