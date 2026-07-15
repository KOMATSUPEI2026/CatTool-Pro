import { useStore } from '../store.js';
import { requestGoogleLogin } from '../cloud.js';

/* 歡迎面板：進站首見，登入成功（cloud.js 收）或選訪客後收起 */
export default function WelcomeOverlay() {
  const visible = useStore(s => s.welcomeVisible);
  const hideWelcome = useStore(s => s.hideWelcome);
  if (!visible) return null;
  return (
    <div className="welcome-overlay" id="welcome-overlay">
      <div className="welcome-card">
        <span className="seal-mark">校</span>
        <h2>校譯台</h2>
        <p className="welcome-tagline">術語比對・翻譯記憶</p>
        <button className="btn vermilion large welcome-btn" id="welcome-google"
                onClick={() => requestGoogleLogin().catch(() => {})}>
          <i className="bi bi-google"></i> 使用 Google 登入
        </button>
        <button className="btn outline large welcome-btn" id="welcome-guest" onClick={hideWelcome}>
          <i className="bi bi-person"></i> 以訪客身分使用
        </button>
        <p className="welcome-hint">
          登入後可將文件、術語庫與翻譯記憶儲存至雲端資料庫（登入會離開再返回本頁）；<br />
          訪客模式資料保存在此瀏覽器，換裝置或清除瀏覽資料前請先匯出 JSON。
        </p>
      </div>
    </div>
  );
}
