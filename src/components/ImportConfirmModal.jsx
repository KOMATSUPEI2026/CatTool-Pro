import { pairSummary } from '../importers.js';

/* V60 匯入確認 Modal（術語庫/翻譯記憶共用）：解析後先預覽摘要、按確認才入庫。
   確認型 Modal（取消/確定雙鈕）不掛右上 X（V52 Modal 關閉規範）。
   staged = { fileName, fresh:[...], dupCount, skippedLang, skippedSheets:[] } */
export default function ImportConfirmModal({ title, staged, onConfirm, onClose }) {
  const { fileName, fresh, dupCount, skippedLang, skippedSheets } = staged;
  const pairs = pairSummary(fresh);
  return (
    <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-card modal-card-center export-modal" id="import-confirm-modal">
        <h3>{title}</h3>
        <div className="import-summary">
          <p className="import-file"><i className="bi bi-file-earmark-text"></i> {fileName}</p>
          {fresh.length > 0 ? (
            <>
              <p>將新增 <b>{fresh.length}</b> 筆：</p>
              <ul>
                {pairs.map(p => <li key={p.pair}>{p.pair}｜{p.count} 筆</li>)}
              </ul>
            </>
          ) : (
            <p>沒有可新增的資料</p>
          )}
          {dupCount > 0 && <p className="import-skip">重複跳過 {dupCount} 筆（庫內已有相同原文＋譯文）</p>}
          {skippedLang > 0 && <p className="import-skip">跳過 {skippedLang} 筆（不支援的語系代碼）</p>}
          {skippedSheets.length > 0 &&
            <p className="import-skip">略過工作表：{skippedSheets.join('、')}（分頁名非語言對格式）</p>}
        </div>
        <div className="modal-actions modal-actions-center">
          <button className="btn outline" id="import-confirm-cancel" onClick={onClose}>取消匯入</button>
          <button className="btn seal" id="import-confirm-ok" disabled={fresh.length === 0} onClick={onConfirm}>
            確定匯入
          </button>
        </div>
      </div>
    </div>
  );
}
