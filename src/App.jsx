import { useEffect, useState } from 'react';
import { useStore } from './store.js';
import IngestTab from './tabs/IngestTab.jsx';
import ProjectsTab from './tabs/ProjectsTab.jsx';
import WorkTab from './tabs/WorkTab.jsx';
import TermsTab from './tabs/TermsTab.jsx';
import TmTab from './tabs/TmTab.jsx';
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
import PunctBar from './components/PunctBar.jsx';
import ShortcutsModal from './components/ShortcutsModal.jsx';

const TABS = [
  { key: 'ingest',   label: '入稿工作區' },
  { key: 'projects', label: '專案管理區' },
  { key: 'work',     label: '翻譯工作區' },
  { key: 'terms',    label: '術語庫' },
  { key: 'tm',       label: '翻譯記憶' }
];

const TAB_VIEWS = { ingest: IngestTab, projects: ProjectsTab, work: WorkTab, terms: TermsTab, tm: TmTab };

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

      <TmSidebar />
      <PvSidebar />
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
