/* V60 匯入格式解析器：TMX 1.4b／XLIFF 1.2/2.0／xlsx／JSON（既有格式），與 exporters.js 對稱。
   定案規格（2026-07-20 與使用者確認）：
   - 去重＝「同語言對＋同原文＋同譯文」視為完全重複跳過；同原文譯文不同＝另一筆譯法並存
   - 語系代碼一律 normalizeLang 正規化（大小寫不敏感，zh-tw→zh-TW）；14 語系表以外
     的代碼＝該筆跳過並於摘要回報（嚴格語系隔離下孤兒資料在工作區永遠比對不到）
   - TM／術語匯入走「解析→確認 Modal→寫入」；文件 XLIFF 走入稿區既有暫存預覽流程，
     語系以檔內宣告為準（不受語系閘門限制）
   - XLIFF 的 trans-unit/unit id 不收進 srcNo（自家匯出是流水號、他家是資料庫主鍵，皆無標號語意）
   - 匯入譯文一律未確認（核心設計決策 4）由呼叫端建檔時落實，本模組只回純資料列
   ja/zh 為內部儲存鍵名（歷史慣例），實際語言由 srcLang/tgtLang 決定 */
import { LANG_NAMES } from './utils.js';

/* ---------- 語系正規化 ---------- */
const LANG_BY_LOWER = new Map(Object.keys(LANG_NAMES).map(c => [c.toLowerCase(), c]));
/* 大小寫不敏感對回 14 語系標準碼；對不上回 null（呼叫端跳過該筆並計數） */
export function normalizeLang(code) {
  return LANG_BY_LOWER.get(String(code || '').trim().toLowerCase()) || null;
}

/* ---------- 去重 ----------
   existing 舊資料可能缺 srcLang/tgtLang（預設 ja/zh-TW，與匯出端 fallback 一致）；
   鍵用 JSON.stringify 避免文字含分隔符碰撞；incoming 檔內自身重複也一併去除 */
function rowKey(r) {
  return JSON.stringify([r.srcLang || 'ja', r.tgtLang || 'zh-TW', r.ja, r.zh || '']);
}
export function dedupeRows(incoming, existing) {
  const seen = new Set(existing.map(rowKey));
  const fresh = [];
  let dupCount = 0;
  incoming.forEach(r => {
    const key = rowKey(r);
    if (seen.has(key)) { dupCount++; return; }
    seen.add(key);
    fresh.push(r);
  });
  return { fresh, dupCount };
}
/* 確認 Modal 的語言對摘要：[{ pair:'ja→zh-TW', count }] */
export function pairSummary(rows) {
  const byPair = new Map();
  rows.forEach(r => {
    const key = `${r.srcLang}→${r.tgtLang}`;
    byPair.set(key, (byPair.get(key) || 0) + 1);
  });
  return [...byPair.entries()].map(([pair, count]) => ({ pair, count }));
}

/* ---------- XML 共用 ---------- */
function parseXmlDoc(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('XML 格式不正確');
  return doc;
}
/* 檔案多帶 default namespace，一律以 NS 萬用字元取節點 */
const byTag = (node, tag) => [...node.getElementsByTagNameNS('*', tag)];

/* ---------- TMX 1.4b → TM 列 ----------
   來源語＝tu@srclang（缺則退 header@srclang）；來源語的 tuv＝原文，
   其餘每個 tuv 各成一筆（來源→該語言，多語 TMX 天然攤平成多語言對）。
   原文空白跳過；目標語或來源語不在 14 語系表＝該筆跳過計數 */
