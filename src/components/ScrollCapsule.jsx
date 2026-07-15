import { useStore } from '../store.js';

/* 快速置頂/置底膠囊：僅在 ②專案管理區、③翻譯工作區 顯示 */
export default function ScrollCapsule() {
  const currentTab = useStore(s => s.currentTab);
  const show = currentTab === 'projects' || currentTab === 'work';
  return (
    <div className={'scroll-capsule' + (show ? ' show' : '')} id="scroll-capsule">
      <button id="scroll-top-btn" title="回到頂端"
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
        <i className="bi bi-caret-up"></i>
      </button>
      <button id="scroll-bottom-btn" title="移至底端"
              onClick={() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' })}>
        <i className="bi bi-caret-down"></i>
      </button>
    </div>
  );
}
