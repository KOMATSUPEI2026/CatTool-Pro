import { Fragment, useEffect, useRef, useState } from 'react';
import { useStore } from '../store.js';
import { docStats, docStatus, fmtDate } from '../utils.js';
import { exportDocs } from '../exporters.js';
import Dashboard from '../components/Dashboard.jsx';
import NewFolderModal from '../components/NewFolderModal.jsx';
import { NameEditor, RenameListModal, MoveDocsModal, DeleteBatchModal, ExportDocsModal }
  from '../components/ProjectModals.jsx';

/* 單擊/雙擊分流：單擊延遲 250ms 執行原行為，期間收到雙擊就取消改走改名 */
const DBL_DELAY = 250;

function DocRow({ doc, editing, onStartEdit, onCommitName, onCancelEdit,
                  canDrag, dragging, onDragStartDoc, onDragEndDoc, checked, onToggleCheck }) {
  const openDoc = useStore(s => s.openDoc);
  const st = docStats(doc);
  const status = docStatus(doc);
  const clickTimer = useRef(null);
  useEffect(() => () => clearTimeout(clickTimer.current), []);
  return (
    <tr className={dragging ? 'dragging' : undefined}
        draggable={canDrag && !editing}
        onDragStart={e => {
          e.dataTransfer.setData('text/plain', doc.id);
          e.dataTransfer.effectAllowed = 'move';
          onDragStartDoc(doc.id);
        }}
        onDragEnd={onDragEndDoc}>
      <td className="check-cell">
        <input type="checkbox" className="row-check" checked={checked}
               onChange={() => onToggleCheck(doc.id)} />
      </td>
      <td>
        {editing
          ? <NameEditor initial={doc.name}
                        onCommit={v => onCommitName(doc.id, v)}
                        onCancel={onCancelEdit} />
          : <a className="doc-link" data-docid={doc.id} title="單擊開啟檔案；雙擊重新命名"
               onClick={() => {
                 clearTimeout(clickTimer.current);
                 clickTimer.current = setTimeout(() => openDoc(doc.id), DBL_DELAY);
               }}
               onDoubleClick={() => { clearTimeout(clickTimer.current); onStartEdit(); }}>
              <i className="bi bi-file-earmark-text"></i> {doc.name}
            </a>}
      </td>
      <td>{doc.srcLang || 'ja'}&nbsp;▶&nbsp;{doc.tgtLang || 'zh-TW'}</td>
      <td>{st.jaChars}</td>
      <td>{st.zhChars}</td>
      <td>{st.confirmedPct}%</td>
      <td>{st.reviewedPct}%</td>
      <td>{fmtDate(doc.createdAt)}</td>
      <td>{fmtDate(doc.updatedAt)}</td>
      <td style={{ whiteSpace: 'nowrap' }}>
        <span className={`st-badge st-${status.key}`} data-docid={doc.id}>{status.label}</span>
      </td>
    </tr>
  );
}