export function parseTmxString(text) {
  const doc = parseXmlDoc(text);
  if (!byTag(doc, 'tmx').length) throw new Error('不是 TMX 檔（缺 tmx 根節點）');
  const header = byTag(doc, 'header')[0];
  const headerSrc = header ? header.getAttribute('srclang') : '';
  const rows = [];
  let skippedLang = 0;
  byTag(doc, 'tu').forEach(tu => {
    const sl = normalizeLang(tu.getAttribute('srclang') || headerSrc);
    const tuvs = byTag(tu, 'tuv').map(tuv => ({
      lang: normalizeLang(tuv.getAttribute('xml:lang') || tuv.getAttribute('lang')),
      text: (byTag(tuv, 'seg')[0]?.textContent || '').trim()
    }));
    if (!sl) { skippedLang += Math.max(tuvs.length - 1, 1); return; }
    const srcTuv = tuvs.find(v => v.lang === sl);
    if (!srcTuv || !srcTuv.text) return;   // 缺原文＝無效列（非語系問題，不計 skippedLang）
    tuvs.forEach(v => {
      if (v === srcTuv) return;
      if (!v.lang) { skippedLang++; return; }
      rows.push({ ja: srcTuv.text, zh: v.text, source: '', srcLang: sl, tgtLang: v.lang });
    });
  });
  return { rows, skippedLang };
}

/* ---------- XLIFF 1.2/2.0 → 入稿暫存 ----------
   自動判版：root@version。1.2 語系在 file 層、2.0 在根節點。
   多 file＝比照入稿 xlsx 多分頁（一 file 一文件）；1.2 各 file 語系與首個 file
   不同時整個 file 跳過（skipped 列名回報）。source 空白列跳過；target 空＝待譯照收。
   回傳 { src, tgt, sheets:[{name, rows:[{ja, zh, srcNo:null}]}], skipped:[] }；
   語系不在 14 語系表 → throw（整檔擋下，由入稿區報錯） */
export function parseXliffString(text, fallbackName) {
  const doc = parseXmlDoc(text);
  const root = byTag(doc, 'xliff')[0];
  if (!root) throw new Error('不是 XLIFF 檔（缺 xliff 根節點）');
  const version = root.getAttribute('version') || '';
  const files = byTag(root, 'file');
  if (!files.length) throw new Error('XLIFF 檔內沒有 file 節點');
  const sheets = [];
  const skipped = [];
  let src, tgt;
  const langError = (rawS, rawT) =>
    new Error(`不支援的語系代碼（${rawS || '未標示'} → ${rawT || '未標示'}）`);

  if (version.startsWith('2')) {
    const rawS = root.getAttribute('srcLang'), rawT = root.getAttribute('trgLang');
    src = normalizeLang(rawS); tgt = normalizeLang(rawT);
    if (!src || !tgt) throw langError(rawS, rawT);
    files.forEach((f, i) => {
      const name = f.getAttribute('original') || f.getAttribute('id') || fallbackName || `XLIFF-${i + 1}`;
      const rows = [];
      byTag(f, 'segment').forEach(seg => {
        const ja = (byTag(seg, 'source')[0]?.textContent || '').trim();
        const zh = (byTag(seg, 'target')[0]?.textContent || '').trim();
        if (ja) rows.push({ ja, zh, srcNo: null });
      });
      if (rows.length) sheets.push({ name, rows });
      else skipped.push(name);
    });
  } else {
    files.forEach((f, i) => {
      const name = f.getAttribute('original') || fallbackName || `XLIFF-${i + 1}`;
      const rawS = f.getAttribute('source-language'), rawT = f.getAttribute('target-language');
      const fs = normalizeLang(rawS), ft = normalizeLang(rawT);
      if (src === undefined) {
        if (!fs || !ft) throw langError(rawS, rawT);
        src = fs; tgt = ft;
      } else if (fs !== src || ft !== tgt) {
        skipped.push(`${name}（語系配對不同）`);
        return;
      }
      const rows = [];
      byTag(f, 'trans-unit').forEach(tu => {
        const ja = (byTag(tu, 'source')[0]?.textContent || '').trim();
        const zh = (byTag(tu, 'target')[0]?.textContent || '').trim();
        if (ja) rows.push({ ja, zh, srcNo: null });
      });
      if (rows.length) sheets.push({ name, rows });
      else skipped.push(name);
    });
  }
  if (!sheets.length) throw new Error('XLIFF 檔內讀不到可匯入的句段');
  return { src, tgt, sheets, skipped };
}

