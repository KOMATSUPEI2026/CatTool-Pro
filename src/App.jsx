import { useEffect, useRef, useState } from 'react';
import { useStore } from './store.js';
import IngestTab from './tabs/IngestTab.jsx';
import ProjectsTab from './tabs/ProjectsTab.jsx';
import WorkTab from './tabs/WorkTab.jsx';
import TermsTab from './tabs/TermsTab.jsx';
import TmTab from './tabs/TmTab.jsx';
import SettingsTab from './tabs/SettingsTab.jsx';
import { parseYouTubeId } from './utils.js';
import Toast from './components/Toast.jsx';
import ConfirmModal from './components/ConfirmModal.jsx';
import WelcomeOverlay from './components/WelcomeOverlay.jsx';
import AccountModal from './components/AccountModal.jsx';
import ScrollCapsule from './components/ScrollCapsule.jsx';
import { requestGoogleLogin, saveAllToCloud } from './cloud.js';
import { autoGrowAll } from './workActions.js';
import TmSidebar from './components/TmSidebar.jsx';
import PvSidebar from './components/PvSidebar.jsx';
import HistorySidebar from './components/HistorySidebar.jsx';
import CommentSidebar from './components/CommentSidebar.jsx';
import PunctBar from './components/PunctBar.jsx';
import ShortcutsModal from './components/ShortcutsModal.jsx';

const TABS = [
  { key: 'ingest',   label: '入稿工作區' },
  { key: 'projects', label: '專案管理區' },
  { key: 'work',     label: '翻譯工作區' },
  { key: 'terms',    label: '術語庫' },
  { key: 'tm',       label: '翻譯記憶' },
  { key: 'settings', label: '個人設定區' }
];

const TAB_VIEWS = { ingest: IngestTab, projects: ProjectsTab, work: WorkTab, terms: TermsTab, tm: TmTab, settings: SettingsTab };

/* 白噪音音量控制走官方 IFrame API（V63 微調）：script 不隨頁面載入，第一次播放才動態
   注入 https://www.youtube.com/iframe_api（一次性、快取 Promise）——API 由 YouTube 端
   與 widget 內部訊息格式成對維護，格式改版免疫；載入失敗回 null（音量失效、播放不受影響） */
let ytApiPromise = null;
function loadYtApi() {
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve) => {
    if (window.YT && window.YT.Player) { resolve(window.YT); return; }
    window.onYouTubeIframeAPIReady = () => resolve(window.YT);
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
  return ytApiPromise;
}

