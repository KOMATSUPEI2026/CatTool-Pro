import { useState } from 'react';
import { useStore } from '../store.js';
import { loadSheetIds, relinkSpreadsheet, tryAutoLoadFromCloud, openLogoutConfirm } from '../cloud.js';

function LinkRow({ label, id }) {
  return (
    <div className="cloud-link-row">
      <span>{label}</span>
      {id
        ? <a href={`https://docs.google.com/spreadsheets/d/${id}`} target="_blank" rel="noopener noreferrer">
            開啟試算表 <i className="bi bi-box-arrow-up-right"></i>
          </a>
        : <span className="cloud-none">尚未建立（首次儲存時自動建立）</span>}
    </div>
  );
}

/* 帳號 Modal：email、三表連結狀態、貼網址重連（標記分頁自動辨識）、登出 */
export default function AccountModal({ onClose }) {
  const email = useStore(s => s.auth.email);
  const showToast = useStore(s => s.showToast);
  const [url, setUrl] = useState('');
  const ids = loadSheetIds();

  const relink = async () => {
    const u = url.trim();
    if (!u) { showToast('請先貼上試算表網址'); return; }
    if (await relinkSpreadsheet(u)) { onClose(); tryAutoLoadFromCloud(); }   // 重連成功→接載入流程（防覆蓋確認）
  };

  return (
    <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-card modal-card-wide">
        <h3>Google 帳號</h3>
        <p className="account-email"><i className="bi bi-person-check"></i> {email || '已連結 Google'}</p>
        <div className="cloud-links">
          <LinkRow label="文件庫" id={ids.docs} />
          <LinkRow label="術語庫" id={ids.terms} />
          <LinkRow label="翻譯記憶" id={ids.tm} />
        </div>
        <div className="modal-field">
          <label>重新連結試算表（貼上網址自動辨識，成功後會詢問是否載入）</label>
          <input type="text" id="relink-input" placeholder="https://docs.google.com/spreadsheets/d/…"
                 value={url} onChange={e => setUrl(e.target.value)} />
        </div>
        <div className="modal-actions">
          <button className="btn outline" data-role="relink" onClick={relink}>重新連結</button>
          <button className="btn outline" data-role="logout" onClick={() => { onClose(); openLogoutConfirm(); }}>登出</button>
          <button className="btn vermilion" data-role="close" onClick={onClose}>關閉</button>
        </div>
      </div>
    </div>
  );
}
