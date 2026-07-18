import { useState } from 'react';
import { useStore } from '../store.js';
import { cid, docPair, downloadJSON, importJSON } from '../utils.js';
import Pagination, { PAGE_SIZE, clampPage } from '../components/Pagination.jsx';

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

  const onExport = () => {
    downloadJSON(termBase.map(t => {
      const sl = t.srcLang || 'ja', tl = t.tgtLang || 'zh-TW';
      return { [sl]: t.ja, [tl]: t.zh, note: t.note, tag: t.tag || '', source: t.source || '', srcLang: sl, tgtLang: tl };
    }), 'termbase.json');
  };

  const onImport = (e) => {
    importJSON(e.target.files[0], (data) => {
      if (!Array.isArray(data)) { showToast('檔案格式不正確（需為陣列）'); return; }
      const incoming = [];
      data.forEach(d => {
        const sl = d.srcLang || 'ja', tl = d.tgtLang || 'zh-TW';
        const src = d[sl] !== undefined ? d[sl] : d.ja;   // 新格式動態鍵，退回舊格式 ja
        const tgt = d[tl] !== undefined ? d[tl] : d.zh;   // 新格式動態鍵，退回舊格式 zh
        if (src) incoming.push({ id: cid(), ja: src, zh: tgt || '', note: d.note || '', tag: d.tag || '', source: d.source || '', srcLang: sl, tgtLang: tl });
      });
      importTerms(incoming);
    }, (msg) => showToast('JSON 解析失敗：' + msg));
    e.target.value = '';
  };

  return (
    <div className="card">
      <div className="table-toolbar">
        <input className="search-box" id="term-search" placeholder="搜尋原文、譯名或標籤…"
               value={kw} onChange={e => { setKw(e.target.value); setPage(1); }} />
        <span className="search-no-result" id="term-no-result"
              style={{ display: (kwT && filtered.length === 0) ? 'inline' : 'none' }}>無匹配的搜尋結果</span>
        <div style={{ display: 'flex', gap: 16 }}>
          <button className="btn outline small" id="btn-add-term" onClick={onAdd}>+ 新增詞條</button>
          <button className="btn outline small" id="btn-export-terms" onClick={onExport}>匯出 JSON</button>
          <label className="btn outline small" style={{ margin: 0 }}>
            匯入 JSON<input type="file" id="file-import-terms" accept="application/json" onChange={onImport} />
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
        尚無術語。點「+新增詞條」或在翻譯工作區反白原文新增。
      </div>
    </div>
  );
}
