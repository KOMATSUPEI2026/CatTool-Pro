import { useState } from 'react';
import { useStore } from '../store.js';
import { cid, docPair } from '../utils.js';
import Pagination, { PAGE_SIZE, clampPage } from '../components/Pagination.jsx';
import ExportModal from '../components/ExportModal.jsx';
import ImportConfirmModal from '../components/ImportConfirmModal.jsx';
import { exportTerms } from '../exporters.js';
import { parseTermsFile, dedupeRows } from '../importers.js';
import { autoSaveAfterSegTool } from '../cloud.js';

function TermRow({ t }) {
  const updateTerm = useStore(s => s.updateTerm);
  const deleteTerm = useStore(s => s.deleteTerm);
  const showToast = useStore(s => s.showToast);

  // 中文譯名以「;／；」並列，上限 9 個；離開欄位時裁切
  const trimZh = (val) => {
    const parts = val.split(/[;；]/).map(x => x.trim()).filter(Boolean);
    if (parts.length > 9) {
      showToast('中文譯名最多只能儲存 9 個，已保留前 9 個');
      updateTerm(t.id, 'zh', parts.slice(0, 9).join(';'));
    }
  };

  return (
    <tr>
      <td className="ja">
        <input value={t.ja} data-field="ja" data-id={t.id}
               onChange={e => updateTerm(t.id, 'ja', e.target.value)} />
      </td>
      <td>
        <input value={t.zh} data-field="zh" data-id={t.id} placeholder="魄力;張力;氣勢"
               onChange={e => updateTerm(t.id, 'zh', e.target.value)}
               onBlur={e => trimZh(e.target.value)} />
      </td>
      <td><span className="source-tag">{t.srcLang || 'ja'}&nbsp;▶&nbsp;{t.tgtLang || 'zh-TW'}</span></td>
      <td><span className="source-tag">{t.source || '—'}</span></td>
      <td>{t.tag ? <span className="term-tag-chip">{t.tag}</span> : <span className="source-tag">—</span>}</td>
      <td>
        <input value={t.note || ''} data-field="note" data-id={t.id} placeholder="備註"
               onChange={e => updateTerm(t.id, 'note', e.target.value)} />
      </td>
      <td>
        <button className="row-del" data-id={t.id} title="刪除" onClick={() => deleteTerm(t.id)}>
          <i className="bi bi-x-lg"></i>
        </button>
      </td>
    </tr>
  );
}

