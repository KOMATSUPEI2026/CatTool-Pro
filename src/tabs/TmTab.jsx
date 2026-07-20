import { useState } from 'react';
import { useStore } from '../store.js';
import { cid } from '../utils.js';
import Pagination, { PAGE_SIZE, clampPage } from '../components/Pagination.jsx';
import ExportModal from '../components/ExportModal.jsx';
import ImportConfirmModal from '../components/ImportConfirmModal.jsx';
import { exportTm, tmTmxFiles } from '../exporters.js';
import { parseTmFile, dedupeRows } from '../importers.js';
import { autoSaveAfterSegTool } from '../cloud.js';

export default function TmTab() {
  const tmSegments = useStore(s => s.tmSegments);
  const deleteTmSegment = useStore(s => s.deleteTmSegment);
  const importTmSegments = useStore(s => s.importTmSegments);
  const showToast = useStore(s => s.showToast);

  const [kw, setKw] = useState('');
  const [page, setPage] = useState(1);
  const [exportOpen, setExportOpen] = useState(false);   // V59 匯出格式 Modal
  const [importStaged, setImportStaged] = useState(null); // V60 匯入確認 Modal 暫存

  const kwT = kw.trim();
  const filtered = tmSegments.filter(t => !kwT || t.ja.includes(kwT) || t.zh.includes(kwT));
  const cur = clampPage(page, filtered.length);
  const rows = filtered.slice((cur - 1) * PAGE_SIZE, cur * PAGE_SIZE);

  /* V59：匯出 Modal 勾選格式（TMX＝依語言對分檔／xlsx＝單表五欄／JSON＝既有格式）
     → 匯出鈕一次執行；可指定儲存路徑（picker 取消回傳 0 不跳 Toast） */
  const openExport = () => {
    if (tmSegments.length === 0) { showToast('尚無翻譯記憶可匯出'); return; }
    setExportOpen(true);
  };
  const exportGroups = [{
    label: '',
    row: true,   // V59 微調：單群組按鈕水平並排
    options: [
      { id: 'tm-export-tmx', key: 'tmx', label: 'TMX' },
      { id: 'tm-export-xlsx', key: 'xlsx', label: 'xlsx' },
      { id: 'tm-export-json', key: 'json', label: 'JSON' }
    ]
  }];
  const onExportSubmit = async (fmts) => {
    setExportOpen(false);
    // TMX 全庫皆空譯文＝無檔可產：只勾 TMX 直接擋下，混勾其他格式則濾掉 TMX 照出
    const skipTmx = fmts.includes('tmx') && tmTmxFiles(tmSegments).length === 0;
    const use = skipTmx ? fmts.filter(f => f !== 'tmx') : fmts;
    if (use.length === 0) { showToast('沒有含譯文的記憶可匯出 TMX'); return; }
    const n = await exportTm(tmSegments, use);
    if (n > 0) showToast(skipTmx ? `已匯出 ${n} 個檔案（無含譯文記憶，TMX 略過）` : `已匯出翻譯記憶（${n} 個檔案）`);
  };

  /* V60：TMX（多語攤平成多語言對）＋xlsx（五欄，與匯出對稱）＋JSON 同一條管線——
     解析→去重（同語言對＋同原文＋同譯文＝重複跳過，譯文不同並存）→確認 Modal 才入庫 */
  const onImport = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { rows, skippedLang, skippedSheets, skippedEmpty } = await parseTmFile(file);
      const { fresh, dupCount } = dedupeRows(rows, tmSegments);
      setImportStaged({ fileName: file.name, fresh, dupCount, skippedLang, skippedSheets, skippedEmpty });
    } catch (err) {
      showToast('匯入解析失敗：' + err.message);
    }
  };
  const onImportConfirm = () => {
    const fresh = importStaged.fresh;
    importTmSegments(fresh.map(r => ({ id: cid(), ...r })));
    setImportStaged(null);
    setPage(1);
    autoSaveAfterSegTool();   // 批量入庫即存雲端（訪客靜默交保底機制）
    showToast(`已匯入 ${fresh.length} 筆翻譯記憶`);
  };

  return (
    <div className="card">
      <div className="table-toolbar">
        <span className="search-wrap">
          <i className="bi bi-search"></i>
          <input className="search-box" id="tm-search" placeholder="搜尋原文或譯文…"
                 value={kw} onChange={e => { setKw(e.target.value); setPage(1); }} />
        </span>
        <span className="search-no-result" id="tm-no-result"
              style={{ display: (kwT && filtered.length === 0) ? 'inline' : 'none' }}>無匹配的搜尋結果</span>
        {/* V59：雙鈕改純 icon＋data-tip（匯出開格式 Modal；匯入維持 JSON） */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="icon-btn" id="btn-export-tm" data-tip="匯出翻譯記憶" onClick={openExport}>
            <i className="bi bi-cloud-download"></i>
          </button>
          <label className="icon-btn tip-right" data-tip="匯入翻譯記憶（TMX / xlsx / JSON）" style={{ margin: 0, display: 'inline-block' }}>
            <i className="bi bi-cloud-plus"></i>
            <input type="file" id="file-import-tm" accept=".tmx,.xlsx,.json" onChange={onImport} />
          </label>
        </div>
      </div>
      <div className="table-scroll">
        <table>
          <thead><tr>
            <th style={{ width: '40%' }}>原文</th>
            <th>譯文</th>
            <th style={{ width: 110 }}>語言</th>
            <th style={{ width: 80 }}>出處</th>
            <th style={{ width: 36 }}></th>
          </tr></thead>
          <tbody id="tm-tbody">
            {rows.map(t => (
              <tr key={t.id}>
                <td className="ja">{t.ja}</td>
                <td>{t.zh}</td>
                <td><span className="source-tag">{t.srcLang || 'ja'}&nbsp;▶&nbsp;{t.tgtLang || 'zh-TW'}</span></td>
                <td><span className="source-tag">{t.source || '—'}</span></td>
                <td>
                  <button className="row-del" data-tmid={t.id} title="刪除"
                          onClick={() => { deleteTmSegment(t.id); autoSaveAfterSegTool(); }}>
                    <i className="bi bi-x-lg"></i>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div id="tm-pagination">
        <Pagination total={filtered.length} page={cur} onPage={setPage} />
      </div>
      <div className="empty" id="tm-empty" style={{ display: tmSegments.length === 0 ? 'block' : 'none' }}>
        尚無翻譯記憶。在翻譯工作區的譯文欄按 Tab 鍵即可將句段存入記憶。
      </div>
      {exportOpen &&
        <ExportModal title="匯出翻譯記憶" groups={exportGroups}
                     submitId="tm-export-submit" submitLabel="匯出翻譯記憶"
                     onSubmit={onExportSubmit} onClose={() => setExportOpen(false)} />}
      {importStaged &&
        <ImportConfirmModal title="匯入翻譯記憶" staged={importStaged}
                            onConfirm={onImportConfirm} onClose={() => setImportStaged(null)} />}
    </div>
  );
}
