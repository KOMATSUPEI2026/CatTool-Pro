/* 快捷鍵說明 Modal（頂列「快捷鍵」按鈕開啟） */
const ROWS = [
  { scene: '全站', keys: ['Mac Cmd+S', 'Win Ctrl+S'],                  desc: '儲存至雲端' },
  { scene: '譯文欄', keys: ['Tab'],                                    desc: '確認句段並存入翻譯記憶' },
  { scene: '術語快速帶入',     keys: ['Mac Ctrl+1~9', 'Win Alt+1~9'],            desc: '' },
  { scene: '快捷標點列',         keys: ['Mac Ctrl+Shift+1~0', 'Win Alt+Shift+1~0'], desc: '' },
  { scene: '記憶側欄卡片',       keys: ['Tab'],                                    desc: '更新該筆翻譯記憶' },
  { scene: '',       keys: ['Enter'],                                  desc: '套用譯文至目前句段' },
  { scene: '編輯/分割視窗',      keys: ['Enter'],                                  desc: '於游標處分割句子' }
];

export default function ShortcutsModal({ onClose }) {
  return (
    <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-card modal-card-wide">
        <button className="modal-close-x" data-role="close" title="關閉" onClick={onClose}><i className="bi bi-x-circle-fill"></i></button>
        <h3>快捷鍵</h3>
        <div className="shortcut-list">
          {ROWS.map((r, i) => (
            <div className="shortcut-row" key={i}>
              <span className="shortcut-scene">{r.scene}</span>
              <span>
                {r.keys.map((k, j) => (
                  <span key={j}>{j > 0 && '／'}<span className="kbd">{k}</span></span>
                ))}
                {r.desc ? '　' + r.desc : ''}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
