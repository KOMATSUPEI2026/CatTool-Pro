/* 翻譯工作區 DOM 相關共用動作：譯文框量測、游標插入。
   術語提示卡帶入、TM 側欄套用、快捷標點列都經由這裡寫入 store，V28 規則一體適用 */
import { flushSync } from 'react-dom';
import { useStore } from './store.js';

/* 譯文框自動撐高（原文幾行、譯文框至少撐開對應高度）。
   display:none 面板 scrollHeight 為 0，呼叫端必須在面板可見時才量測 */
export function autoGrow(ta){
  if(!ta) return;
  ta.style.height = 'auto';
  ta.style.height = (ta.scrollHeight + 2) + 'px';   // +2 補上下 1px 邊框
}
export function autoGrowAll(selector){
  document.querySelectorAll(selector).forEach(autoGrow);
}

/* 插入文字到指定句段譯文欄的游標處。
   caretOffset：插入後游標相對插入起點的位移（配對括號停中間用）；省略＝停在插入文字之後。
   flushSync 讓 React 先同步吐出新值，游標定位才不會被重繪蓋掉 */
export function insertIntoSeg(segId, text, caretOffset){
  const ta = document.querySelector(`#seg-list textarea[data-seg="${segId}"]`);
  if(!ta) return;
  const start = ta.selectionStart ?? ta.value.length;
  const end = ta.selectionEnd ?? ta.value.length;
  const newVal = ta.value.slice(0, start) + text + ta.value.slice(end);
  flushSync(() => useStore.getState().updateSegZh(segId, newVal));
  const pos = start + (caretOffset ?? text.length);
  ta.focus();
  ta.setSelectionRange(pos, pos);
}

/* 配對括號白名單：只有這些 2 字元組才走「停中間/包反白」，其他多字元符號（如……）整串插入 */
export const PUNCT_PAIRS = ['「」','『』','（）','《》','〈〉','【】','〔〕','“”','‘’','()','[]','{}'];

/* 插入標點：目標以「當下焦點」守門——必須聚焦在工作區句段譯文框才插入，
   避免焦點在搜尋框/Modal/側欄時快捷鍵隱形改字（點 bar 因 mousedown preventDefault 不奪焦） */
export function insertPunct(text){
  if(!text) return;
  const ta = document.activeElement;
  if(!ta || ta.tagName !== 'TEXTAREA' || !ta.dataset.seg || !ta.closest('#seg-list')) return;
  const segId = ta.dataset.seg;
  if(PUNCT_PAIRS.includes(text)){
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? start;
    if(end > start){
      const wrapped = text[0] + ta.value.slice(start, end) + text[1];
      insertIntoSeg(segId, wrapped);          // 游標停在右括號後
    } else {
      insertIntoSeg(segId, text, 1);          // 游標停在括號中間
    }
    return;
  }
  insertIntoSeg(segId, text);
}
