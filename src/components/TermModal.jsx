import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store.js';

/* 新增／編輯術語 Modal（翻譯工作區：反白新增、提示卡編輯共用）
   V54：備註下加 7 格標籤面板——面板＝共用標籤字彙表（存 prefs，跨裝置同步），
   羽毛筆鈕解鎖編輯格位、再按一次固定；一般狀態點格子＝把該標籤指派給這筆術語（單選，再點取消）。
   快捷鍵：Enter＝送出（新增/儲存；編輯格位中＝改為固定格位）、Esc＝取消關閉 */
export default function TermModal({ term, prefillJa, onCancel, onSubmit }) {
  const showToast = useStore(s => s.showToast);
  const prefs = useStore(s => s.prefs);
  const patchPrefs = useStore(s => s.patchPrefs);
  const isEdit = !!term;
  const [ja, setJa] = useState(isEdit ? term.ja : (prefillJa || ''));
  const [zh, setZh] = useState(isEdit ? term.zh : '');
  const [note, setNote] = useState(isEdit ? (term.note || '') : '');
  const [tag, setTag] = useState(isEdit ? (term.tag || '') : '');
  const [paletteDraft, setPaletteDraft] = useState(null);   // 非 null＝格位編輯中
  const zhRef = useRef(null);

  useEffect(() => { zhRef.current?.focus(); }, []);

  const tagEditing = paletteDraft !== null;
  const palette = tagEditing ? paletteDraft : prefs.termTagPalette;

  const toggleTagEditing = () => {
    if (tagEditing) {
      patchPrefs({ termTagPalette: paletteDraft.map(x => x.trim()) });
      setPaletteDraft(null);
    } else {
      setPaletteDraft([...prefs.termTagPalette]);
    }
  };

  const submit = () => {
    const jaV = ja.trim(), zhV = zh.trim();
    if (!jaV || !zhV) { showToast('原文與譯名都不能空白'); return; }
    if (zhV.split(/[;；]/).map(x => x.trim()).filter(Boolean).length > 9) { showToast('中文譯名最多只能儲存 9 個'); return; }
    onSubmit(jaV, zhV, note.trim(), tag);
  };

  // Enter/Esc 掛在 Modal 容器（初始焦點在譯名框，事件冒泡可達）；IME 組字中的 Enter 不觸發
  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); onCancel(); return; }
    if (e.key === 'Enter') {
      if (e.nativeEvent.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      if (tagEditing) toggleTagEditing(); else submit();
    }
  };

  return (
    <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="modal-card" onKeyDown={onKeyDown}>
        <h3>{isEdit ? '編輯術語' : '新增術語'}</h3>
        <div className="modal-field ja"><label>原文</label>
          <input id="modal-ja" value={ja} onChange={e => setJa(e.target.value)} /></div>
        <div className="modal-field"><label>譯名（可用「;」並列多個）</label>
          <input id="modal-zh" ref={zhRef} value={zh} placeholder="例：魄力;張力;氣勢" onChange={e => setZh(e.target.value)} /></div>
        <div className="modal-field"><label>備註（選填）</label>
          <input id="modal-note" value={note} onChange={e => setNote(e.target.value)} /></div>
        <div className="modal-field">
          <label>標籤（單選{tag ? `・目前：${tag}` : ''}）</label>
          <div className="tag-row" id="term-tag-row">
            {palette.map((v, i) => tagEditing
              ? <input key={i} className="tag-slot-input" maxLength={6} data-idx={i} value={paletteDraft[i]}
                       placeholder={`#${i + 1}`}
                       onChange={e => setPaletteDraft(paletteDraft.map((x, j) => j === i ? e.target.value : x))} />
              : <button key={i} type="button" data-idx={i}
                        className={'tag-slot' + (v ? '' : ' blank') + (v && v === tag ? ' selected' : '')}
                        title={v ? (tag === v ? '取消指派' : '指派此標籤') : '空格位（按羽毛筆編輯）'}
                        onClick={() => v && setTag(tag === v ? '' : v)}>
                  {v}
                </button>)}
            <button type="button" className={'tag-edit-toggle' + (tagEditing ? ' active' : '')} id="tag-edit-toggle"
                    title={tagEditing ? '固定標籤格位' : '編輯標籤格位'} onClick={toggleTagEditing}>
              <i className="bi bi-feather"></i>
            </button>
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn outline small" id="modal-cancel" onClick={onCancel}>取消</button>
          <button className="btn vermilion small" id="modal-confirm" onClick={submit}>{isEdit ? '儲存' : '新增'}</button>
        </div>
      </div>
    </div>
  );
}
