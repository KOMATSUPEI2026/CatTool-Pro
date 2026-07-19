import { useState } from 'react';
import { useStore } from '../store.js';
import { cid, segmentText, uniqueDocName, langName, LANG_NAMES } from '../utils.js';
import { parseXliffString, parseDocxFile } from '../importers.js';

const SRC_OPTS = ['ja', 'zh-TW', 'zh-HK', 'zh-CN', 'zh-SG', 'en', 'en-US', 'en-GB', 'ko', 'fr', 'de', 'es', 'vi', 'th'];
const TGT_OPTS = ['zh-TW', 'zh-HK', 'zh-CN', 'zh-SG', 'en', 'en-US', 'en-GB', 'ja', 'ko', 'fr', 'de', 'es', 'vi', 'th'];

const DROP_IDLE = { title: '拖入 .xlsx／.xlf／.docx 檔案', detail: '或點擊選擇檔案｜xlsx 每個分頁（P001、P002…）建立一個文件；XLIFF 依檔內語系自動建檔；docx＝原文入稿自動分句' };

export default function IngestTab() {
  const src = useStore(s => s.ingestSrcLang);
  const tgt = useStore(s => s.ingestTgtLang);
  const setIngestLang = useStore(s => s.setIngestLang);
  const documents = useStore(s => s.documents);
  const addDocuments = useStore(s => s.addDocuments);
  const showToast = useStore(s => s.showToast);

  const [docName, setDocName] = useState('');
  const [rawText, setRawText] = useState('');
  const [prefix, setPrefix] = useState('');
  const [staged, setStaged] = useState(null);     // { fileName, sheets:[{name, rows:[{ja, zh, srcNo}]}], src, tgt, skipped }
  const [dropMsg, setDropMsg] = useState(DROP_IDLE); // 未暫存時拖放區的提示文字
  const [dragover, setDragover] = useState(false);
  const [mismatch, setMismatch] = useState(null); // { fileName, src, tgt, detected:[] }

  const ready = !!src && !!tgt && src !== tgt;

  /* 閘門：語系未配對完成前，貼上與 xlsx 兩條入稿路徑都封鎖；配對改變時作廢已暫存的 xlsx。
     V60：XLIFF 語系以檔內宣告為準、不受閘門限制，語系改變也不作廢 xlf 暫存 */
  const onLangChange = (which, value) => {
    if (staged && !staged.isXliff) {
      // 語系改變 → 已暫存的 xlsx 是用舊語系解析的，一律作廢重拖
      setStaged(null);
      setDropMsg({ title: '拖入 .xlsx／.xlf 檔案', detail: '語系配對已變更，請重新拖入檔案｜每個分頁（P001、P002…）建立一個文件' });
    }
    setIngestLang(which, value);
  };

  /* ---------- 貼上原文建檔 ---------- */
  const onSegment = () => {
    if (!ready) { showToast('請先選擇來源與目標語系（兩者不可相同）。'); return; }
    const parts = segmentText(rawText);
    if (parts.length === 0) { showToast(`請先貼上${langName(src)}原文`); return; }
    const name = uniqueDocName(docName.trim() || ('未命名文件' + (documents.length + 1)), documents);
    const now = Date.now();
    addDocuments([{
      id: cid(), name, folderId: null,
      srcLang: src, tgtLang: tgt,
      segments: parts.map(p => ({ id: cid(), ja: p, zh: '', confirmed: false, reviewed: false, tmId: null })),
      createdAt: now, updatedAt: now
    }]);
    setRawText('');
    setDocName('');
  };

  /* ---------- V60：XLIFF 解析暫存（語系以檔內宣告為準，不走語系閘門） ---------- */
  const parseXlfFile = (file) => {
    file.text().then(text => {
      const fallback = file.name.replace(/\.xlf$/i, '');
      const { src: xs, tgt: xt, sheets, skipped } = parseXliffString(text, fallback);
      setStaged({ fileName: file.name, sheets, src: xs, tgt: xt, skipped, isXliff: true });
    }).catch(err => {
      setStaged(null);
      setDropMsg({ title: 'XLIFF 解析失敗', detail: err.message || '檔案可能損壞，請重新拖入 .xlf' });
    });
  };

  /* ---------- V60 微調：docx 原文入稿（走語系閘門；抽段落→貼上入稿同款分句規則） ---------- */
  const parseDocxDrop = (file) => {
    if (!ready) {
      setStaged(null);
      setDropMsg({ title: '請先選擇語系', detail: '選好來源與目標語系後，再拖入 .docx 檔案' });
      return;
    }
    parseDocxFile(file).then(paras => {
      const parts = segmentText(paras.join('\n'));
      if (parts.length === 0) {
        setStaged(null);
        setDropMsg({ title: '讀不到可匯入的資料', detail: 'docx 內沒有文字段落' });
        return;
      }
      const name = file.name.replace(/\.docx$/i, '');
      setStaged({
        fileName: file.name, src, tgt, skipped: [], isDocx: true,
        sheets: [{ name, rows: parts.map(t => ({ ja: t, zh: '', srcNo: null })) }]
      });
    }).catch(err => {
      setStaged(null);
      setDropMsg({ title: 'docx 解析失敗', detail: err.message || '檔案可能損壞，請重新拖入 .docx' });
    });
  };

  /* ---------- 檔案分流＋xlsx 解析暫存 ---------- */
  const parseDropFile = (file) => {
    if (/\.xlf$/i.test(file.name)) { parseXlfFile(file); return; }
    if (/\.docx$/i.test(file.name)) { parseDocxDrop(file); return; }
    if (!/\.xlsx$/i.test(file.name)) {
      setStaged(null);
      setDropMsg({ title: '檔案格式不符', detail: '請拖入 .xlsx、.xlf 或 .docx 檔案' });
      return;
    }
    if (!ready) {
      setStaged(null);
      setDropMsg({ title: '請先選擇語系', detail: '選好來源與目標語系後，再拖入 .xlsx／.docx 檔案（.xlf 依檔內語系、不需先選）' });
      return;
    }
    Promise.all([import('xlsx'), file.arrayBuffer()]).then(([XLSX, buf]) => {
      const wb = XLSX.read(buf);
      const sheets = [];
      const skipped = [];
      const mismatched = [];                       // 表頭缺來源或目標欄的分頁
      const detectedCodes = new Set();             // 表頭中偵測到的已知語系代碼（供報錯提示）
      const langCodesLower = Object.keys(LANG_NAMES).map(c => c.toLowerCase());
      wb.SheetNames.forEach(sn => {
        const grid = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: null });
        if (grid.length < 2) { skipped.push(sn); return; }
        // 依表頭列找欄位：來源語系欄／目標語系欄（大小寫不敏感，zh-TW 可對上 zh-tw）／標號
        const header = grid[0].map(h => h === null ? '' : String(h).trim());
        const headerLower = header.map(h => h.toLowerCase());
        const srcCol = headerLower.indexOf(src.toLowerCase());
        const tgtCol = headerLower.indexOf(tgt.toLowerCase());
        const noCol = header.indexOf('標號');
        // 雙欄必備：來源與目標語系欄缺一即擋（避免選錯配對時無聲匯入）
        if (srcCol === -1 || tgtCol === -1) {
          headerLower.forEach((h, i) => { if (langCodesLower.includes(h)) detectedCodes.add(header[i]); });
          mismatched.push(sn);
          return;
        }
        const rows = [];
        for (let r = 1; r < grid.length; r++) {
          const ja = grid[r][srcCol] === null ? '' : String(grid[r][srcCol]).replace(/\r\n?/g, '\n').trim();
          const zh = grid[r][tgtCol] !== null ? String(grid[r][tgtCol]).replace(/\r\n?/g, '\n').trim() : '';
          if (!ja && !zh) continue;   // 空白模板列略過
          const srcNo = (noCol !== -1 && grid[r][noCol] !== null) ? String(grid[r][noCol]).trim() : null;
          rows.push({ ja, zh, srcNo });
        }
        if (rows.length > 0) sheets.push({ name: sn, rows });
        else skipped.push(sn);
      });
      if (sheets.length === 0) {
        setStaged(null);
        if (mismatched.length > 0) {
          // 全部分頁表頭欄位不符 → 置中 Modal 報錯，拖放區回初始提示
          setDropMsg(DROP_IDLE);
          setMismatch({ fileName: file.name, src, tgt, detected: [...detectedCodes] });
        } else {
          setDropMsg({ title: '讀不到可匯入的資料', detail: `請確認分頁表頭含「${src}」與「${tgt}」兩欄，且至少一列有內容` });
        }
        return;
      }
      const skippedAll = [...skipped, ...mismatched.map(sn => `${sn}（表頭欄位不符）`)];
      setStaged({ fileName: file.name, sheets, src, tgt, skipped: skippedAll });
    }).catch(() => {
      setStaged(null);
      setDropMsg({ title: '解析失敗', detail: '檔案可能損壞，請重新拖入 .xlsx' });
    });
  };

  /* ---------- xlsx 建檔 ---------- */
  const onXlsxCreate = () => {
    if (!staged) return;
    const pfx = prefix.trim();
    const now = Date.now();
    const docs = [];
    staged.sheets.forEach(sheet => {
      const baseName = pfx ? `${pfx}-${sheet.name}` : sheet.name;
      docs.push({
        id: cid(), name: uniqueDocName(baseName, [...documents, ...docs]), folderId: null,
        srcLang: staged.src, tgtLang: staged.tgt,
        segments: sheet.rows.map(r => ({ id: cid(), ja: r.ja, zh: r.zh, confirmed: false, reviewed: false, tmId: null, srcNo: r.srcNo })),
        createdAt: now, updatedAt: now
      });
    });
    addDocuments(docs);
    // 重置暫存與 UI
    setStaged(null);
    setPrefix('');
    setDropMsg(DROP_IDLE);
  };

  const gateHint = ready
    ? `已選擇：${langName(src)}（${src}）→ ${langName(tgt)}（${tgt}）`
    : (src && tgt && src === tgt) ? '來源與目標語系不可相同' : '請先選擇來源與目標語系，才能匯入稿件';

  const totalSegs = staged ? staged.sheets.reduce((sum, s) => sum + s.rows.length, 0) : 0;

  return (
    <>
      <div className="card import-box lang-bar">
        <div className="lang-pair">
          <label htmlFor="src-lang">來源語系</label>
          <select id="src-lang" className="lang-select" value={src} onChange={e => onLangChange('src', e.target.value)}>
            <option value="">請選擇</option>
            {SRC_OPTS.map(c => <option key={c} value={c}>{langName(c)}（{c}）</option>)}
          </select>
          <i className="bi bi-arrow-right lang-arrow"></i>
          <label htmlFor="tgt-lang">目標語系</label>
          <select id="tgt-lang" className="lang-select" value={tgt} onChange={e => onLangChange('tgt', e.target.value)}>
            <option value="">請選擇</option>
            {TGT_OPTS.map(c => <option key={c} value={c}>{langName(c)}（{c}）</option>)}
          </select>
          <span className={'hint' + (ready ? ' ready' : '')} id="lang-gate-hint">{gateHint}</span>
        </div>
      </div>

      <div className="card import-box">
        <label>文件名稱</label>
        <input type="text" id="doc-name-input" className="doc-name-input" placeholder="例：P010（留空則自動命名）"
               value={docName} onChange={e => setDocName(e.target.value)} />
        <label id="paste-label">
          {ready ? `貼上${langName(src)}原文，點擊「建立檔案」拆成句子後送入專案管理區`
                 : '貼上原文，點擊「建立檔案」拆成句子後送入專案管理區'}
        </label>
        <textarea id="raw-input" value={rawText} onChange={e => setRawText(e.target.value)}
                  placeholder="例：迫力のあるポーズを描くには、まず重心の位置を意識することが大切です。パースを正しく取ることで、画面に奥行きが生まれます。"></textarea>
        <div className="import-row">
          <span className="hint">以「。！？」與換行自動分段</span>
          <button className="btn vermilion" id="btn-segment" disabled={!ready} onClick={onSegment}>
            建立檔案 <i className="bi bi-arrow-right"></i>
          </button>
        </div>
      </div>

      <div className="card import-box">
        <label>前綴欄位（可留空）</label>
        <input type="text" id="xlsx-prefix" className="doc-name-input"
               placeholder="例：迫力（文件名將為「迫力-P030」；留空則直接用分頁名 P030）"
               value={prefix} onChange={e => setPrefix(e.target.value)} />
        <label>拖入 Excel、XLIFF（.xlf）或 Word（.docx）資料後，點擊「建立檔案」送入專案管理區</label>
        <div className={'xlsx-drop' + (staged ? ' staged' : '') + (dragover ? ' dragover' : '')} id="xlsx-drop"
             onClick={() => document.getElementById('xlsx-file').click()}
             onDragOver={e => { e.preventDefault(); setDragover(true); }}
             onDragLeave={() => setDragover(false)}
             onDrop={e => {
               e.preventDefault();
               setDragover(false);
               if (e.dataTransfer.files[0]) parseDropFile(e.dataTransfer.files[0]);
             }}>
          {staged ? (
            <>
              <div className="staged-file"><i className="bi bi-file-earmark-spreadsheet"></i> {staged.fileName}</div>
              <div className="staged-detail">{staged.sheets.length} 個分頁、共 {totalSegs} 個句段</div>
              {staged.isXliff &&
                <div className="staged-detail" id="xlf-lang-detail">
                  檔內語系：{langName(staged.src)}（{staged.src}）→ {langName(staged.tgt)}（{staged.tgt}）
                </div>}
              <div className="staged-detail">{staged.sheets.map(s => `${s.name}（${s.rows.length} 段）`).join('、')}</div>
              {staged.skipped.length > 0 &&
                <div className="staged-detail">略過分頁：{staged.skipped.join('、')}</div>}
              <div className="staged-detail">重新拖入或點擊可更換檔案</div>
            </>
          ) : (
            <>
              <div className="drop-title">{dropMsg.title}</div>
              <div>{dropMsg.detail}</div>
            </>
          )}
        </div>
        <input type="file" id="xlsx-file" accept=".xlsx,.xlf,.docx"
               onChange={e => {
                 if (e.target.files[0]) parseDropFile(e.target.files[0]);
                 e.target.value = '';
               }} />
        <div className="import-row">
          <span className="hint" id="xlsx-col-hint">
            {ready ? `僅讀取 ${src} / ${tgt} 兩欄；空白模板列自動略過`
                   : '僅讀取來源／目標語系兩欄；空白模板列自動略過'}
          </span>
          <button className="btn vermilion" id="btn-xlsx-create"
                  disabled={!staged || (!staged.isXliff && !ready)} onClick={onXlsxCreate}>
            建立檔案 <i className="bi bi-arrow-right"></i>
          </button>
        </div>
      </div>
      <div className="empty">建立後會自動切換到「專案管理區」，請在那裡開啟檔案進行翻譯</div>

      {/* 語系配對與檔案表頭不符 → 置中報錯 Modal（雙欄必備） */}
      {mismatch &&
        <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setMismatch(null); }}>
          <div className="modal-card modal-card-center modal-card-wide">
            <h3>語系配對與檔案不符</h3>
            <p className="modal-confirm-text">
              所選配對：{langName(mismatch.src)}（{mismatch.src}）→ {langName(mismatch.tgt)}（{mismatch.tgt}）<br />
              「{mismatch.fileName}」表頭偵測到的語系欄：
              {mismatch.detected.length ? mismatch.detected.map(c => `「${c}」`).join('、') : '（未偵測到已知語系代碼欄）'}<br />
              請改選正確的語系配對，或確認檔案表頭欄名後重新拖入。
            </p>
            <div className="modal-actions modal-actions-center">
              <button className="btn vermilion large" id="xlsx-mismatch-ok" onClick={() => setMismatch(null)}>我知道了</button>
            </div>
          </div>
        </div>}
    </>
  );
}
