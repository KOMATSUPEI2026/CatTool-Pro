import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store.js';
import { fetchSegHistory, saveSegmentNow } from '../cloud.js';
import { flushSync } from 'react-dom';

const SIDE_SCALES = [1, 1.2, 1.4];

const fmtTime = (iso) => {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/* 歷史紀錄側邊欄（右側第三把手）：顯示聚焦句段最近 5 筆「被覆蓋的已確認舊譯文」
   （segment_history 由 DB trigger 寫入），點「還原」把舊譯文帶回譯文欄。
   還原即是編輯：依 V28 規則退回未確認（tmId 保留），需重按 Tab 重新校對；
   還原同時逐句即存，被換下的現行確認版會自動進歷史，不會弄丟 */
export default function HistorySidebar() {
  const currentTab = useStore(s => s.currentTab);
  const documents = useStore(s => s.documents);
  const currentDocId = useStore(s => s.currentDocId);
  const lastFocusedSegId = useStore(s => s.lastFocusedSegId);
  const token = useStore(s => s.auth.token);
  const updateSegZh = useStore(s => s.updateSegZh);

  const [pinned, setPinned] = useState(false);
  const [open, setOpen] = useState(false);
  const [scaleIdx, setScaleIdx] = useState(0);
  const [entries, setEntries] = useState(null);   // null=載入中/未載入
  const [error, setError] = useState(null);
  const [refreshSeq, setRefreshSeq] = useState(0);

  const inWork = currentTab === 'work';
  const isOpen = inWork && open;
  if (!inWork && (open || pinned)) { setOpen(false); setPinned(false); }

  const doc = documents.find(d => d.id === currentDocId) || null;
  const segIdx = doc ? doc.segments.findIndex(x => x.id === lastFocusedSegId) : -1;
  const seg = segIdx >= 0 ? doc.segments[segIdx] : null;
  const scale = SIDE_SCALES[scaleIdx];

  /* Tab 確認/還原的 upsert 與 trigger 寫入在途，稍等再撈避免差一筆；
     confirmed 進 deps＝側欄開著按 Tab 確認後自動跟上新歷史 */
  const segId = seg ? seg.id : null;
  const confirmed = seg ? seg.confirmed : false;
  useEffect(() => {
    if (!isOpen || !segId || !token) return;
    let stale = false;
    setEntries(null);
    setError(null);
    const timer = setTimeout(() => {
      fetchSegHistory(segId)
        .then(rows => { if (!stale) setEntries(rows); })
        .catch(err => { if (!stale) { setEntries([]); setError(err.message || String(err)); } });
    }, 400);
    return () => { stale = true; clearTimeout(timer); };
  }, [isOpen, segId, token, confirmed, refreshSeq]);

  const onRestore = (entry) => {
    const segTa = document.querySelector(`#seg-list textarea[data-seg="${segId}"]`);
    // 還原即是編輯：退回未確認（保留 tmId），與 TM 側欄 Enter 套用同一原則
    flushSync(() => updateSegZh(segId, entry.zh || ''));
    if (segTa) segTa.focus();
    Promise.resolve(saveSegmentNow(segId)).then(() => setRefreshSeq(n => n + 1));
  };

  const handleCls = () =>
    'hist-handle' + (inWork ? ' visible' : '') + (isOpen ? ' shifted' : '') + (pinned ? ' active' : '');

  let body;
  if (!token) {
    body = <div className="hist-empty">歷史紀錄存放在雲端。<br />登入 Google 帳號後，<br />這裡會列出每句最近 5 筆舊譯文。</div>;
  } else if (!seg) {
    body = <div className="hist-empty">點擊左側任一句段的譯文欄，<br />這裡會列出該句的歷史譯文。</div>;
  } else if (error) {
    body = <div className="hist-empty">歷史載入失敗：{error}</div>;
  } else if (entries === null) {
    body = <div className="hist-empty">載入中…</div>;
  } else if (entries.length === 0) {
    body = <div className="hist-empty">這一句還沒有歷史譯文。<br />按 Tab 確認過的譯文再被修改時，<br />舊版本會自動留在這裡。</div>;
  } else {
    body = entries.map(en => (
      <div className="hist-card" key={en.id}>
        <div className="hist-card-zh">
          <span className="mini-label">舊譯文</span>
          {en.zh || '（空白）'}
        </div>
        <div className="hist-card-foot">
          <span>{fmtTime(en.saved_at)}</span>
          <button className="hist-restore-btn" onClick={() => onRestore(en)}>還原</button>
        </div>
      </div>
    ));
  }

  return (
    <>
      <button className={handleCls()} id="hist-handle"
              onMouseEnter={() => { if (!pinned) setOpen(true); }}
              onClick={() => { const p = !pinned; setPinned(p); setOpen(p); }}>歷史紀錄</button>
      <aside className={'hist-sidebar' + (inWork ? ' visible' : '') + (isOpen ? ' open' : '')} id="hist-sidebar"
             style={{ '--side-scale': scale }}
             onMouseLeave={() => { if (!pinned) setOpen(false); }}>
        <div className="hist-sidebar-header">
          <span>歷史紀錄</span>
          <span style={{ display: 'inline-flex', gap: 6 }}>
            <button className="side-scale-btn" id="hist-refresh-btn" title="重新整理"
                    onClick={e => { e.stopPropagation(); setRefreshSeq(n => n + 1); }}>
              <i className="bi bi-arrow-clockwise"></i>
            </button>
            <button className="side-scale-btn" id="hist-scale-btn"
                    onClick={e => { e.stopPropagation(); setScaleIdx((scaleIdx + 1) % SIDE_SCALES.length); }}>
              <i className="bi bi-zoom-in"></i> {scale}x
            </button>
          </span>
        </div>
        {seg &&
          <div className="hist-seg-info">第 {segIdx + 1} 句：<span className="hist-seg-src">{seg.ja}</span></div>}
        <div className="hist-sidebar-body" id="hist-sidebar-body">{body}</div>
      </aside>
    </>
  );
}
