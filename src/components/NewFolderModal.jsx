import { useEffect, useRef } from 'react';
import { PmModal } from './ProjectModals.jsx';

/* 新增資料夾 Modal（V58 微調2：換 pm 家族同款＝teal 色帶標題列＋右上 X＋右下按鈕列）。
   輸入框刻意用 uncontrolled（defaultValue+ref）：維持 vanilla 行為（開啟即全選）
   且測試腳本可直接設 .value 後按確認 */
export default function NewFolderModal({ onCancel, onSubmit }) {
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current.focus(); inputRef.current.select(); }, []);
  const submit = () => onSubmit(inputRef.current.value.trim());
  return (
    <PmModal title="新增資料夾" onClose={onCancel}
             footer={<>
               <button className="btn outline small" id="folder-cancel" onClick={onCancel}>取消</button>
               <button className="btn seal small" id="folder-confirm" onClick={submit}>新增</button>
             </>}>
      <div className="modal-field">
        <label>資料夾名稱</label>
        <input type="text" id="folder-name-input" defaultValue="新資料夾" ref={inputRef}
               onKeyDown={e => {
                 // keyCode 229＝IME 組字中，Enter 選字不可送出
                 if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) submit();
               }} />
      </div>
    </PmModal>
  );
}
