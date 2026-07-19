/* V59 匯出格式產生器：xlsx／TMX 1.4b／XLIFF 1.2／XLIFF 2.0／JSON（沿用既有格式）。
   設計依據＝「校譯台_匯出格式規格_交接文件.md」（Termsoup 實測檔為基準）：
   - 只用各格式核心節點、純文字不塞格式標籤、不自創 namespace（互通性關鍵）
   - TMX＝記憶庫語意，略過空譯文；XLIFF＝工作檔語意，全句段輸出（空 target＝待譯）
   - TMX header 的 srclang 是單值 → TM 依語言對分檔，天生對應嚴格語系隔離
   - 雙語 xlsx 表頭＝「標號｜來源語系代碼｜目標語系代碼」，與入稿模板同構，可直接再匯入
   儲存＝可指定路徑（V59 微調：File System Access API，單檔 showSaveFilePicker／多檔
   showDirectoryPicker 選一次資料夾逐檔寫入；API 不支援退回傳統下載、使用者取消＝中止不產檔）。
   ja/zh 為內部儲存鍵名（歷史慣例），實際語言由 srcLang/tgtLang 決定 */
import { langName } from './utils.js';

/* ---------- 儲存層 ---------- */
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
/* fallback 多檔連續下載一律 300ms 錯開（V58 定案）：瀏覽器把連續程式化下載視為一次手勢只放行第一個 */
const STAGGER_MS = 300;

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
function pickerTypes(filename) {
  if (filename.endsWith('.xlsx')) return [{ description: 'Excel 活頁簿', accept: { [XLSX_MIME]: ['.xlsx'] } }];
  if (filename.endsWith('.docx')) return [{ description: 'Word 文件', accept: { [DOCX_MIME]: ['.docx'] } }];
  if (filename.endsWith('.json')) return [{ description: 'JSON', accept: { 'application/json': ['.json'] } }];
  if (filename.endsWith('.tmx')) return [{ description: 'TMX 翻譯記憶', accept: { 'application/xml': ['.tmx'] } }];
  if (filename.endsWith('.xlf')) return [{ description: 'XLIFF 雙語工作檔', accept: { 'application/xml': ['.xlf'] } }];
  return undefined;
}

/* 單檔：先開存檔對話框保住使用者手勢，再產生內容寫入（makeBlob 延遲執行）。
   回傳實際存檔數（0＝使用者取消）；AbortError 以外的失敗退回傳統下載 */
async function saveOne(spec) {
  if (typeof window.showSaveFilePicker === 'function') {
    try {
      const handle = await window.showSaveFilePicker({ suggestedName: spec.filename, types: pickerTypes(spec.filename) });
      const blob = await spec.makeBlob();
      const w = await handle.createWritable();
      await w.write(blob); await w.close();
      return 1;
    } catch (err) {
      if (err && err.name === 'AbortError') return 0;   // 使用者取消＝中止，不退回下載
    }
  }
  downloadBlob(await spec.makeBlob(), spec.filename);
  return 1;
}

/* 多檔：選一次資料夾、逐檔寫入（不支援則退回傳統下載逐檔錯開） */
async function saveMany(specs) {
  if (specs.length === 1) return saveOne(specs[0]);
  if (typeof window.showDirectoryPicker === 'function') {
    try {
      const dir = await window.showDirectoryPicker({ mode: 'readwrite' });
      for (const spec of specs) {
        const handle = await dir.getFileHandle(spec.filename, { create: true });
        const blob = await spec.makeBlob();
        const w = await handle.createWritable();
        await w.write(blob); await w.close();
      }
      return specs.length;
    } catch (err) {
      if (err && err.name === 'AbortError') return 0;
    }
  }
  specs.forEach((spec, i) =>
    setTimeout(async () => downloadBlob(await spec.makeBlob(), spec.filename), i * STAGGER_MS));
  return specs.length;
}