export default function App() {
  const currentTab  = useStore(s => s.currentTab);
  const activateTab = useStore(s => s.activateTab);
  const termCount   = useStore(s => s.termBase.length);
  const tmCount     = useStore(s => s.tmSegments.length);
  const docCount    = useStore(s => s.documents.length);
  const textScale   = useStore(s => s.textScale);
  const cycleTextScale = useStore(s => s.cycleTextScale);
  const fontMode    = useStore(s => s.fontMode);
  const toggleFontMode = useStore(s => s.toggleFontMode);
  const auth         = useStore(s => s.auth);
  const cloudBusy    = useStore(s => s.cloudBusy);
  const cloudFlashSeq = useStore(s => s.cloudFlashSeq);
  const confirmModal = useStore(s => s.confirmModal);
  const closeConfirm = useStore(s => s.closeConfirm);
  const musicPlaying = useStore(s => s.musicPlaying);
  const toggleMusic  = useStore(s => s.toggleMusic);
  const ytUrl        = useStore(s => s.prefs.ytUrl);
  const musicVolume  = useStore(s => s.prefs.musicVolume);
  const musicStartPct = useStore(s => s.prefs.musicStartPct);
  const ytId = parseYouTubeId(ytUrl);

  const [darkMode, setDarkMode] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  // 儲存成功短暫轉實心雲（同 Toast 2.4s 節奏），時間到彈回空心
  const [cloudFilled, setCloudFilled] = useState(false);
  useEffect(() => {
    if (!cloudFlashSeq) return;
    setCloudFilled(true);
    const t = setTimeout(() => setCloudFilled(false), 2400);
    return () => clearTimeout(t);
  }, [cloudFlashSeq]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);
  /* Ctrl/Cmd+S＝儲存至雲端（V62）：一律攔下瀏覽器「另存網頁」；儲存中不重入
     （與 #btn-cloud-save 同入口——未登入時 saveAllToCloud 自帶登入引導 Modal） */
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        if (!useStore.getState().cloudBusy) saveAllToCloud();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  /* 字級相關屬性寫上 <html> 後譯文框要補量高度：SegRow 自己的 useLayoutEffect 跑在
     這裡之前（量到的還是舊字級，屬性生效後長譯文會爆框——V51 修正），
     故屬性設定完（新字級已生效）再 autoGrowAll；非工作分頁不量（display:none 陷阱），
     切回時 SegRow 的 active effect 會補算 */
  useEffect(() => {
    document.documentElement.setAttribute('data-text-scale', String(textScale));
    if (useStore.getState().currentTab === 'work') autoGrowAll('#seg-list textarea');
  }, [textScale]);
  useEffect(() => {
    document.documentElement.setAttribute('data-font-mode', fontMode);
    if (useStore.getState().currentTab === 'work') autoGrowAll('#seg-list textarea');
  }, [fontMode]);

  /* 白噪音音量（V63 微調）：播放開始→載官方 API→YT.Player 包住既有 #yt-noise iframe
     （需 src 帶 enablejsapi=1），onReady 套當下 prefs 音量；停止/換片＝destroy 解綁
     （iframe 本體由 React 掛卸，destroy 只拆事件橋——try/catch 防 iframe 已先卸載）。
     拖桿即調即生效：播放中 musicVolume 一變就 player.setVolume */
  const ytPlayerRef = useRef(null);
  const ytStartAppliedRef = useRef(false);   // 本次播放是否已套用時間軸起始位置（每次開播重置）
  useEffect(() => {
    if (!musicPlaying || !ytId) return;
    let cancelled = false;
    ytStartAppliedRef.current = false;
    loadYtApi().then(YT => {
      if (cancelled || !YT || !document.getElementById('yt-noise')) return;
      ytPlayerRef.current = new YT.Player('yt-noise', {
        events: {
          onReady: e => e.target.setVolume(useStore.getState().prefs.musicVolume),
          /* 時間軸（V63 微調，實測二修定案）：滑桿＝**本次播放的起始位置**，只在首播套用一次；
             循環一律交給原生 loop=1&playlist 回到 0 播整首（「每輪都從起點」語意經實測否決——
             滑桿在尾端時會變成只循環結尾幾秒，使用者期望播完跳回 0）。ENDED 不接手
             （自行 seek+play 與原生循環互搶會卡結尾）。起始位置夾「總長−5 秒」防一開播就結束 */
          onStateChange: e => {
            if (e.data !== 1) return;   // 只管 PLAYING
            const p = e.target;
            const st = useStore.getState();
            const dur = p.getDuration() || 0;
            if (st.musicDuration !== dur) st.setMusicDuration(dur);
            if (dur <= 0 || ytStartAppliedRef.current) return;
            ytStartAppliedRef.current = true;   // 首播套用一次；之後每輪循環從 0 播整首
            const startSec = Math.min(dur * st.prefs.musicStartPct / 100, Math.max(0, dur - 5));
            if (startSec > 1) p.seekTo(startSec, true);
          }
        }
      });
    });
    return () => {
      cancelled = true;
      if (ytPlayerRef.current) {
        try { ytPlayerRef.current.destroy(); } catch { /* iframe 已隨 React 卸載 */ }
        ytPlayerRef.current = null;
      }
    };
  }, [musicPlaying, ytId]);
  useEffect(() => {
    const p = ytPlayerRef.current;
    if (musicPlaying && p && typeof p.setVolume === 'function') {
      try { p.setVolume(musicVolume); } catch { /* 播放器未就緒：onReady 會套 */ }
    }
  }, [musicVolume, musicPlaying]);
  /* 時間軸拖桿即時 seek（即時回饋聽得到起點）；總長未知（未就緒/直播）不動作，
     首播的起點套用交給 onStateChange PLAYING。上限同夾「總長−5 秒」 */
  useEffect(() => {
    const p = ytPlayerRef.current;
    const dur = useStore.getState().musicDuration;
    if (musicPlaying && p && typeof p.seekTo === 'function' && dur > 0) {
      try { p.seekTo(Math.min(dur * musicStartPct / 100, Math.max(0, dur - 5)), true); } catch { /* 未就緒 */ }
    }
  }, [musicStartPct, musicPlaying]);

  return (
    <div className="wrap">
      <header>
        <div className="brand">
          <span className="seal-mark">校</span>
          <div>
            <h1>校譯台</h1>
            <div className="tagline">術語比對・翻譯記憶</div>
          </div>
        </div>
        <div className="header-right">
          <div className="stat-line">
            <span>術語條目　<b>{termCount}</b></span>
            <span>記憶句段　<b>{tmCount}</b></span>
            <span>文件數　<b>{docCount}</b></span>
          </div>
          {/* 頂列一律純 icon＋data-tip hover 說明（V51 微調，Termsoup 式） */}
          <div className="header-actions">
            <button className="icon-btn" id="btn-account"
                    data-tip={auth.token ? `已登入 ${auth.email || 'Google 帳號'}：點擊開帳號選單` : '訪客模式：點擊登入 Google 帳號'}
                    onClick={() => {
                      if (!auth.token) { requestGoogleLogin().catch(() => {}); return; }
                      setShowAccount(true);
                    }}>
              <i className={'bi ' + (auth.token ? 'bi-person-check' : 'bi-person')}></i>
            </button>
            <button className="icon-btn" id="btn-shortcuts" data-tip="快捷鍵說明" onClick={() => setShowShortcuts(true)}>
              <i className="bi bi-keyboard"></i>
            </button>
            <button className={'icon-btn' + (musicPlaying ? ' music-on' : '')} id="btn-music"
                    data-tip={musicPlaying ? '停止播放白噪音' : '播放白噪音（連結在個人設定區）'}
                    onClick={toggleMusic}>
              <i className="bi bi-music-note"></i>
            </button>
            <button className="icon-btn" id="btn-dark-mode"
                    data-tip={darkMode ? '切換亮色模式' : '切換暗黑模式'}
                    onClick={() => setDarkMode(!darkMode)}>
              <i className={'bi ' + (darkMode ? 'bi-sun' : 'bi-moon')}></i>
            </button>
            <button className="icon-btn" id="btn-text-scale"
                    data-tip={`防老花模式 ${textScale}x：點擊放大字級`}
                    onClick={cycleTextScale}>
              <i className="bi bi-zoom-in"></i>
            </button>
            <button className="icon-btn" id="btn-font-mode"
                    data-tip={fontMode === 'desktop' ? '字級：桌機模式，點擊切換筆電' : '字級：筆電模式，點擊切換桌機'}
                    onClick={toggleFontMode}>
              <i className={'bi ' + (fontMode === 'desktop' ? 'bi-display' : 'bi-laptop')}></i>
            </button>
            <button className="icon-btn tip-right" id="btn-cloud-save" disabled={cloudBusy}
                    data-tip={cloudBusy ? '儲存中…' : '將文件、術語與記憶儲存至雲端'}
                    onClick={() => { saveAllToCloud(); }}>
              <i className={'bi ' + (cloudFilled ? 'bi-cloud-arrow-up-fill' : 'bi-cloud-arrow-up')}></i>
            </button>
          </div>
        </div>
      </header>

      <nav className="tabs">
        {TABS.map(t => (
          <button key={t.key}
                  className={'tab-btn' + (currentTab === t.key ? ' active' : '')}
                  onClick={() => activateTab(t.key)}>
            {t.label}
          </button>
        ))}
      </nav>

      {/* 五個 panel 常駐 DOM、以 active class 切換（同 vanilla；隱藏面板量測陷阱的前提） */}
      {TABS.map(t => {
        const View = TAB_VIEWS[t.key];
        return (
          <section key={t.key} className={'panel' + (currentTab === t.key ? ' active' : '')} id={'panel-' + t.key}>
            <View />
          </section>
        );
      })}

      {/* 白噪音（V63）：播放中才掛隱藏 YouTube iframe；allow=autoplay 委派點擊手勢、
          loop=1&playlist=同 ID 循環播放；停止＝卸載 iframe。
          enablejsapi=1＋origin＝IFrame API 包住此 iframe 控音量的前提（見上方 loadYtApi effect） */}
      {musicPlaying && ytId &&
        <iframe id="yt-noise" title="白噪音音樂"
                src={`https://www.youtube.com/embed/${ytId}?autoplay=1&loop=1&playlist=${ytId}&enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}`}
                allow="autoplay"
                style={{ position: 'fixed', width: 0, height: 0, border: 0, visibility: 'hidden', pointerEvents: 'none' }} />}

      <TmSidebar />
      <PvSidebar />
      <CommentSidebar />
      <HistorySidebar />
      <PunctBar />
      <ScrollCapsule />
      <Toast />
      <WelcomeOverlay />
      {showShortcuts && <ShortcutsModal onClose={() => setShowShortcuts(false)} />}
      {showAccount && <AccountModal onClose={() => setShowAccount(false)} />}
      {/* 全域確認 Modal：雲端層等元件外程式碼經 store.openConfirm 觸發；text 以 \n 斷行 */}
      {confirmModal &&
        <ConfirmModal title={confirmModal.title}
                      cancelLabel={confirmModal.cancelLabel} okLabel={confirmModal.okLabel}
                      wide={confirmModal.wide}
                      onCancel={closeConfirm}
                      onOk={() => { closeConfirm(); confirmModal.onOk?.(); }}>
          {confirmModal.text.split('\n').map((line, i) => (
            i === 0 ? line : <span key={i}><br />{line}</span>
          ))}
        </ConfirmModal>}
    </div>
  );
}
