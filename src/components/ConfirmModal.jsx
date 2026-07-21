/* 通用置中確認 Modal（取代原生 confirm；比照「重置確認狀態」樣式）
   內文置中；避免換行割裂＝各行文案寫短到不硬換行（見同步確認框），text-wrap:balance 為安全網 */
export default function ConfirmModal({ title, children, cancelLabel = '取消', okLabel = '確定', onCancel, onOk, wide = false }) {
  return (
    <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className={'modal-card modal-card-center' + (wide ? ' modal-card-wide' : '')}>
        <h3>{title}</h3>
        <p className="modal-confirm-text">{children}</p>
        <div className="modal-actions modal-actions-center">
          <button className="btn outline large" data-role="cancel" onClick={onCancel}>{cancelLabel}</button>
          <button className="btn vermilion large" data-role="ok" onClick={onOk}>{okLabel}</button>
        </div>
      </div>
    </div>
  );
}
