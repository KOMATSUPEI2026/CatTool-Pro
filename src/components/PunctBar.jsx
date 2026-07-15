import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store.js';
import { insertPunct } from '../workActions.js';

/* 快捷標點符號列：10 格對應 Ctrl(Mac)/Alt(Win)+Shift+1~0；session 內有效，重新整理回預設 */
const DEFAULT_KEYS = ['，','。','；','：','、','「」','『』','！','？','“”'];

/* 設定快捷符號 Modal（沿用既有 modal 樣式） */
function PunctModal({ idx, value, onCancel, onSave }) {
  const [val, setVal] = useState(value || '');
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current.focus(); inputRef.current.select(); }, []);
  return (
    <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="modal-card">
        <h3>設定快捷符號（第 {idx + 1} 格）</h3>
        <div className="modal-field">
          <label>符號內容（最多 4 字；配對括號輸入整組如「」；留空＝清空格位）</label>
          <input type="text" id="punct-input" maxLength={4} ref={inputRef}
                 value={val} onChange={e => setVal(e.target.value)} />
        </div>
        <div className="modal-actions">
          <button className="btn outline" id="punct-cancel" onClick={onCancel}>取消</button>
          <button className="btn vermilion" id="punct-save" onClick={() => onSave(val.trim())}>儲存</button>
        </div>
      </div>
    </div>
  );
}

export default function PunctBar() {
  const currentTab = useStore(s => s.currentTab);
  const [keys, setKeys] = useState(DEFAULT_KEYS);
  const [editing, setEditing] = useState(false);
  const [modalIdx, setModalIdx] = useState(null);
  const keysRef = useRef(keys);
  keysRef.current = keys;

  /* 快捷鍵 Ctrl/Alt+Shift+1~0（Digit0＝第 10 格）。術語卡片顯示時術語優先。
     比照術語快捷鍵不檢查 isComposing：中文輸入法下事件標記不可靠，且此組合不參與組字 */
  useEffect(() => {
    const onKeyDown = (e) => {
      if (useStore.getState().termTip) return;
      if (!(e.ctrlKey || e.altKey) || !e.shiftKey) return;
      const match = /^Digit([0-9])$/.exec(e.code);
      if (!match) return;
      const idx = (parseInt(match[1], 10) + 9) % 10;   // 1→0 … 9→8、0→9
      if (!keysRef.current[idx]) return;
      e.preventDefault();
      insertPunct(keysRef.current[idx]);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  /* 點擊：一般模式＝插入（空格子開設定）；編輯模式＝一律開設定。
     mousedown preventDefault 保住 textarea 焦點，插入後游標留在原處 */
  const onKeyClick = (idx) => {
    if (editing || !keys[idx]) { setModalIdx(idx); return; }
    insertPunct(keys[idx]);
  };

  return (
    <>
      <div id="punct-bar"
           className={(currentTab === 'work' ? 'show' : '') + (editing ? ' editing' : '')}
           onMouseDown={e => e.preventDefault()}>
        {keys.map((p, i) => (
          <button key={i} className={'punct-key' + (p ? '' : ' blank')} data-idx={i}
                  title={`Ctrl/Alt+Shift+${(i + 1) % 10}`} onClick={() => onKeyClick(i)}>
            {p || <i className="bi bi-plus"></i>}
            <span className="punct-num">{(i + 1) % 10}</span>
          </button>
        ))}
        <button className="punct-edit-toggle" id="punct-edit-toggle"
                title={editing ? '完成編輯' : '編輯快捷符號'} onClick={() => setEditing(!editing)}>
          <i className={'bi ' + (editing ? 'bi-check-lg' : 'bi-pencil')}></i>
        </button>
      </div>
      {modalIdx !== null &&
        <PunctModal idx={modalIdx} value={keys[modalIdx]}
                    onCancel={() => setModalIdx(null)}
                    onSave={val => {
                      setKeys(keys.map((k, i) => i === modalIdx ? val : k));
                      setModalIdx(null);
                    }} />}
    </>
  );
}