/* ---------- docx → 原文段落（V60 微調：入稿區 .docx 原文入稿） ----------
   docx＝zip 容器；零依賴讀取：掃 EOCD→central directory 找 word/document.xml，
   store（method 0）直切、deflate（method 8，Word 實際輸出）走瀏覽器內建
   DecompressionStream('deflate-raw')。壓縮尺寸取 central directory 的值
  （local header 在 data descriptor 模式下可能為 0，不可信） */
async function unzipEntry(buf, entryName) {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 docx（zip）檔');
  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  const td = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(off, true) !== 0x02014b50) break;
    const method = dv.getUint16(off + 10, true);
    const csize = dv.getUint32(off + 20, true);
    const nameLen = dv.getUint16(off + 28, true);
    const extraLen = dv.getUint16(off + 30, true);
    const cmtLen = dv.getUint16(off + 32, true);
    const lho = dv.getUint32(off + 42, true);
    const name = td.decode(u8.subarray(off + 46, off + 46 + nameLen));
    off += 46 + nameLen + extraLen + cmtLen;
    if (name !== entryName) continue;
    const dataStart = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
    const data = u8.subarray(dataStart, dataStart + csize);
    if (method === 0) return data;
    if (method === 8) {
      const ds = new DecompressionStream('deflate-raw');
      return new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(ds)).arrayBuffer());
    }
    throw new Error('不支援的 zip 壓縮方式');
  }
  throw new Error('docx 內找不到 word/document.xml');
}
/* 段落抽取：每個 w:p 串接其下全部 w:t 文字（w:br 視為段內換行），去空段落 */
export async function parseDocxFile(file) {
  const xmlBytes = await unzipEntry(await file.arrayBuffer(), 'word/document.xml');
  const doc = parseXmlDoc(new TextDecoder().decode(xmlBytes));
  return byTag(doc, 'p').map(p =>
    [...p.getElementsByTagNameNS('*', '*')]
      .filter(el => el.localName === 't' || el.localName === 'br')
      .map(el => el.localName === 'br' ? '\n' : el.textContent).join('')
  ).map(s => s.trim()).filter(Boolean);
}

/* ---------- 術語庫 xlsx → 術語列 ----------
   與 termSheets 匯出對稱：分頁名＝語言對（ja→zh-TW），欄序＝原文/譯名/標籤/說明/來源
  （首列表頭跳過、依欄位位置取值）；分頁名不合語言對格式或語系不支援＝整頁跳過計數 */
export function parseTermsWorkbook(wb, XLSX) {
  const rows = [];
  const skippedSheets = [];
  wb.SheetNames.forEach(sn => {
    const m = String(sn).split('→');
    const sl = m.length === 2 ? normalizeLang(m[0]) : null;
    const tl = m.length === 2 ? normalizeLang(m[1]) : null;
    if (!sl || !tl) { skippedSheets.push(sn); return; }
    const grid = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: null });
    for (let r = 1; r < grid.length; r++) {
      const cell = (i) => grid[r][i] === null || grid[r][i] === undefined ? '' : String(grid[r][i]).trim();
      const ja = cell(0);
      if (!ja) continue;
      rows.push({ ja, zh: cell(1), tag: cell(2), note: cell(3), source: cell(4), srcLang: sl, tgtLang: tl });
    }
  });
  return { rows, skippedSheets };
}

/* ---------- TM xlsx → TM 列 ----------
   與 tmAoA 匯出對稱：表頭找「原文／譯文／來源／來源語系／目標語系」欄
  （來源可缺，其餘四欄必備）；語系欄逐列正規化，不支援＝該筆跳過計數 */
