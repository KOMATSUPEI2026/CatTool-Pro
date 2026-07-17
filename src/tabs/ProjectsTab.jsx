import { Fragment, useState } from 'react';
import { useStore } from '../store.js';
import { docStats, fmtDate } from '../utils.js';
import ConfirmModal from '../components/ConfirmModal.jsx';
import NewFolderModal from '../components/NewFolderModal.jsx';

function DocRow({ doc, folders, onAskDelete }) {
  const openDoc = useStore(s => s.openDoc);
  const setDocFolder = useStore(s => s.setDocFolder);
  const st = docStats(doc);
  return (
    <tr>
      <td>
        <a className="doc-link" data-docid={doc.id} onClick={() => openDoc(doc.id)}>
          <i className="bi bi-file-earmark-text"></i> {doc.name}
        </a>
      </td>
      <td>{doc.srcLang || 'ja'}&nbsp;▶&nbsp;{doc.tgtLang || 'zh-TW'}</td>
      <td>{st.jaChars}</td>
      <td>{st.zhChars}</td>
      <td>{st.confirmedPct}%</td>
      <td>{st.reviewedPct}%</td>
      <td>{fmtDate(doc.createdAt)}</td>
      <td>{fmtDate(doc.updatedAt)}</td>
      <td style={{ whiteSpace: 'nowrap' }}>
        <select className="doc-folder-select" data-docid={doc.id}
                value={doc.folderId || ''}
                onChange={e => setDocFolder(doc.id, e.target.value)}>
          <option value="">未分類</option>
          {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <button className="row-del" data-docid={doc.id} title="刪除檔案"
                onClick={() => onAskDelete(doc)}>
          <i className="bi bi-x-lg"></i>
        </button>
      </td>
    </tr>
  );
}

export default function ProjectsTab() {
  const documents = useStore(s => s.documents);
  const folders = useStore(s => s.folders);
  const collapsedFolders = useStore(s => s.collapsedFolders);
  const toggleFolder = useStore(s => s.toggleFolder);
  const addFolder = useStore(s => s.addFolder);
  const deleteFolder = useStore(s => s.deleteFolder);
  const deleteDocument = useStore(s => s.deleteDocument);
  const showToast = useStore(s => s.showToast);

  const [kw, setKw] = useState('');
  const [modal, setModal] = useState(null);   // {type:'newFolder'} | {type:'delFolder', folder} | {type:'delDoc', doc}

  const kwTrimmed = kw.trim().toLowerCase();
  const matched = kwTrimmed ? documents.filter(d => d.name.toLowerCase().includes(kwTrimmed)) : null;
  const noResult = !!kwTrimmed && documents.length > 0 && matched.length === 0;

  return (
    <div className="card">
      <div className="table-toolbar">
        <input className="search-box" id="project-search" placeholder="搜尋檔案名稱…"
               value={kw} onChange={e => setKw(e.target.value)} />
        <span className="search-no-result" id="project-no-result"
              style={{ display: noResult ? 'inline' : 'none' }}>無匹配的搜尋結果</span>
        <button className="btn outline small" id="btn-new-folder"
                onClick={() => setModal({ type: 'newFolder' })}>+ 新增資料夾</button>
      </div>
      <div className="table-scroll">
        <table>
          <thead><tr>
            <th>文件名稱</th><th>語言</th><th>原文字數</th><th>譯文字數</th>
            <th>翻譯進度</th><th>校對進度</th><th>建立時間</th><th>更新時間</th><th></th>
          </tr></thead>
          <tbody id="project-tbody">
            {matched
              ? matched.map(d =>
                  <DocRow key={d.id} doc={d} folders={folders} onAskDelete={doc => setModal({ type: 'delDoc', doc })} />)
              : <>
                  {folders.map(f => {
                    const docsInFolder = documents.filter(d => d.folderId === f.id);
                    const collapsed = collapsedFolders.has(f.id);
                    const sumJa = docsInFolder.reduce((a, d) => a + docStats(d).jaChars, 0);
                    const sumZh = docsInFolder.reduce((a, d) => a + docStats(d).zhChars, 0);
                    return (
                      <Fragment key={f.id}>
                        <tr className="proj-folder-row" data-folderid={f.id} onClick={() => toggleFolder(f.id)}>
                          <td colSpan={9}>
                            <span className="folder-toggle">{collapsed ? '▸' : '▾'}</span>
                            <i className="bi bi-folder"></i> {f.name}
                            <span className="folder-count">({docsInFolder.length})</span>
                            <span className="folder-sums">原文 {sumJa}・譯文 {sumZh}</span>
                            <button className="row-del folder-del" data-folderid={f.id} title="刪除資料夾（檔案移至未分類）"
                                    onClick={e => { e.stopPropagation(); setModal({ type: 'delFolder', folder: f }); }}>
                              <i className="bi bi-x-lg"></i>
                            </button>
                          </td>
                        </tr>
                        {!collapsed && docsInFolder.map(d =>
                          <DocRow key={d.id} doc={d} folders={folders} onAskDelete={doc => setModal({ type: 'delDoc', doc })} />)}
                      </Fragment>
                    );
                  })}
                  {documents.filter(d => !d.folderId).map(d =>
                    <DocRow key={d.id} doc={d} folders={folders} onAskDelete={doc => setModal({ type: 'delDoc', doc })} />)}
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

      {modal?.type === 'delFolder' &&
        <ConfirmModal title="刪除資料夾" cancelLabel="取消" okLabel="確定刪除"
                      onCancel={() => setModal(null)}
                      onOk={() => { deleteFolder(modal.folder.id); setModal(null); }}>
          刪除這個資料夾？<br />裡面的檔案會移回未分類，不會被刪除。
        </ConfirmModal>}

      {modal?.type === 'delDoc' &&
        <ConfirmModal title="刪除檔案" cancelLabel="取消" okLabel="確定刪除"
                      onCancel={() => setModal(null)}
                      onOk={() => { deleteDocument(modal.doc.id); setModal(null); }}>
          刪除這個檔案？<br />所有句段內容將會遺失（翻譯記憶保留不動）。
        </ConfirmModal>}
    </div>
  );
}
