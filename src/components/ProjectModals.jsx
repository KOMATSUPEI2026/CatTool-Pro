import { useRef, useState } from 'react';
import { ExportPicker, docExportGroups } from './ExportModal.jsx';

/* 行內改名輸入框（V57 建；V58 移入本檔供專案區表格與改名 Modal 共用）：
   Enter/失焦＝送出、Esc＝取消；Enter 須守 IME（isComposing/keyCode 229） */
export function NameEditor({ initial, onCommit, onCancel }) {
  const [val, setVal] = useState(initial);
  const cancelled = useRef(false);
  return (
    <input className="rename-input" autoFocus value={val}
           onFocus={e => e.target.select()}
           onChange={e => setVal(e.target.value)}
           onClick={e => e.stopPropagation()}
           onDoubleClick={e => e.stopPropagation()}
           onKeyDown={e => {
             if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) {
               e.preventDefault(); e.currentTarget.blur();
             } else if (e.key === 'Escape') {
               cancelled.current = true; e.currentTarget.blur();
             }
           }}
           onBlur={() => { cancelled.current ? onCancel() : onCommit(val); }} />
  );
}

/* V58 專案管理區 Modal 家族共用殼：色帶標題列（teal）＋右上 X＋可捲動內容＋可選底部按鈕列
   （export 供 NewFolderModal 共用同款式，V58 微調2） */
export function PmModal({ title, onClose, children, footer }) {
  return (
    <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-card pm-modal">
        <div className="pm-modal-head">
          <h3>{title}</h3>
          <button className="pm-modal-x" title="關閉" onClick={onClose}>
            <i className="bi bi-x-circle-fill"></i>
          </button>
        </div>
        <div className="pm-modal-body">{children}</div>
        {footer && <div className="pm-modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/* 修改資料夾／文件名稱：資料夾/文件雙 Tab 切換條列（檔案多了不用捲整頁），
   點名稱→行內輸入框改名（Modal 常開可連續改多筆）；切 Tab 時收掉編輯中輸入框 */
export function RenameListModal({ folders, documents, onClose, onRenameFolder, onRenameDoc }) {
  const [tab, setTab] = useState('folder');       // 'folder' | 'doc'
  const [editing, setEditing] = useState(null);   // {type:'folder'|'doc', id}
  const switchTab = t => { setTab(t); setEditing(null); };
  return (
    <PmModal title="修改資料夾／文件名稱" onClose={onClose}>
      <div className="pm-tabs">
        <button className={tab === 'folder' ? 'active' : ''} id="pm-tab-folders"
                onClick={() => switchTab('folder')}>
          <i className="bi bi-folder"></i> 資料夾
        </button>
        <button className={tab === 'doc' ? 'active' : ''} id="pm-tab-docs"
                onClick={() => switchTab('doc')}>
          <i className="bi bi-file-earmark-text"></i> 文件
        </button>
      </div>
      {tab === 'folder' &&
        <div className="pm-list" id="pm-rename-folders">
          {folders.length === 0 && <div className="pm-empty">尚無資料夾</div>}
          {folders.map(f => (
            <div key={f.id} className="pm-item" data-folderid={f.id}
                 onClick={() => setEditing({ type: 'folder', id: f.id })}>
              <i className="bi bi-folder"></i>
              {editing?.type === 'folder' && editing.id === f.id
                ? <NameEditor initial={f.name}
                              onCommit={v => { setEditing(null); onRenameFolder(f.id, v); }}
                              onCancel={() => setEditing(null)} />
                : <span>{f.name}</span>}
            </div>
          ))}
        </div>}
      {tab === 'doc' &&
        <div className="pm-list" id="pm-rename-docs">
          {documents.length === 0 && <div className="pm-empty">尚無文件</div>}
          {documents.map(d => (
            <div key={d.id} className="pm-item" data-docid={d.id}
                 onClick={() => setEditing({ type: 'doc', id: d.id })}>
              <i className="bi bi-file-earmark-text"></i>
              {editing?.type === 'doc' && editing.id === d.id
                ? <NameEditor initial={d.name}
                              onCommit={v => { setEditing(null); onRenameDoc(d.id, v); }}
                              onCancel={() => setEditing(null)} />
                : <span>{d.name}</span>}
            </div>
          ))}
        </div>}
    </PmModal>
  );
}

/* 更改文件位置：點選目標資料夾（單選，文件與資料夾一對一）→ 送出才移動 */
export function MoveDocsModal({ folders, count, onClose, onSubmit }) {
  const [target, setTarget] = useState(null);   // null＝尚未選；''＝未分類；其餘＝folderId
  return (
    <PmModal title="更改文件位置" onClose={onClose}
             footer={<>
               <button className="btn outline small" id="pm-move-cancel" onClick={onClose}>取消</button>
               <button className="btn seal small" id="pm-move-submit" disabled={target === null}
                       onClick={() => onSubmit(target)}>送出</button>
             </>}>
      <p className="pm-hint">已勾選 {count} 件文件，點選要移入的資料夾</p>
      <div className="pm-list" id="pm-move-list">
        <div className={'pm-item' + (target === '' ? ' selected' : '')} data-folderid=""
             onClick={() => setTarget('')}>
          <i className="bi bi-inbox"></i><span>未分類</span>
          <i className="bi bi-check-circle-fill pm-check"></i>
        </div>
        {folders.map(f => (
          <div key={f.id} className={'pm-item' + (target === f.id ? ' selected' : '')}
               data-folderid={f.id} onClick={() => setTarget(f.id)}>
            <i className="bi bi-folder"></i><span>{f.name}</span>
            <i className="bi bi-check-circle-fill pm-check"></i>
          </div>
        ))}
      </div>
    </PmModal>
  );
}

/* 刪除資料夾／文件（批次確認）：夾內未勾選文件回未分類；刪文件不動 TM */
export function DeleteBatchModal({ folderCount, docCount, onClose, onOk }) {
  return (
    <PmModal title="刪除資料夾／文件" onClose={onClose}
             footer={<>
               <button className="btn outline small" id="pm-del-cancel" onClick={onClose}>取消</button>
               <button className="btn seal small" id="pm-del-ok" onClick={onOk}>確定刪除</button>
             </>}>
      <p className="pm-hint" id="pm-del-summary">
        將刪除
        {folderCount > 0 && <b> {folderCount} 個資料夾</b>}
        {folderCount > 0 && docCount > 0 && '、'}
        {docCount > 0 && <b> {docCount} 件文件</b>}<br />
        刪除資料夾時，夾內未勾選的文件會移回未分類<br />
        刪除文件後句段內容將會遺失，翻譯記憶保留不動
      </p>
    </PmModal>
  );
}

/* 匯出文件（V59，微調2 改勾選格式＋匯出鈕）：雙語｜譯文兩群組 toggle 複選，
   格式清單與工作區匯出 Modal 共用（PmModal 殼＝專案區配色；
   一份文件一個檔、勾選優先未勾匯全部維持 V58 語意） */
export function ExportDocsModal({ total, selected, onClose, onSubmit }) {
  return (
    <PmModal title="匯出文件" onClose={onClose}>
      <p className="pm-hint" id="pm-export-summary">
        {selected > 0
          ? `將匯出已勾選的 ${selected} 件文件`
          : `未勾選文件，將匯出全部 ${total} 件文件`}<br />
        每件文件各自產出一個檔案；「雙語」含原文與譯文、「譯文」僅譯文
      </p>
      <ExportPicker groups={docExportGroups('pm-export')}
                    submitId="pm-export-submit" submitLabel="匯出文件" onSubmit={onSubmit} />
    </PmModal>
  );
}
