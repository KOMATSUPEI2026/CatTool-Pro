import { useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '../store.js';
import { autoGrow } from '../workActions.js';
import { autoSaveAfterSegTool } from '../cloud.js';

/* 句段整理五功能 Modal（編輯/分割、排序、合併、新增、刪除）。
   送出後的資料變動一律走 store actions；狀態規則（V28 延伸）集中在 store 註解。
   各 Modal 送出後 autoSaveAfterSegTool 即時存雲端（已登入才觸發） */

/* 共用外殼：標題 + 提示 + 可捲動清單 + （選配 footer）+ 錯誤列 + 取消/送出 */
function SegToolModal({ title, hint, error, listRef, children, footer, onCancel, onSubmit }) {
  return (
    <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="modal-card modal-card-xl">
        <h3>{title}</h3>
        <p className="seg-tool-hint">{hint}</p>
        <div className="seg-tool-list" ref={listRef}>{children}</div>
        {footer}
        <div className="seg-tool-err" style={{ display: error ? 'block' : 'none' }}>{error}</div>
        <div className="modal-actions">
          <button className="btn outline" data-role="cancel" onClick={onCancel}>取消</button>
          <button className="btn vermilion" data-role="submit" onClick={onSubmit}>送出</button>
        </div>
      </div>
    </div>
  );
}

/* 多選清單項（合併/刪除共用）；flags 只在刪除 Modal 用來警示 */
function SelectableItem({ seg, index, selected, onToggle, flags }) {
  return (
    <div className={'seg-tool-item selectable' + (selected ? ' selected' : '')}
         data-segid={seg.id} onClick={onToggle}>
      <span className="seg-tool-num">{index + 1}</span>
      <div className="seg-tool-text">{seg.ja}</div>
      {flags}
      <i className="bi bi-check-lg seg-tool-check"></i>
    </div>
  );
}

function useSelection() {
  const [sel, setSel] = useState(() => new Set());
  const toggle = (id) => setSel(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  return [sel, toggle];
}

/* --- 編輯／分割句子：游標放入句內按 Enter 分割；改動原文＝退回未確認（V28 延伸） --- */
export function SegEditModal({ doc, onClose }) {
  const applySegEdit = useStore(s => s.applySegEdit);
  // 工作副本：segId 對回原句段；分割出的新句 segId 為 null（送出時才生效）
  const [items, setItems] = useState(() => doc.segments.map(s => ({ segId: s.id, ja: s.ja })));
  const [error, setError] = useState('');
  const [focusIdx, setFocusIdx] = useState(null);
  const listRef = useRef(null);

  useLayoutEffect(() => {
    listRef.current.querySelectorAll('textarea').forEach(autoGrow);
    if (focusIdx != null) {
      const ta = listRef.current.querySelector(`textarea[data-idx="${focusIdx}"]`);
      if (ta) { ta.focus(); ta.setSelectionRange(0, 0); }
      setFocusIdx(null);
    }
  }, [items, focusIdx]);

  const onKeyDown = (e, idx) => {
    if (e.key !== 'Enter') return;
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;   // IME 組字確認的 Enter 交還輸入法，不觸發分割
    e.preventDefault();
    const pos = e.target.selectionStart;
    const text = e.target.value;
    if (pos <= 0 || pos >= text.length) return;                   // 頭尾分割無意義
    const next = items.slice();
    next[idx] = { ...next[idx], ja: text.slice(0, pos) };
    next.splice(idx + 1, 0, { segId: null, ja: text.slice(pos) });
    setItems(next);
    setFocusIdx(idx + 1);
  };

  const submit = () => {
    if (!items.some(it => it.ja.trim())) { setError('至少要保留一個句段。'); return; }
    applySegEdit(items);
    autoSaveAfterSegTool();
    onClose();
  };

  return (
    <SegToolModal title="編輯／分割句子"
                  hint="可直接修改原文。游標放入句子內，再按 Enter 可分割句子。清空的句子送出後將被移除。"
                  error={error} listRef={listRef} onCancel={onClose} onSubmit={submit}>
      {items.map((it, i) => (
        <div className="seg-tool-item" key={i}>
          <span className="seg-tool-num">{i + 1}</span>
          <textarea data-idx={i} value={it.ja}
                    onChange={e => {
                      const next = items.slice();
                      next[i] = { ...next[i], ja: e.target.value };
                      setItems(next);
                    }}
                    onKeyDown={e => onKeyDown(e, i)} />
        </div>
      ))}
    </SegToolModal>
  );
}

/* --- 排序句子：拖曳排列；不動 confirmed/tmId --- */
export function SegOrderModal({ doc, onClose }) {
  const applySegOrder = useStore(s => s.applySegOrder);
  const [order, setOrder] = useState(() => doc.segments.map(s => s.id));
  const [dragId, setDragId] = useState(null);
  const listRef = useRef(null);
  const byId = new Map(doc.segments.map(s => [s.id, s]));

  const onDragOver = (e) => {
    e.preventDefault();
    if (!dragId) return;
    // 以滑鼠 Y 對其他項的中線找插入點（同 vanilla 邏輯，改為重排 state）
    const others = [...listRef.current.querySelectorAll('.seg-tool-item:not(.dragging)')];
    const after = others.find(el => e.clientY < el.getBoundingClientRect().top + el.offsetHeight / 2);
    const rest = order.filter(id => id !== dragId);
    const idx = after ? rest.indexOf(after.dataset.segid) : rest.length;
    const next = [...rest.slice(0, idx), dragId, ...rest.slice(idx)];
    if (next.join() !== order.join()) setOrder(next);
  };

  return (
    <SegToolModal title="排序句子" hint="按住任一句段上下拖曳調整順序，按「送出」後即刻生效。"
                  error="" listRef={listRef} onCancel={onClose}
                  onSubmit={() => { applySegOrder(order); autoSaveAfterSegTool(); onClose(); }}>
      <div onDragOver={onDragOver}>
        {order.map((id, i) => (
          <div className={'seg-tool-item' + (dragId === id ? ' dragging' : '')} key={id}
               draggable data-segid={id}
               onDragStart={e => {
                 setDragId(id);
                 e.dataTransfer.effectAllowed = 'move';
                 e.dataTransfer.setData('text/plain', '');   // Firefox 需要 setData 才會啟動拖曳
               }}
               onDragEnd={() => setDragId(null)}>
            <span className="seg-tool-num">{i + 1}</span>
            <div className="seg-tool-text">{byId.get(id).ja}</div>
          </div>
        ))}
      </div>
    </SegToolModal>
  );
}

/* --- 合併句子：多選且必須相鄰；合併句退回未確認 --- */
export function SegMergeModal({ doc, onClose }) {
  const mergeSegments = useStore(s => s.mergeSegments);
  const [sel, toggle] = useSelection();
  const [error, setError] = useState('');

  const submit = () => {
    const indices = doc.segments.map((s, i) => sel.has(s.id) ? i : -1).filter(i => i >= 0);
    if (indices.length < 2) { setError('請選取至少兩個句子。'); return; }
    if (!indices.every((v, k) => v === indices[0] + k)) {
      setError('相鄰的句子才可合併，請選取相鄰的句子。'); return;
    }
    mergeSegments([...sel]);
    autoSaveAfterSegTool();
    onClose();
  };

  return (
    <SegToolModal title="合併句子" hint="選取兩個以上「相鄰」的句子後送出，原文與譯文都會串接，合併後退回未確認。"
                  error={error} onCancel={onClose} onSubmit={submit}>
      {doc.segments.map((seg, i) =>
        <SelectableItem key={seg.id} seg={seg} index={i} selected={sel.has(seg.id)} onToggle={() => toggle(seg.id)} />)}
    </SegToolModal>
  );
}

/* --- 新增句子：點選插入位置（新句插在選取句之後），輸入原文後送出 --- */
export function SegAddModal({ doc, onClose }) {
  const addSegment = useStore(s => s.addSegment);
  const [pos, setPos] = useState(null);   // 0=第一句、i+1=插在第 i+1 句之後（單選）
  const [text, setText] = useState('');
  const [error, setError] = useState('');

  const submit = () => {
    if (pos === null) { setError('請先點選插入位置。'); return; }
    if (!text.trim()) { setError('請輸入新句原文。'); return; }
    addSegment(pos, text.trim());
    autoSaveAfterSegTool();
    onClose();
  };

  const posItem = (p, num, label) => (
    <div className={'seg-tool-item selectable' + (pos === p ? ' selected' : '')} data-pos={p}
         key={p} onClick={() => setPos(p)}>
      <span className="seg-tool-num">{num}</span>
      <div className="seg-tool-text">{label}</div>
      <i className="bi bi-check-lg seg-tool-check"></i>
    </div>
  );

  return (
    <SegToolModal title="新增句子"
                  hint="點選插入位置，會新增在已勾選的句子之後，新增在首句除外。新增的句子，譯文空白、未確認。"
                  error={error} onCancel={onClose} onSubmit={submit}
                  footer={<textarea className="seg-tool-newtext" placeholder="輸入新句原文…"
                                    value={text} onChange={e => setText(e.target.value)} />}>
      {posItem(0, '—', '（插入為第一句）')}
      {doc.segments.map((seg, i) => posItem(i + 1, i + 1, seg.ja))}
    </SegToolModal>
  );
}

/* --- 刪除句子：多選刪除；已有譯文/已確認者標示警示；TM 紀錄保留 --- */
export function SegDeleteModal({ doc, onClose }) {
  const deleteSegments = useStore(s => s.deleteSegments);
  const [sel, toggle] = useSelection();
  const [error, setError] = useState('');

  const submit = () => {
    if (sel.size === 0) { setError('請先選取要刪除的句子。'); return; }
    deleteSegments([...sel]);
    autoSaveAfterSegTool();
    onClose();
  };

  return (
    <SegToolModal title="刪除句子" hint="選取要刪除的句子後送出。刪除後無法復原，翻譯記憶的紀錄保持原樣。"
                  error={error} onCancel={onClose} onSubmit={submit}>
      {doc.segments.map((seg, i) =>
        <SelectableItem key={seg.id} seg={seg} index={i} selected={sel.has(seg.id)} onToggle={() => toggle(seg.id)}
                        flags={<>
                          {(seg.zh || '').trim() && <span className="seg-tool-flag">已有譯文</span>}
                          {seg.confirmed && <span className="seg-tool-flag">已確認</span>}
                        </>} />)}
    </SegToolModal>
  );
}