const xmlBlob = (text) => new Blob([text], { type: 'application/xml' });
const jsonBlob = (data) => new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });

/* ---------- xlsx ---------- */
/* 分頁名限制：不可含 [ ] : * ? / \、上限 31 字 */
function sheetName(name) {
  const s = String(name || '').replace(/[[\]:*?/\\]/g, '').slice(0, 31);
  return s || 'Sheet1';
}
async function xlsxBlob(sheets) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const used = new Set();
  sheets.forEach((sh, i) => {
    let name = sheetName(sh.name);
    while (used.has(name)) name = sheetName(name.slice(0, 28) + '_' + (i + 1));
    used.add(name);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sh.rows), name);
  });
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return new Blob([buf], { type: XLSX_MIME });
}

/* ---------- docx（V59 微調3）：最小 OOXML 手寫產生器，零依賴 ----------
   docx＝zip 容器（store 不壓縮）裝三個必要部件：[Content_Types].xml／_rels/.rels／word/document.xml */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(u8) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
/* store 模式 zip：local header＋central directory＋EOCD（UTF-8 檔名旗標；日期填 1980-01-01 合法值） */
function zipStore(files, mime) {
  const enc = new TextEncoder();
  const chunks = [], central = [];
  let offset = 0;
  files.forEach(f => {
    const name = enc.encode(f.name), data = enc.encode(f.text);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);   // local file header 簽名
    local.setUint16(4, 20, true);           // version needed
    local.setUint16(6, 0x0800, true);       // UTF-8 檔名旗標
    local.setUint16(8, 0, true);            // method＝store
    local.setUint16(10, 0, true);           // mod time
    local.setUint16(12, 0x21, true);        // mod date＝1980-01-01
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    chunks.push(new Uint8Array(local.buffer), name, data);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);     // central directory 簽名
    cen.setUint16(4, 20, true);             // version made by
    cen.setUint16(6, 20, true);             // version needed
    cen.setUint16(8, 0x0800, true);         // UTF-8 檔名旗標
    cen.setUint16(10, 0, true);             // method＝store
    cen.setUint16(12, 0, true);             // mod time
    cen.setUint16(14, 0x21, true);          // mod date＝1980-01-01
    cen.setUint32(16, crc, true);
    cen.setUint32(20, data.length, true);
    cen.setUint32(24, data.length, true);
    cen.setUint16(28, name.length, true);
    cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), name);
    offset += 30 + name.length + data.length;
  });
  const centralSize = central.reduce((a, u) => a + u.length, 0);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, files.length, true);
  eocd.setUint16(10, files.length, true);
  eocd.setUint32(12, centralSize, true);
  eocd.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, new Uint8Array(eocd.buffer)], { type: mime });
}

/* ---------- XML 共用 ---------- */
function xmlEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/* ---------- 文件（雙語／譯文）各格式 ---------- */
function pairOf(doc) {
  return { src: doc.srcLang || 'ja', tgt: doc.tgtLang || 'zh-TW' };
}

/* JSON：既有格式原樣（動態鍵名＋confirmed/reviewed；工作區與專案區 V58 同款，V59 微調＝僅雙語群組保留） */
export function docRowsJSON(doc) {
  const p = pairOf(doc);
  return doc.segments.map(s => ({
    [p.src]: s.ja, [p.tgt]: s.zh,
    confirmed: !!s.confirmed, reviewed: !!s.reviewed, source: doc.name, srcLang: p.src, tgtLang: p.tgt
  }));
}

/* 雙語 xlsx：標號｜來源語系｜目標語系（同入稿模板，round-trip 可再匯入） */
export function docBilingualAoA(doc) {
  const p = pairOf(doc);
  return [['標號', p.src, p.tgt], ...doc.segments.map(s => [s.srcNo || '', s.ja, s.zh || ''])];
}

