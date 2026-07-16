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
  const auth         = useStore(s => s.auth);
  const cloudBusy    = useStore(s => s.cloudBusy);
  const confirmModal = useStore(s => s.confirmModal);
  const closeConfirm = useStore(s => s.closeConfirm);

  const [darkMode, setDarkMode] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showAccount, setShowAccount] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);
  useEffect(() => {
    document.documentElement.setAttribute('data-text-scale', String(textScale));
  }, [textScale]);

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
          <div className="header-actions">
            <button className="icon-btn" id="btn-account"
                    title={auth.token ? '點擊登出 Google 帳號' : '點擊連結 Google 帳號'}
                    onClick={() => {
                      if (!auth.token) { requestGoogleLogin().catch(() => {}); return; }
                      setShowAccount(true);
                    }}>
              <i className={'bi ' + (auth.token ? 'bi-person-check' : 'bi-person')}></i>
              {' '}{auth.token ? (auth.email || '已連結 Google') : '訪客模式'}
            </button>
            <button className="icon-btn" id="btn-shortcuts" onClick={() => setShowShortcuts(true)}>
              <i className="bi bi-keyboard"></i> 快捷鍵
            </button>
            <button className="icon-btn" id="btn-dark-mode" onClick={() => setDarkMode(!darkMode)}>
              <i className={'bi ' + (darkMode ? 'bi-sun' : 'bi-moon')}></i> {darkMode ? '亮色模式' : '暗黑模式'}
            </button>
            <button className="icon-btn" id="btn-text-scale" onClick={cycleTextScale}>
              <i className="bi bi-zoom-in"></i> 防老花模式：{textScale}x
            </button>
            <button className="icon-btn" id="btn-cloud-save" disabled={cloudBusy}
                    title="將文件、術語庫與翻譯記憶儲存至雲端資料庫"
                    onClick={() => { saveAllToCloud(); }}>
              <i className="bi bi-cloud-arrow-up"></i> {cloudBusy ? '儲存中…' : '儲存至雲端'}
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