function FolderRow({ folder, docsInFolder, collapsed, dropHover, editing,
                     onStartEdit, onCommitName, onCancelEdit,
                     onDragOverFolder, onDragLeaveFolder, onDropOnFolder,
                     checked, onToggleCheck }) {
  const toggleFolder = useStore(s => s.toggleFolder);
  const sumJa = docsInFolder.reduce((a, d) => a + docStats(d).jaChars, 0);
  const sumZh = docsInFolder.reduce((a, d) => a + docStats(d).zhChars, 0);
  const clickTimer = useRef(null);
  useEffect(() => () => clearTimeout(clickTimer.current), []);
  return (
    <tr className={'proj-folder-row' + (dropHover ? ' drop-hover' : '')} data-folderid={folder.id}
        onClick={() => toggleFolder(folder.id)}
        onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; onDragOverFolder(folder.id); }}
        onDragLeave={() => onDragLeaveFolder(folder.id)}
        onDrop={e => { e.preventDefault(); onDropOnFolder(e, folder.id); }}>
      <td className="check-cell" onClick={e => e.stopPropagation()}>
        <input type="checkbox" className="row-check" checked={checked}
               onChange={() => onToggleCheck(folder.id)} />
      </td>
      <td colSpan={9}>
        <span className="folder-toggle">{collapsed ? '▸' : '▾'}</span>
        <i className={collapsed ? 'bi bi-folder' : 'bi bi-folder2-open'}></i>{' '}
        {editing
          ? <NameEditor initial={folder.name}
                        onCommit={v => onCommitName(folder.id, v)}
                        onCancel={onCancelEdit} />
          : <span className="folder-name" title="單擊展開/收合；雙擊重新命名"
                  onClick={e => {
                    e.stopPropagation();
                    clearTimeout(clickTimer.current);
                    clickTimer.current = setTimeout(() => toggleFolder(folder.id), DBL_DELAY);
                  }}
                  onDoubleClick={e => {
                    e.stopPropagation();
                    clearTimeout(clickTimer.current);
                    onStartEdit();
                  }}>{folder.name}</span>}
        <span className="folder-count">({docsInFolder.length})</span>
        <span className="folder-sums">原文 {sumJa}・譯文 {sumZh}</span>
      </td>
    </tr>
  );
}

