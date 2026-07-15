import { useRef, useState } from 'react';
import { useStore } from '../store.js';

const SIDE_SCALES = [1, 1.2, 1.4];

/* 唯讀整篇卡片：以檔案為單位，一次性完整顯示整篇原文與譯文 */
function PvDocCards({ doc, titlePrefix }) {
  const fullJa = doc.segments.map(s => s.ja).join('\n');
  const zhParts = doc.segments.map(s => (s.zh && s.zh.trim()) ? s.zh : '（尚未翻譯）');
  const allEmpty = doc.segments.every(s => !(s.zh && s.zh.trim()));
  return (
    <>
      <div className="pv-doc-title">{titlePrefix}：{doc.name}</div>
      <div className="pv-card">
        <div className="pv-card-src"><span className="mini-label">原文</span>{fullJa}</div>
        <div className={'pv-card-tgt' + (allEmpty ? ' empty-zh' : '')}>
          <span className="mini-label">譯文</span>{zhParts.join('\n')}
        </div>
      </div>
    </>
  );
}

/* 頁面檢視側邊欄（左側）：上下頁檢視／跨頁搜尋檢視 */
export default function PvSidebar() {
  const currentTab = useStore(s => s.currentTab);
  const documents = useStore(s => s.documents);
  const currentDocId = useStore(s => s.currentDocId);

  const [pinned, setPinned] = useState(false);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('adjacent');   // 'adjacent' | 'specific'
  const [scaleIdx, setScaleIdx] = useState(0);
  // IME 相容結構：搜尋框常駐（query）＋只依 committed 重繪結果區，組字期間不重繪
  const [query, setQuery] = useState('');
  const [committed, setCommitted] = useState('');
  const composingRef = useRef(false);

  const inWork = currentTab === 'work';
  const isOpen = inWork && open;
  if (!inWork && (open || pinned)) { setOpen(false); setPinned(false); }

  const doc = documents.find(d => d.id === currentDocId) || null;
  const scale = SIDE_SCALES[scaleIdx];

  const handleEnter = (m) => { if (!pinned) { setMode(m); setOpen(true); } };
  const handleClick = (m) => {
    if (mode !== m) { setMode(m); setPinned(true); setOpen(true); }
    else { const p = !pinned; setPinned(p); setOpen(p); }
  };
  const handleCls = (m) =>
    'pv-handle' + (inWork ? ' visible' : '') + (isOpen ? ' shifted' : '') + (pinned && mode === m ? ' active' : '');

  let body;
  if (mode === 'adjacent') {
    if (!doc) {
      body = <div className="pv-empty">尚未開啟任何檔案。</div>;
    } else {
      const idx = documents.findIndex(d => d.id === doc.id);
      const prev = idx > 0 ? documents[idx - 1] : null;
      const next = idx < documents.length - 1 ? documents[idx + 1] : null;
      body = (!prev && !next)
        ? <div className="pv-empty">這是唯一的檔案，<br />沒有上一頁或下一頁可供檢視。</div>
        : <>
            {prev ? <PvDocCards doc={prev} titlePrefix="上一頁" /> : <div className="pv-empty">（沒有上一頁）</div>}
            {next ? <PvDocCards doc={next} titlePrefix="下一頁" /> : <div className="pv-empty">（沒有下一頁）</div>}
          </>;
    }
  } else {
    /* 跨頁檢視搜尋跨度：檔名／語系代碼（srcLang、tgtLang）／原文或譯文內容 */
    const kw = committed.trim().toLowerCase();
    let results;
    if (!kw) {
      results = <div className="pv-empty">輸入檔名、語系代碼（如 en、zh-TW）<br />或原文／譯文內容，即可檢視符合的檔案。</div>;
    } else {
      const matches = documents.filter(d =>
        d.name.toLowerCase().includes(kw) ||
        (d.srcLang || 'ja').toLowerCase() === kw ||
        (d.tgtLang || 'zh-TW').toLowerCase() === kw ||
        d.segments.some(seg => seg.ja.toLowerCase().includes(kw) || (seg.zh || '').toLowerCase().includes(kw))
      );
      // 檔名完全相符者排最前，其次檔名部分相符，內容命中殿後
      matches.sort((a, b) => {
        const rank = d => d.name.toLowerCase() === kw ? 0 : (d.name.toLowerCase().includes(kw) ? 1 : 2);
        return rank(a) - rank(b);
      });
      const MAX = 3;
      results = matches.length
        ? <>
            {matches.slice(0, MAX).map(d => <PvDocCards key={d.id} doc={d} titlePrefix="跨頁檢視" />)}
            {matches.length > MAX &&
              <div className="pv-empty">還有 {matches.length - MAX} 個符合的檔案，請輸入更精確的關鍵字。</div>}
          </>
        : <div className="pv-empty">找不到符合的檔案或內容。</div>;
    }
    body = (
      <>
        <input type="text" className="pv-search" id="pv-search" placeholder="輸入檔名、語系代碼或內文…"
               value={query}
               onCompositionStart={() => { composingRef.current = true; }}
               onCompositionEnd={e => { composingRef.current = false; setCommitted(e.target.value); }}
               onChange={e => { setQuery(e.target.value); if (!composingRef.current) setCommitted(e.target.value); }} />
        <div id="pv-search-results">{results}</div>
      </>
    );
  }

  return (
    <>
      <button className={handleCls('adjacent')} id="pv-handle-adjacent"
              onMouseEnter={() => handleEnter('adjacent')} onClick={() => handleClick('adjacent')}>上下頁檢視</button>
      <button className={handleCls('specific')} id="pv-handle-specific"
              onMouseEnter={() => handleEnter('specific')} onClick={() => handleClick('specific')}>跨頁檢視</button>
      <aside className={'pv-sidebar' + (inWork ? ' visible' : '') + (isOpen ? ' open' : '')} id="pv-sidebar"
             style={{ '--side-scale': scale }}
             onMouseLeave={() => { if (!pinned) setOpen(false); }}>
        <div className="pv-sidebar-header">
          <span>頁面檢視</span>
          <button className="side-scale-btn" id="pv-scale-btn"
                  onClick={e => { e.stopPropagation(); setScaleIdx((scaleIdx + 1) % SIDE_SCALES.length); }}>
            <i className="bi bi-zoom-in"></i> {scale}x
          </button>
        </div>
        <div className="pv-tabs">
          <button id="pv-tab-adjacent" className={mode === 'adjacent' ? 'active' : ''} onClick={() => setMode('adjacent')}>上下頁檢視</button>
          <button id="pv-tab-specific" className={mode === 'specific' ? 'active' : ''} onClick={() => setMode('specific')}>跨頁檢視</button>
        </div>
        <div className="pv-body" id="pv-body">{body}</div>
      </aside>
    </>
  );
}
