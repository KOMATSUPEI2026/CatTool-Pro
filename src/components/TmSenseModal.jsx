import { useState } from 'react';
import { useStore } from '../store.js';

/* TM 靈敏度設定 Modal（V56）：滑桿調「側欄顯示多少相似度以上」的門檻。
   確認型（取消/送出雙鈕，依 V52 規範不掛右上 X）；送出才寫入 prefs（user_prefs 雲端同步），取消不生效 */
export default function TmSenseModal({ onClose }) {
  const tmThreshold = useStore(s => s.prefs.tmThreshold);
  const patchPrefs = useStore(s => s.patchPrefs);
  const [val, setVal] = useState(tmThreshold);
  return (
    <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-card modal-card-wide modal-card-center">
        <h3>翻譯記憶靈敏度</h3>
        <p className="tm-sense-hint">滑動滑桿調節靈敏度，側欄只列出相似度達門檻的翻譯記憶。</p>
        <div className="tm-sense-value" id="tm-sense-value">顯示 {val}% 以上</div>
        <input type="range" className="tm-sense-slider" id="tm-sense-slider"
               min="0" max="100" step="5" value={val}
               onChange={e => setVal(Number(e.target.value))} />
        <div className="tm-sense-scale"><span>0%（全部列出）</span><span>100%（完全相同）</span></div>
        <div className="modal-actions modal-actions-center">
          <button className="btn outline small" id="tm-sense-cancel" onClick={onClose}>取消</button>
          <button className="btn vermilion small" id="tm-sense-submit"
                  onClick={() => { patchPrefs({ tmThreshold: val }); onClose(); }}>送出</button>
        </div>
      </div>
    </div>
  );
}
