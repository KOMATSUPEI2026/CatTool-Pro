import { useStore } from '../store.js';
import { tryAutoLoadFromCloud, openLogoutConfirm } from '../cloud.js';

/* 帳號 Modal：email、重新載入雲端資料、登出（Supabase 版：試算表連結/貼網址重連已無對應概念） */
export default function AccountModal({ onClose }) {
  const email = useStore(s => s.auth.email);

  return (
    <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-card modal-card-wide">
        <h3>Google 帳號</h3>
        <p className="account-email"><i className="bi bi-person-check"></i> {email || '已連結 Google'}</p>
        <p className="account-hint">
          資料儲存於雲端資料庫，登入狀態自動維持；<br />
          「重新載入」會先比對雲端與本機，內容不同時才詢問是否覆蓋。
        </p>
        <div className="modal-actions">
          <button className="btn outline" data-role="reload"
                  onClick={() => { onClose(); tryAutoLoadFromCloud(); }}>重新載入雲端資料</button>
          <button className="btn outline" data-role="logout" onClick={() => { onClose(); openLogoutConfirm(); }}>登出</button>
          <button className="btn vermilion" data-role="close" onClick={onClose}>關閉</button>
        </div>
      </div>
    </div>
  );
}
