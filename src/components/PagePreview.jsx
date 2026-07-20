import { useStore } from '../store.js';

/* 整頁預覽（V53）：毛玻璃近滿版視窗，僅顯示當前檔案——上原文、下譯文，
   各自串成連續文章通讀（換個視角揪譯文瑕疵）。切句時句尾標點有保留，
   直接相連即還原成文；段落資訊入稿未保留，不做分段。
   V63：透明度/模糊度改吃 prefs（個人設定區調校，CSS 變數注入） */
export default function PagePreview({ doc, onClose }) {
  const pvTransparency = useStore(s => s.prefs.pvTransparency);
  const pvBlur = useStore(s => s.prefs.pvBlur);
  const srcText = doc.segments.map(s => s.ja).join('');
  const tgtText = doc.segments.map(s => s.zh || '').join('');
  return (
    <div className="page-preview-overlay" id="page-preview">
      <div className="page-preview-card"
           style={{ '--pv-alpha': (100 - pvTransparency) / 100, '--pv-blur': pvBlur + 'px' }}>
        <button className="page-preview-close" id="btn-page-preview-close" title="關閉預覽" onClick={onClose}>
          <i className="bi bi-x-circle-fill"></i>
        </button>
        <div className="page-preview-body">
          <div className="page-preview-text">
            <div className="page-preview-src" id="page-preview-src">{srcText}</div>
            <hr className="page-preview-divider" />
            <div className="page-preview-tgt" id="page-preview-tgt">{tgtText}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