/* 譯文 xlsx：標號＋譯文兩欄（模板去掉原文欄） */
export function docTargetAoA(doc) {
  const p = pairOf(doc);
  return [['標號', p.tgt], ...doc.segments.map(s => [s.srcNo || '', s.zh || ''])];
}

/* 譯文 docx（V59 微調3）：檔名（粗體）→空行→逐句段「標號（粗體）＋譯文＋空行」；
   標號取「標號欄」原樣輸出（不另加前綴——原稿的 /1 這類斜線本就在欄位值裡）；
   句段無標號就略過標號列只出譯文。譯文內換行以 <w:br/> 保留 */
function wPara(text, bold) {
  if (text === '') return '<w:p/>';
  const boldPr = bold ? '<w:rPr><w:b/></w:rPr>' : '';
  const lines = String(text).split('\n')
    .map(l => `<w:t xml:space="preserve">${xmlEsc(l)}</w:t>`).join('<w:br/>');
  return `<w:p><w:r>${boldPr}${lines}</w:r></w:p>`;
}
export function docTargetDocxXml(doc) {
  const paras = [wPara(doc.name || 'document', true), '<w:p/>'];
  doc.segments.forEach(s => {
    if (s.srcNo) paras.push(wPara(String(s.srcNo), true));
    paras.push(wPara(s.zh || '', false));
    paras.push('<w:p/>');
  });
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:body>${paras.join('')}<w:sectPr/></w:body></w:document>`;
}
export function docxBlob(doc) {
  return zipStore([
    {
      name: '[Content_Types].xml',
      text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    },
    {
      name: '_rels/.rels',
      text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '</Relationships>'
    },
    { name: 'word/document.xml', text: docTargetDocxXml(doc) }
  ], DOCX_MIME);
}

/* TMX 1.4b：只用核心節點（tu/tuv/seg），segtype=sentence 誠實標註句級切分。
   units＝[{src, tgt}]，呼叫端先過濾（文件雙語＝略過空譯文；TM＝同） */
function tmxString(units, srcLang, tgtLang) {
  const body = units.map((u, i) =>
    `    <tu tuid="${i + 1}" srclang="${xmlEsc(srcLang)}">\n` +
    `      <tuv xml:lang="${xmlEsc(srcLang)}"><seg>${xmlEsc(u.src)}</seg></tuv>\n` +
    `      <tuv xml:lang="${xmlEsc(tgtLang)}"><seg>${xmlEsc(u.tgt)}</seg></tuv>\n` +
    `    </tu>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<tmx xmlns="http://www.lisa.org/tmx14" version="1.4">\n` +
    `  <header\n` +
    `    creationtool="CatTool-Pro"\n` +
    `    creationtoolversion="V59"\n` +
    `    datatype="plaintext"\n` +
    `    segtype="sentence"\n` +
    `    o-tmf="CatTool-Pro TM"\n` +
    `    adminlang="${xmlEsc(srcLang)}"\n` +
    `    srclang="${xmlEsc(srcLang)}"\n` +
    `    o-encoding="UTF-8">\n` +
    `  </header>\n` +
    `  <body>\n${body}\n  </body>\n</tmx>\n`;
}

export function docTmxString(doc) {
  const p = pairOf(doc);
  const units = doc.segments
    .filter(s => (s.zh || '').trim())
    .map(s => ({ src: s.ja, tgt: s.zh }));
  return tmxString(units, p.src, p.tgt);
}

/* XLIFF 1.2：核心元素 file/body/trans-unit/source/target；全句段輸出（空 target＝待譯） */
export function docXliff12String(doc) {
  const p = pairOf(doc);
  const body = doc.segments.map((s, i) =>
    `      <trans-unit id="${i + 1}">\n` +
    `        <source>${xmlEsc(s.ja)}</source>\n` +
    `        <target>${xmlEsc(s.zh || '')}</target>\n` +
    `      </trans-unit>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<xliff xmlns="urn:oasis:names:tc:xliff:document:1.2" version="1.2">\n` +
    `  <file original="${xmlEsc(doc.name)}" datatype="plaintext" xml:space="preserve"\n` +
    `        source-language="${xmlEsc(p.src)}" target-language="${xmlEsc(p.tgt)}">\n` +
    `    <header>\n      <tool tool-id="cattool-pro" tool-name="CatTool-Pro"/>\n    </header>\n` +
    `    <body>\n${body}\n    </body>\n  </file>\n</xliff>\n`;
}

/* XLIFF 2.0：語言屬性在根節點、unit > segment 分層（貼近本站句級切分架構） */
export function docXliff20String(doc) {
  const p = pairOf(doc);
  const body = doc.segments.map((s, i) =>
    `    <unit id="${i + 1}">\n` +
    `      <segment>\n` +
    `        <source>${xmlEsc(s.ja)}</source>\n` +
    `        <target>${xmlEsc(s.zh || '')}</target>\n` +
    `      </segment>\n` +
    `    </unit>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<xliff version="2.0" xmlns="urn:oasis:names:tc:xliff:document:2.0"\n` +
    `    srcLang="${xmlEsc(p.src)}" trgLang="${xmlEsc(p.tgt)}">\n` +
    `  <file id="f1" original="${xmlEsc(doc.name)}">\n${body}\n  </file>\n</xliff>\n`;
}

/* 單一文件依格式鍵組出檔案規格。fmt：bi-xlsx｜tgt-xlsx｜tgt-docx｜tmx｜xlf12｜xlf20｜json
   （xlsx/docx 後綴 V59 微調2 定案＝固定英文 _bilLang／_tgtLang） */
function docFileSpec(doc, fmt) {
  const name = doc.name || 'document';
  if (fmt === 'bi-xlsx') return { filename: `${name}_bilLang.xlsx`, makeBlob: () => xlsxBlob([{ name, rows: docBilingualAoA(doc) }]) };
  if (fmt === 'tgt-xlsx') return { filename: `${name}_tgtLang.xlsx`, makeBlob: () => xlsxBlob([{ name, rows: docTargetAoA(doc) }]) };
  if (fmt === 'tgt-docx') return { filename: `${name}_tgtLang.docx`, makeBlob: async () => docxBlob(doc) };
  if (fmt === 'tmx') return { filename: `${name}.tmx`, makeBlob: async () => xmlBlob(docTmxString(doc)) };
  if (fmt === 'xlf12') return { filename: `${name}_1.2.xlf`, makeBlob: async () => xmlBlob(docXliff12String(doc)) };
  if (fmt === 'xlf20') return { filename: `${name}_2.0.xlf`, makeBlob: async () => xmlBlob(docXliff20String(doc)) };
  return { filename: `${name}.json`, makeBlob: async () => jsonBlob(docRowsJSON(doc)) };
}

/* 批次：文件 × 勾選格式逐一產檔（V59 微調2：Modal 改勾選多格式＋匯出鈕一次執行；
   工作區單檔與專案區批次共用）。回傳實際存檔數（0＝取消） */
export async function exportDocs(docs, fmts) {
  const specs = [];
  fmts.forEach(fmt => docs.forEach(d => specs.push(docFileSpec(d, fmt))));
  return saveMany(specs);
}

/* ---------- 術語庫 ---------- */
/* xlsx：依語言對分工作表（嚴格語系隔離的表格化）；欄位＝原文/譯名/標籤/說明/來源 */
export function termSheets(termBase) {
  const byPair = new Map();
  termBase.forEach(t => {
    const sl = t.srcLang || 'ja', tl = t.tgtLang || 'zh-TW';
    const key = `${sl}→${tl}`;
    if (!byPair.has(key)) byPair.set(key, { sl, tl, rows: [] });
    byPair.get(key).rows.push(t);
  });
  return [...byPair.entries()].map(([key, g]) => ({
    name: key,
    rows: [
      [`原文（${langName(g.sl)}）`, `譯名（${langName(g.tl)}）`, '標籤', '說明', '來源'],
      ...g.rows.map(t => [t.ja, t.zh || '', t.tag || '', t.note || '', t.source || ''])
    ]
  }));
}
/* JSON 列（既有格式：動態鍵名＋note/tag/source） */
export function termRowsJSON(termBase) {
  return termBase.map(t => {
    const sl = t.srcLang || 'ja', tl = t.tgtLang || 'zh-TW';
    return { [sl]: t.ja, [tl]: t.zh, note: t.note, tag: t.tag || '', source: t.source || '', srcLang: sl, tgtLang: tl };
  });
}

/* 依勾選格式一次匯出（V59 微調2）。fmts ⊆ ['xlsx','json']；回傳實際存檔數（0＝取消） */
export async function exportTerms(termBase, fmts) {
  const specs = [];
  if (fmts.includes('xlsx')) specs.push({ filename: 'termbase.xlsx', makeBlob: () => xlsxBlob(termSheets(termBase)) });
  if (fmts.includes('json')) specs.push({ filename: 'termbase.json', makeBlob: async () => jsonBlob(termRowsJSON(termBase)) });
  return specs.length ? saveMany(specs) : 0;
}

/* ---------- TM ---------- */
/* xlsx：單一工作表固定五欄（V59 定案），語言對混列時以語系欄區分 */
export function tmAoA(tmSegments) {
  return [
    ['原文', '譯文', '來源', '來源語系', '目標語系'],
    ...tmSegments.map(t => [t.ja, t.zh || '', t.source || '', t.srcLang || 'ja', t.tgtLang || 'zh-TW'])
  ];
}
/* JSON 列（既有格式：動態鍵名＋source） */
export function tmRowsJSON(tmSegments) {
  return tmSegments.map(t => {
    const sl = t.srcLang || 'ja', tl = t.tgtLang || 'zh-TW';
    return { [sl]: t.ja, [tl]: t.zh, source: t.source || '', srcLang: sl, tgtLang: tl };
  });
}

/* TMX：依語言對分組、一組一個 .tmx（header srclang 是單值，分檔＝嚴格語系隔離的自然對應）；
   空譯文列不進 TMX。呼叫端先以 tmTmxFiles().length 判斷有無內容，再呼叫 exportTmTmx */
export function tmTmxFiles(tmSegments) {
  const byPair = new Map();
  tmSegments.forEach(t => {
    if (!(t.zh || '').trim()) return;
    const sl = t.srcLang || 'ja', tl = t.tgtLang || 'zh-TW';
    const key = `${sl}→${tl}`;
    if (!byPair.has(key)) byPair.set(key, { sl, tl, units: [] });
    byPair.get(key).units.push({ src: t.ja, tgt: t.zh });
  });
  return [...byPair.entries()].map(([key, g]) => ({
    filename: `tm_${key}.tmx`,
    text: tmxString(g.units, g.sl, g.tl)
  }));
}
/* 依勾選格式一次匯出（V59 微調2）。fmts ⊆ ['tmx','xlsx','json']；TMX 無內容時由呼叫端
   先以 tmTmxFiles().length 判斷並濾掉。回傳實際存檔數（0＝取消） */
export async function exportTm(tmSegments, fmts) {
  const specs = [];
  if (fmts.includes('tmx')) tmTmxFiles(tmSegments).forEach(f =>
    specs.push({ filename: f.filename, makeBlob: async () => xmlBlob(f.text) }));
  if (fmts.includes('xlsx')) specs.push({ filename: 'tm.xlsx', makeBlob: () => xlsxBlob([{ name: 'TM', rows: tmAoA(tmSegments) }]) });
  if (fmts.includes('json')) specs.push({ filename: 'tm.json', makeBlob: async () => jsonBlob(tmRowsJSON(tmSegments)) });
  return specs.length ? saveMany(specs) : 0;
}
