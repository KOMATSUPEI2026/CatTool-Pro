import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '../store.js';
import { insertIntoSeg } from '../workActions.js';

/* 術語提示卡：hover／點擊術語高亮顯示，左側為編輯/刪除入口。
   先在畫面外渲染量尺寸，再定位到高亮字上方（放不下改下方） */
export default function TermTip({ onEdit, onDelete }) {
  const tip = useStore(s => s.termTip);
  const setTermTip = useStore(s => s.setTermTip);
  const termBase = useStore(s => s.termBase);
  const wrapRef = useRef(null);
  const [pos, setPos] = useState(null);

  const alts = tip ? (tip.zh || '').split(/[;；]/).map(s => s.trim()).filter(Boolean).slice(0, 9) : [];
  const show = !!tip && alts.length > 0;

  useLayoutEffect(() => {
    if (!show) { setPos(null); return; }
    const r = tip.anchor;
    const w = wrapRef.current.getBoundingClientRect();
    let top = r.top - w.height - 8;
    if (top < 8) top = r.bottom + 8;
    let left = r.left - 30;
    if (left < 8) left = 8;
    if (left + w.width > window.innerWidth - 8) left = window.innerWidth - w.width - 8;
    setPos({ top, left });
  }, [show, tip]);

  /* 點擊卡片與高亮以外處收起 */
  useEffect(() => {
    if (!show) return;
    const onDocClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target) && !e.target.classList.contains('term-hit')) setTermTip(null);
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [show, setTermTip]);

  /* 卡片顯示中：Ctrl(Mac)/Alt(Windows)+1~9 快速帶入對應編號的譯名。
     不檢查 isComposing：中文輸入法模式下事件標記不可靠，且此組合不參與注音組字 */
  useEffect(() => {
    if (!show) return;
    const onKeyDown = (e) => {
      if (!e.altKey && !e.ctrlKey) return;
      const match = /^Digit([1-9])$/.exec(e.code);
      if (!match) return;
      const idx = parseInt(match[1], 10) - 1;
      if (idx >= alts.length) return;
      e.preventDefault();
      e.stopPropagation();
      insertIntoSeg(tip.segId, alts[idx]);
      setTermTip(null);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  });

  if (!show) return null;
  const term = termBase.find(t => t.id === tip.termId) || null;

  return (
    <div className="term-tip-wrap" ref={wrapRef}
         style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}>
      <div className="tip-side-actions">
        <button className="tip-action-edit" title="編輯術語"
                onClick={e => { e.stopPropagation(); setTermTip(null); onEdit(term, tip.ja); }}>
          <i className="bi bi-pencil"></i>
        </button>
        <button className="tip-action-del" title="刪除術語"
                onClick={e => { e.stopPropagation(); setTermTip(null); if (term) onDelete(term); }}>
          <i className="bi bi-x-lg"></i>
        </button>
      </div>
      <div className="term-tip">
        <div className="zh-list">
          {alts.map((a, i) => (
            <span key={i}>
              {i > 0 && <span className="sep">｜</span>}
              <span className="zh-chip" title={`Ctrl/Alt+${i + 1} 帶入`}
                    onClick={e => { e.stopPropagation(); insertIntoSeg(tip.segId, a); setTermTip(null); }}>
                <span className="chip-num">{i + 1}</span>{a}
              </span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
