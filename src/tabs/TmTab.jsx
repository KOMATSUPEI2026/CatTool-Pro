import { useState } from 'react';
import { useStore } from '../store.js';
import { cid, downloadJSON, importJSON } from '../utils.js';
import Pagination, { PAGE_SIZE, clampPage } from '../components/Pagination.jsx';

export default function TmTab() {
  const tmSegments = useStore(s => s.tmSegments);
  const deleteTmSegment = useStore(s => s.deleteTmSegment);
  const importTmSegments = useStore(s => s.importTmSegments);
  const showToast = useStore(s => s.showToast);

  const [kw, setKw] = useState('');
  const [page, setPage] = useState(1);

  const kwT = kw.trim();
  const filtered = tmSegments.filter(t => !kwT || t.ja.includes(kwT) || t.zh.includes(kwT));
  const cur = clampPage(page, filtered.length);
  const rows = filtered.slice((cur - 1) * PAGE_SIZE, cur * PAGE_SIZE);

  const onExport = () => {
    downloadJSON(tmSegments.map(t => {
      const sl = t.srcLang || 'ja', tl = t.tgtLang || 'zh-TW';
      return { [sl]: t.ja, [tl]: t.zh, source: t.source || '', srcLang: sl, tgtLang: tl };
    }), 'tm.json');
  };

  const onImport = (e) => {
    importJSON(e.target.files[0], (data) => {
      if (!Array.isArray(data)) { showToast('檔案格式不正確（需為陣列）'); return; }
      const incoming = [];
      data.forEach(d => {
        const sl = d.srcLang || 'ja', tl = d.tgtLang || 'zh-TW';
        const src = d[sl] !== undefined ? d[sl] : d.ja;   // 新格式動態鍵，退回舊格式 ja
        const tgt = d[tl] !== undefined ? d[tl] : d.zh;
        if (src) incoming.push({ id: cid(), ja: src, zh: tgt || '', source: d.source || '', srcLang: sl, tgtLang: tl });
      });
      importTmSegments(incoming);
    }, (msg) => showToast('JSON 解析失敗：' + msg));
    e.target.value = '';
  };

  return (
    <div className="card">
      <div className="table-toolbar">
        <input className="search-box" id="tm-search" placeholder="搜尋原文或譯文…"
               value={kw} onChange={e => { setKw(e.target.value); setPage(1); }} />
        <span className="search-no-result" id="tm-no-result"
              style={{ display: (kwT && filtered.length === 0) ? 'inline' : 'none' }}>無匹配的搜尋結果</span>
        <div style={{ display: 'flex', gap: 16 }}>
          <button className="btn outline small" id="btn-export-tm" onClick={onExport}>匯出 JSON</button>
          <label className="btn outline small" style={{ margin: 0 }}>
            匯入 JSON<input type="file" id="file-import-tm" accept="application/json" onChange={onImport} />
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
                  <button className="row-del" data-tmid={t.id} title="刪除" onClick={() => deleteTmSegment(t.id)}>
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
    </div>
  );
}
