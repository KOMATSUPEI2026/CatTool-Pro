/* 純函式工具：自 vanilla 版原樣搬遷，不依賴 DOM 與全域狀態 */

export function cid(){ return Math.random().toString(36).slice(2,10); }

export function fmtDate(ts){
  if(!ts) return '—';
  const d = new Date(ts);
  const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const pad = n => String(n).padStart(2,'0');
  return `${months[d.getMonth()]}-${pad(d.getDate())}-${String(d.getFullYear()).slice(-2)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ja/zh 為內部儲存鍵名（歷史慣例），實際語言由 doc.srcLang/tgtLang 決定 */
export function docStats(doc){
  let jaChars=0, zhChars=0, draftCount=0, confirmedCount=0, reviewedCount=0;
  doc.segments.forEach(s=>{
    jaChars += s.ja.replace(/\s/g,'').length;
    zhChars += (s.zh||'').replace(/\s/g,'').length;
    if((s.zh||'').trim()) draftCount++;
    if(s.confirmed) confirmedCount++;
    if(s.reviewed) reviewedCount++;
  });
  const total = doc.segments.length;
  return {
    jaChars, zhChars,
    draftPct: total ? Math.round(draftCount/total*100) : 0,
    confirmedPct: total ? Math.round(confirmedCount/total*100) : 0,
    reviewedPct: total ? Math.round(reviewedCount/total*100) : 0
  };
}

export function segmentText(text){
  return text.split(/(?<=[。！？\n])/).map(s=>s.trim()).filter(Boolean);
}

export function uniqueDocName(name, docs){
  if(!docs.some(d=>d.name===name)) return name;
  let n = 2;
  while(docs.some(d=>d.name===`${name} (${n})`)) n++;
  return `${name} (${n})`;
}

export function docPair(doc){
  return { src: (doc && doc.srcLang) || 'ja', tgt: (doc && doc.tgtLang) || 'zh-TW' };
}

/* 嚴格語系隔離：TM/術語只在「配對完全相同」下比對顯示（核心設計決策 2） */
export function samePair(rec, doc){
  const p = docPair(doc);
  return ((rec.srcLang||'ja') === p.src) && ((rec.tgtLang||'zh-TW') === p.tgt);
}

/* CJK 語系串接不加空格，其餘以半形空格串接（合併原文/譯文時依各自語系決定） */
export function langJoiner(code){ return /^(ja|zh|ko|th)/.test(code||'') ? '' : ' '; }

/* ---- 字元 bigram Jaccard 相似度（簡易 TM 比對率） ---- */
function bigrams(str){
  const s = str.replace(/\s/g,'');
  const set = new Set();
  for(let i=0;i<s.length-1;i++) set.add(s.slice(i,i+2));
  if(set.size===0 && s.length>0) set.add(s);
  return set;
}
export function similarity(a,b){
  const A = bigrams(a), B = bigrams(b);
  if(A.size===0 || B.size===0) return 0;
  let inter=0;
  for(const g of A) if(B.has(g)) inter++;
  const union = A.size + B.size - inter;
  return union===0 ? 0 : inter/union;
}

/* ---- 術語比對：在原文中找出所有命中的詞條（最長優先、不重疊） ---- */
export function findTermHits(text, termBase, doc){
  const hits = [];
  const sorted = termBase.filter(t=>samePair(t, doc)).sort((a,b)=>b.ja.length-a.ja.length);
  const used = new Array(text.length).fill(false);
  for(const term of sorted){
    if(!term.ja) continue;
    let idx = 0;
    while(true){
      const found = text.indexOf(term.ja, idx);
      if(found===-1) break;
      const end = found + term.ja.length;
      let overlap=false;
      for(let i=found;i<end;i++) if(used[i]){overlap=true;break;}
      if(!overlap){
        hits.push({start:found, end, term});
        for(let i=found;i<end;i++) used[i]=true;
      }
      idx = found + term.ja.length;
    }
  }
  hits.sort((a,b)=>a.start-b.start);
  return hits;
}

export function downloadJSON(data, filename){
  const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export function importJSON(file, cb, onError){
  if(!file) return;
  const reader = new FileReader();
  reader.onload = ()=>{
    try{ cb(JSON.parse(reader.result)); }
    catch(err){ onError && onError(err.message); }
  };
  reader.readAsText(file);
}

export const LANG_NAMES = {
  'zh-TW':'繁體中文','zh-HK':'繁體中文','zh-CN':'簡體中文','zh-SG':'簡體中文',
  'en':'英文','en-US':'英文','en-GB':'英文',
  'ja':'日文','ko':'韓文','fr':'法文','de':'德文','es':'西班牙文','vi':'越南文','th':'泰文'
};
export function langName(code){ return LANG_NAMES[code] || code || '—'; }
