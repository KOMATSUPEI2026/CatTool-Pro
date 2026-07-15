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
          登入後可將文件、術語庫與翻譯記憶儲存至 Google 試算表；<br />
          訪客模式資料僅存於瀏覽器記憶體，重新整理即清空。
        </p>
      </div>
    </div>
  );
}