export default function ProjectsTab() {
  const documents = useStore(s => s.documents);
  const folders = useStore(s => s.folders);
  const collapsedFolders = useStore(s => s.collapsedFolders);
  const addFolder = useStore(s => s.addFolder);
  const setDocFolder = useStore(s => s.setDocFolder);
  const renameFolder = useStore(s => s.renameFolder);
  const renameDocument = useStore(s => s.renameDocument);
  const moveDocsToFolder = useStore(s => s.moveDocsToFolder);
  const batchDelete = useStore(s => s.batchDelete);
  const showToast = useStore(s => s.showToast);

  const [kw, setKw] = useState('');
  const [modal, setModal] = useState(null);   // {type:'newFolder'|'rename'|'move'|'delBatch'|'export'}
  const [editing, setEditing] = useState(null);        // {type:'doc'|'folder', id}
  const [dragDocId, setDragDocId] = useState(null);
  const [dragOver, setDragOver] = useState(null);      // folderId | ''（未分類放置區）
  const [checkedDocs, setCheckedDocs] = useState(() => new Set());       // 批次功能預留（V57 僅勾選狀態）
  const [checkedFolders, setCheckedFolders] = useState(() => new Set());

  const kwTrimmed = kw.trim().toLowerCase();
  const matched = kwTrimmed ? documents.filter(d => d.name.toLowerCase().includes(kwTrimmed)) : null;
  const noResult = !!kwTrimmed && documents.length > 0 && matched.length === 0;

  const toggleSet = (setter) => (id) => setter(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleDocCheck = toggleSet(setCheckedDocs);
  const toggleFolderCheck = toggleSet(setCheckedFolders);

  /* 改名套用（表格雙擊與改名 Modal 共用）：檔名守唯一性、資料夾比照 addFolder 不設限 */
  const applyDocName = (docId, raw) => {
    const name = raw.trim();
    const doc = documents.find(d => d.id === docId);
    if (!doc || !name || name === doc.name) return;
    if (documents.some(d => d.id !== docId && d.name === name)) { showToast('已有同名檔案，未改名'); return; }
    renameDocument(docId, name);
  };
  const applyFolderName = (folderId, raw) => {
    const name = raw.trim();
    const folder = folders.find(f => f.id === folderId);
    if (!folder || !name || name === folder.name) return;
    renameFolder(folderId, name);
  };
  const commitDocName = (docId, raw) => { setEditing(null); applyDocName(docId, raw); };
  const commitFolderName = (folderId, raw) => { setEditing(null); applyFolderName(folderId, raw); };

  /* 勾選集合可能殘留已消失的 id（資料夾自動消滅等），取用時一律跟現存資料取交集 */
  const selDocIds = () => documents.filter(d => checkedDocs.has(d.id)).map(d => d.id);
  const selFolderIds = () => folders.filter(f => checkedFolders.has(f.id)).map(f => f.id);

  const openMove = () => {
    if (selDocIds().length === 0) { showToast('請先勾選要移動的文件'); return; }
    setModal({ type: 'move' });
  };
  const openDelete = () => {
    if (selDocIds().length === 0 && selFolderIds().length === 0) { showToast('請先勾選要刪除的資料夾或文件'); return; }
    setModal({ type: 'delBatch' });
  };
  /* 匯出＝一份文件一個檔（V58 微調定案，不整批包一起）；V59 起格式在 Modal 內選
     （雙語 xlsx/TMX/XLF1.2/XLF2.0/JSON、譯文 xlsx/JSON），下載管線與工作區共用
     exporters.exportDocs（多檔 300ms 錯開，避免瀏覽器只放行第一個下載） */
  const onPickExport = async (fmts) => {
    const sel = new Set(selDocIds());
    const docs = sel.size ? documents.filter(d => sel.has(d.id)) : documents;
    if (docs.length === 0) { showToast('尚無文件可匯出'); return; }
    setModal(null);
    const n = await exportDocs(docs, fmts);   // 文件×格式逐檔產出；picker 取消回傳 0 不跳 Toast
    if (n > 0) showToast(`已匯出 ${docs.length} 件文件（共 ${n} 個檔案）`);
  };

  const endDrag = () => { setDragDocId(null); setDragOver(null); };
  const dropTo = (e, folderId) => {
    const docId = e.dataTransfer.getData('text/plain') || dragDocId;
    if (docId) setDocFolder(docId, folderId);
    endDrag();
  };
  const dragLeaveOf = (key) => setDragOver(cur => (cur === key ? null : cur));

  const docRowProps = (d, canDrag) => ({
    doc: d, canDrag,
    editing: editing?.type === 'doc' && editing.id === d.id,
    onStartEdit: () => setEditing({ type: 'doc', id: d.id }),
    onCommitName: commitDocName,
    onCancelEdit: () => setEditing(null),
    dragging: dragDocId === d.id,
    onDragStartDoc: setDragDocId,
    onDragEndDoc: endDrag,
    checked: checkedDocs.has(d.id),
    onToggleCheck: toggleDocCheck
  });

  return (
    <>
    <Dashboard />
    <div className="card">
      <div className="table-toolbar">
        <span className="search-wrap">
          <i className="bi bi-search"></i>
          <input className="search-box" id="project-search" placeholder="搜尋檔案名稱…"
                 value={kw} onChange={e => setKw(e.target.value)} />
        </span>
        <span className="search-no-result" id="project-no-result"
              style={{ display: noResult ? 'inline' : 'none' }}>無匹配的搜尋結果</span>
        <div className="proj-actions">
          <button className="icon-btn" id="btn-new-folder" data-tip="新增資料夾"
                  onClick={() => setModal({ type: 'newFolder' })}>
            <i className="bi bi-folder-plus"></i>
          </button>
          <button className="icon-btn" id="btn-rename-list" data-tip="修改資料夾／文件名稱"
                  onClick={() => setModal({ type: 'rename' })}>
            <i className="bi bi-pencil-square"></i>
          </button>
          <button className="icon-btn" id="btn-move-docs" data-tip="更改文件位置（先勾選文件）"
                  onClick={openMove}>
            <i className="bi bi-folder-symlink"></i>
          </button>
          <button className="icon-btn" id="btn-del-batch" data-tip="刪除資料夾／文件（先勾選）"
                  onClick={openDelete}>
            <i className="bi bi-trash3"></i>
          </button>
          <button className="icon-btn tip-right" id="btn-export-docs" data-tip="匯出文件"
                  onClick={() => setModal({ type: 'export' })}>
            <i className="bi bi-cloud-download"></i>
          </button>
        </div>
      </div>
      <div className="table-scroll">
        <table>
          <thead><tr>
            <th className="check-cell"></th>
            <th>文件名稱</th><th>語言</th><th>原文字數</th><th>譯文字數</th>
            <th>翻譯進度</th><th>校對進度</th><th>建立時間</th><th>更新時間</th><th>狀態</th>
          </tr></thead>
          <tbody id="project-tbody">
            {matched
              ? matched.map(d => <DocRow key={d.id} {...docRowProps(d, false)} />)
              : <>
                  {folders.map(f => {
                    const docsInFolder = documents.filter(d => d.folderId === f.id);
                    const collapsed = collapsedFolders.has(f.id);
                    return (
                      <Fragment key={f.id}>
                        <FolderRow folder={f} docsInFolder={docsInFolder} collapsed={collapsed}
                                   dropHover={dragOver === f.id}
                                   editing={editing?.type === 'folder' && editing.id === f.id}
                                   onStartEdit={() => setEditing({ type: 'folder', id: f.id })}
                                   onCommitName={commitFolderName}
                                   onCancelEdit={() => setEditing(null)}
                                   onDragOverFolder={setDragOver}
                                   onDragLeaveFolder={dragLeaveOf}
                                   onDropOnFolder={dropTo}
                                   checked={checkedFolders.has(f.id)}
                                   onToggleCheck={toggleFolderCheck} />
                        {!collapsed && docsInFolder.map(d =>
                          <DocRow key={d.id} {...docRowProps(d, true)} />)}
                      </Fragment>
                    );
                  })}
                  {documents.filter(d => !d.folderId).map(d =>
                    <DocRow key={d.id} {...docRowProps(d, true)} />)}
                  {dragDocId &&
                    <tr className={'uncat-drop-row' + (dragOver === '' ? ' drop-hover' : '')}
                        onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOver(''); }}
                        onDragLeave={() => dragLeaveOf('')}
                        onDrop={e => { e.preventDefault(); dropTo(e, ''); }}>
                      <td colSpan={10}><i className="bi bi-inbox"></i> 放到這裡移出資料夾（未分類）</td>
                    </tr>}
                </>}
          </tbody>
        </table>
      </div>
      <div className="empty" id="project-empty"
           style={{ display: documents.length === 0 ? 'block' : 'none' }}>
        尚無檔案。請先到「入稿工作區」建立檔案。
      </div>

      {modal?.type === 'newFolder' &&
        <NewFolderModal
          onCancel={() => setModal(null)}
          onSubmit={name => {
            if (!name) { showToast('請輸入資料夾名稱'); return; }
            addFolder(name);
            setModal(null);
          }} />}

      {modal?.type === 'rename' &&
        <RenameListModal folders={folders} documents={documents}
                         onClose={() => setModal(null)}
                         onRenameFolder={applyFolderName}
                         onRenameDoc={applyDocName} />}

      {modal?.type === 'move' &&
        <MoveDocsModal folders={folders} count={selDocIds().length}
                       onClose={() => setModal(null)}
                       onSubmit={targetId => {
                         const ids = selDocIds();
                         moveDocsToFolder(ids, targetId);
                         setCheckedDocs(new Set());
                         setModal(null);
                         showToast(`已移動 ${ids.length} 件文件`);
                       }} />}

      {modal?.type === 'delBatch' &&
        <DeleteBatchModal folderCount={selFolderIds().length} docCount={selDocIds().length}
                          onClose={() => setModal(null)}
                          onOk={() => {
                            batchDelete(selDocIds(), selFolderIds());
                            setCheckedDocs(new Set());
                            setCheckedFolders(new Set());
                            setModal(null);
                            showToast('已刪除');
                          }} />}

      {modal?.type === 'export' &&
        <ExportDocsModal total={documents.length} selected={selDocIds().length}
                         onClose={() => setModal(null)}
                         onSubmit={onPickExport} />}
    </div>
    </>
  );
}
