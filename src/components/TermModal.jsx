import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store.js';

/* 新增／編輯術語 Modal（翻譯工作區：反白新增、提示卡編輯共用） */
export default function TermModal({ term, prefillJa, onCancel, onSubmit }) {
  const showToast = useStore(s => s.showToast);
  const isEdit = !!term;
  const [ja, setJa] = useState(isEdit ? term.ja : (prefillJa || ''));
  const [zh, setZh] = useState(isEdit ? term.zh : '');
  const [note, setNote] = useState(isEdit ? (term.note || '') : '');
  const zhRef = useRef(null);

  useEffect(() => { zhRef.current?.focus(); }, []);

  const submit = () => {
    const jaV = ja.trim(), zhV = zh.trim();
    if (!jaV || !zhV) { showToast('原文與譯名都不能空白'); return; }
    if (zhV.split(/[;；]/).map(x => x.trim()).filter(Boolean).length > 9) { showToast('中文譯名最多只能儲存 9 個'); return; }
    onSubmit(jaV, zhV, note.trim());
  };

  return (
    <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="modal-card">
        <h3>{isEdit ? '編輯術語' : '新增術語'}</h3>
        <div className="modal-field ja"><label>原文</label>
          <input id="modal-ja" value={ja} onChange={e => setJa(e.target.value)} /></div>
        <div className="modal-field"><label>譯名（可用「;」並列多個）</label>
          <input id="modal-zh" ref={zhRef} value={zh} placeholder="例：魄力;張力;氣勢" onChange={e => setZh(e.target.value)} /></div>
        <div className="modal-field"><label>備註（選填）</label>
          <input id="modal-note" value={note} onChange={e => setNote(e.target.value)} /></div>
        <div className="modal-actions">
          <button className="btn outline small" id="modal-cancel" onClick={onCancel}>取消</button>
          <button className="btn vermilion small" id="modal-confirm" onClick={submit}>{isEdit ? '儲存' : '新增'}</button>
        </div>
      </div>
    </div>
  );
}