export default function TermsTab() {
  const termBase = useStore(s => s.termBase);
  const documents = useStore(s => s.documents);
  const currentDocId = useStore(s => s.currentDocId);
  const ingestSrc = useStore(s => s.ingestSrcLang);
  const ingestTgt = useStore(s => s.ingestTgtLang);
  const addTerm = useStore(s => s.addTerm);
  const importTerms = useStore(s => s.importTerms);
  const showToast = useStore(s => s.showToast);

  const [kw, setKw] = useState('');
  const [page, setPage] = useState(1);
  const [exportOpen, setExportOpen] = useState(false);   // V59 匯出格式 Modal
  const [importStaged, setImportStaged] = useState(null); // V60 匯入確認 Modal 暫存

  const kwT = kw.trim();
  // V54：搜尋涵蓋標籤（標籤是術語的屬性之一，沿用同一個搜尋框）
  const filtered = termBase.filter(t => !kwT || t.ja.includes(kwT) || t.zh.includes(kwT) || (t.tag || '').includes(kwT));
  const cur = clampPage(page, filtered.length);
  const rows = filtered.slice((cur - 1) * PAGE_SIZE, cur * PAGE_SIZE);

  const onAdd = () => {
    // 配對優先跟隨目前開啟中的檔案，沒有開檔才退回入稿區選擇，再退回預設
    const doc = documents.find(d => d.id === currentDocId) || null;
    const ingestReady = !!ingestSrc && !!ingestTgt && ingestSrc !== ingestTgt;
    const p = doc ? docPair(doc)
      : ingestReady ? { src: ingestSrc, tgt: ingestTgt }
      : docPair(null);
    addTerm({ id: cid(), ja: '', zh: '', note: '', tag: '', source: '', srcLang: p.src, tgtLang: p.tgt });
    setPage(1);   // 新詞條插在最前面，跳回第 1 頁讓使用者看得到
    setTimeout(() => document.querySelector('#term-tbody input[data-field="ja"]')?.focus());
  };

  /* V59：匯出 Modal 勾選格式（xlsx＝依語言對分工作表／JSON＝既有格式）→ 匯出鈕一次執行；
     可指定儲存路徑（picker 取消回傳 0 不跳 Toast） */
  const openExport = () => {
    if (termBase.length === 0) { showToast('尚無詞彙可匯出'); return; }
    setExportOpen(true);
  };
  const exportGroups = [{
    label: '',
    row: true,   // V59 微調：單群組按鈕水平並排
    options: [
      { id: 'terms-export-xlsx', key: 'xlsx', label: 'xlsx' },
      { id: 'terms-export-json', key: 'json', label: 'JSON' }
    ]
  }];
  const onExportSubmit = async (fmts) => {
    setExportOpen(false);
    const n = await exportTerms(termBase, fmts);
    if (n > 0) showToast(`已匯出詞彙（${n} 個檔案）`);
  };

  /* V60：xlsx（依語言對分工作表，與匯出對稱）＋JSON 同一條管線——
     解析→去重（同語言對＋同原文＋同譯文＝重複跳過，譯文不同並存）→確認 Modal 才入庫 */
  const onImport = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { rows, skippedLang, skippedSheets } = await parseTermsFile(file);
      const { fresh, dupCount } = dedupeRows(rows, termBase);
      setImportStaged({ fileName: file.name, fresh, dupCount, skippedLang, skippedSheets });
    } catch (err) {
      showToast('匯入解析失敗：' + err.message);
    }
  };
  const onImportConfirm = () => {
    const fresh = importStaged.fresh;
    importTerms(fresh.map(r => ({ id: cid(), ...r })));
    setImportStaged(null);
    setPage(1);
    autoSaveAfterSegTool();   // 批量入庫即存雲端（訪客靜默交保底機制）
    showToast(`已匯入 ${fresh.length} 筆詞彙`);
  };

  return (
    <div className="card">
      <div className="table-toolbar">
        <span className="search-wrap">
          <i className="bi bi-search"></i>
          <input className="search-box" id="term-search" placeholder="搜尋原文、譯名或標籤…"
                 value={kw} onChange={e => { setKw(e.target.value); setPage(1); }} />
        </span>
        <span className="search-no-result" id="term-no-result"
              style={{ display: (kwT && filtered.length === 0) ? 'inline' : 'none' }}>無匹配的搜尋結果</span>
        {/* V59：三鈕改純 icon＋data-tip（匯出開格式 Modal；匯入維持 JSON） */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="icon-btn" id="btn-add-term" data-tip="新增詞條" onClick={onAdd}>
            <i className="bi bi-pencil"></i>
          </button>
          <button className="icon-btn" id="btn-export-terms" data-tip="匯出詞彙" onClick={openExport}>
            <i className="bi bi-cloud-download"></i>
          </button>
          <label className="icon-btn tip-right" data-tip="匯入詞彙（xlsx / JSON）" style={{ margin: 0, display: 'inline-block' }}>
            <i className="bi bi-cloud-plus"></i>
            <input type="file" id="file-import-terms" accept=".xlsx,.json" onChange={onImport} />
          </label>
        </div>
      </div>
      <div className="table-scroll">
        <table>
          <thead><tr>
            <th style={{ width: '24%' }}>原文</th>
            <th style={{ width: '24%' }}>譯名（可用「;」並列多個）</th>
            <th style={{ width: 110 }}>語言</th>
            <th style={{ width: 80 }}>出處</th>
            <th style={{ width: 80 }}>標籤</th>
            <th>備註</th>
            <th style={{ width: 36 }}></th>
          </tr></thead>
          <tbody id="term-tbody">
            {rows.map(t => <TermRow key={t.id} t={t} />)}
          </tbody>
        </table>
      </div>
      <div id="term-pagination">
        <Pagination total={filtered.length} page={cur} onPage={setPage} />
      </div>
      <div className="empty" id="term-empty" style={{ display: termBase.length === 0 ? 'block' : 'none' }}>
        尚無術語。點右上「新增詞條」圖示或在翻譯工作區反白原文新增。
      </div>
      {exportOpen &&
        <ExportModal title="匯出詞彙" groups={exportGroups}
                     submitId="terms-export-submit" submitLabel="匯出詞彙"
                     onSubmit={onExportSubmit} onClose={() => setExportOpen(false)} />}
      {importStaged &&
        <ImportConfirmModal title="匯入詞彙" staged={importStaged}
                            onConfirm={onImportConfirm} onClose={() => setImportStaged(null)} />}
    </div>
  );
}