export function parseTmWorkbook(wb, XLSX) {
  const rows = [];
  let skippedLang = 0;
  let headerOk = false;
  wb.SheetNames.forEach(sn => {
    const grid = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: null });
    if (grid.length < 1) return;
    const header = grid[0].map(h => h === null ? '' : String(h).trim());
    const jaCol = header.indexOf('原文'), zhCol = header.indexOf('譯文');
    const slCol = header.indexOf('來源語系'), tlCol = header.indexOf('目標語系');
    const srcCol = header.indexOf('來源');
    if (jaCol === -1 || zhCol === -1 || slCol === -1 || tlCol === -1) return;
    headerOk = true;
    for (let r = 1; r < grid.length; r++) {
      const cell = (i) => i === -1 || grid[r][i] === null || grid[r][i] === undefined ? '' : String(grid[r][i]).trim();
      const ja = cell(jaCol);
      if (!ja) continue;
      const sl = normalizeLang(cell(slCol)), tl = normalizeLang(cell(tlCol));
      if (!sl || !tl) { skippedLang++; continue; }
      rows.push({ ja, zh: cell(zhCol), source: cell(srcCol), srcLang: sl, tgtLang: tl });
    }
  });
  if (!headerOk) throw new Error('表頭欄位不符（需含「原文／譯文／來源語系／目標語系」欄）');
  return { rows, skippedLang };
}

/* ---------- JSON → 列（沿用既有相容邏輯：動態鍵、退回舊 ja/zh 鍵） ----------
   V60 起 JSON 也走正規化＋去重＋確認 Modal 同一條管線；
   srcLang/tgtLang 缺＝沿用歷史預設 ja/zh-TW，有值但不支援＝該筆跳過計數 */
export function parseJsonRows(data, kind) {
  if (!Array.isArray(data)) throw new Error('檔案格式不正確（需為陣列）');
  const rows = [];
  let skippedLang = 0;
  data.forEach(d => {
    if (!d || typeof d !== 'object') return;
    const sl = d.srcLang === undefined || d.srcLang === null || d.srcLang === '' ? 'ja' : normalizeLang(d.srcLang);
    const tl = d.tgtLang === undefined || d.tgtLang === null || d.tgtLang === '' ? 'zh-TW' : normalizeLang(d.tgtLang);
    if (!sl || !tl) { skippedLang++; return; }
    const src = d[sl] !== undefined ? d[sl] : d.ja;
    const tgt = d[tl] !== undefined ? d[tl] : d.zh;
    if (!src) return;
    const base = { ja: String(src), zh: tgt ? String(tgt) : '', source: d.source || '', srcLang: sl, tgtLang: tl };
    rows.push(kind === 'terms' ? { ...base, note: d.note || '', tag: d.tag || '' } : base);
  });
  return { rows, skippedLang };
}

/* ---------- 高階入口：File → 解析結果（依副檔名分流） ----------
   回傳 { rows, skippedLang, skippedSheets }；格式錯誤 throw（呼叫端 Toast） */
async function readWorkbook(file) {
  const [XLSX, buf] = await Promise.all([import('xlsx'), file.arrayBuffer()]);
  return { XLSX, wb: XLSX.read(buf) };
}
export async function parseTermsFile(file) {
  if (/\.xlsx$/i.test(file.name)) {
    const { XLSX, wb } = await readWorkbook(file);
    const { rows, skippedSheets } = parseTermsWorkbook(wb, XLSX);
    return { rows, skippedLang: 0, skippedSheets };
  }
  if (/\.json$/i.test(file.name)) {
    const { rows, skippedLang } = parseJsonRows(JSON.parse(await file.text()), 'terms');
    return { rows, skippedLang, skippedSheets: [] };
  }
  throw new Error('不支援的檔案格式（請選 .xlsx 或 .json）');
}
export async function parseTmFile(file) {
  if (/\.tmx$/i.test(file.name)) {
    const { rows, skippedLang } = parseTmxString(await file.text());
    return { rows, skippedLang, skippedSheets: [] };
  }
  if (/\.xlsx$/i.test(file.name)) {
    const { XLSX, wb } = await readWorkbook(file);
    const { rows, skippedLang } = parseTmWorkbook(wb, XLSX);
    return { rows, skippedLang, skippedSheets: [] };
  }
  if (/\.json$/i.test(file.name)) {
    const { rows, skippedLang } = parseJsonRows(JSON.parse(await file.text()), 'tm');
    return { rows, skippedLang, skippedSheets: [] };
  }
  throw new Error('不支援的檔案格式（請選 .tmx、.xlsx 或 .json）');
}
