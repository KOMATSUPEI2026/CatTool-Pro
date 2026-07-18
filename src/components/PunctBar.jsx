import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store.js';
import { insertPunct } from '../workActions.js';

/* 快捷標點符號列（V54 改版）：三組×10 格存 prefs（跨裝置同步），「上下組」鈕循環切換；
   預設隱藏於視窗下緣外，滑鼠靠近底部彈出，圖釘鈕可固定常駐；
   快捷鍵 Ctrl(Mac)/Alt(Win)+Shift+1~0 一律作用於「目前顯示中的那一組」 */

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
          <label>符號內容（最多 4 字；留空＝清空格位）</label>
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
  const prefs = useStore(s => s.prefs);
  const patchPrefs = useStore(s => s.patchPrefs);
  const [editing, setEditing] = useState(false);
  const [modalIdx, setModalIdx] = useState(null);
  const [hover, setHover] = useState(false);

  const keys = prefs.punctSets[prefs.punctSetIdx];
  const keysRef = useRef(keys);
  keysRef.current = keys;

  const inWork = currentTab === 'work';
  // 顯示條件：固定中／滑鼠靠底彈出中／編輯中／設定 Modal 開啟中（後兩者防編輯到一半縮走）
  const shown = inWork && (prefs.punctPinned || hover || editing || modalIdx !== null);

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

  const onSlotSave = (val) => {
    patchPrefs({
      punctSets: prefs.punctSets.map((g, gi) =>
        gi === prefs.punctSetIdx ? g.map((k, i) => i === modalIdx ? val : k) : g)
    });
    setModalIdx(null);
  };

  return (
    <>
      {/* 滑鼠靠近視窗底部的觸發區（固定中不需要；z 在 bar 之下）。
          區域與 bar 在底部重疊，離開其一時若進的是另一方則不收——避免游標在兩者間移動時閃跳 */}
      {inWork && !prefs.punctPinned &&
        <div id="punct-hover-zone"
             onMouseEnter={() => setHover(true)}
             onMouseLeave={e => { if (!(e.relatedTarget instanceof Element && e.relatedTarget.closest('#punct-bar'))) setHover(false); }} />}
      <div id="punct-bar"
           className={(shown ? 'show' : '') + (editing ? ' editing' : '')}
           onMouseDown={e => e.preventDefault()}
           onMouseEnter={() => setHover(true)}
           onMouseLeave={e => { if (!(e.relatedTarget instanceof Element && e.relatedTarget.closest('#punct-hover-zone'))) setHover(false); }}>
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
        <button className="punct-edit-toggle" id="punct-set-cycle"
                title={`切換符號組（目前第 ${prefs.punctSetIdx + 1}／3 組）`}
                onClick={() => patchPrefs({ punctSetIdx: (prefs.punctSetIdx + 1) % 3 })}>
          <i className="bi bi-chevron-bar-expand"></i>
          <span className="punct-num">{prefs.punctSetIdx + 1}</span>
        </button>
        <button className={'punct-edit-toggle' + (prefs.punctPinned ? ' pinned' : '')} id="punct-pin"
                title={prefs.punctPinned ? '取消固定（移開自動隱藏）' : '固定標點符號列'}
                onClick={() => patchPrefs({ punctPinned: !prefs.punctPinned })}>
          <i className="bi bi-pin-angle-fill"></i>
        </button>
      </div>
      {modalIdx !== null &&
        <PunctModal idx={modalIdx} value={keys[modalIdx]}
                    onCancel={() => setModalIdx(null)}
                    onSave={onSlotSave} />}
    </>
  );
}
