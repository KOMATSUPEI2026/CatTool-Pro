import { useEffect, useState } from 'react';
import { useStore } from '../store.js';
import { cid } from '../utils.js';
import { autoSaveAfterSegTool } from '../cloud.js';

const SIDE_SCALES = [1, 1.2, 1.4];

/* 留言卡片時間戳：2026/7/18 20:39（月日不補零、時分補零） */
const fmtCmtTime = (ts) => {
  const d = new Date(ts);
  if (isNaN(d)) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/* 反白選取 → 相對整句原文的字元位移。選取需完整落在單一 .src-text 內；
   端點位移用「selectNodeContents＋setEnd 再量 toString 長度」換算（term-hit 巢狀 span 也算得準，
   .src-text 的 textContent 恆等於 seg.ja）。回傳 { segId, start, end, text }，無效回 null */
function srcSelectionOffsets(){
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  const el = (n) => n && (n.nodeType === 3 ? n.parentElement : n);
  const srcEl = el(range.startContainer)?.closest('.src-text');
  if (!srcEl || el(range.endContainer)?.closest('.src-text') !== srcEl) return null;
  const segId = srcEl.dataset.seg;
  const text = range.toString();
  if (!segId || !text.trim()) return null;
  const pre = document.createRange();
  pre.selectNodeContents(srcEl);
  pre.setEnd(range.startContainer, range.startOffset);
  const start = pre.toString().length;
  return { segId, start, end: start + text.length, text };
}

/* 留言側欄（左側第三把手，V55）：留言／已解決雙 Tab、只列目前檔案的留言。
   新增流程＝反白卡片原文 → 底部「留言」鈕 → 頂部編輯卡 Enter 送出；
   已解決 icon 移入已解決 Tab（原文點線消失）、復原退回、刪除＝此則處理完畢。
   留言 CRUD 後比照句段整理五功能：autoSaveAfterSegTool 全量即存（訪客靜默交保底機制） */
export default function CommentSidebar() {
  const currentTab = useStore(s => s.currentTab);
  const documents = useStore(s => s.documents);
  const currentDocId = useStore(s => s.currentDocId);
  const comments = useStore(s => s.comments);
  const cmtOpenSeq = useStore(s => s.cmtOpenSeq);
  const addComment = useStore(s => s.addComment);
  const updateCommentBody = useStore(s => s.updateCommentBody);
  const setCommentResolved = useStore(s => s.setCommentResolved);
  const deleteComment = useStore(s => s.deleteComment);
  const showToast = useStore(s => s.showToast);

  const [pinned, setPinned] = useState(false);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('open');       // 'open'＝留言 Tab | 'resolved'＝已解決 Tab
  const [scaleIdx, setScaleIdx] = useState(0);
  const [capture, setCapture] = useState(null);   // 最後一次有效反白 { segId, start, end, text }
  const [draft, setDraft] = useState(null);       // 新留言編輯卡 { segId, start, end, quote }
  const [draftBody, setDraftBody] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editBody, setEditBody] = useState('');

  const inWork = currentTab === 'work';
  const isOpen = inWork && open;
  if (!inWork && (open || pinned)) { setOpen(false); setPinned(false); }

  const doc = documents.find(d => d.id === currentDocId) || null;
  const scale = SIDE_SCALES[scaleIdx];

  /* 卡片留言 icon 點擊 → 側欄展開並固定（store 的 cmtOpenSeq 橋） */
  useEffect(() => {
    if (cmtOpenSeq) { setPinned(true); setOpen(true); setMode('open'); }
  }, [cmtOpenSeq]);

  /* 反白捕捉：document 層 mouseup（同工作區反白新增術語的模式）。
     無效選取不清空上次捕捉——「劃選→再點側欄按鈕」中間的點擊不會弄丟選取 */
  useEffect(() => {
    const onMouseUp = () => {
      setTimeout(() => {
        const got = srcSelectionOffsets();
        if (got) setCapture(got);
      }, 0);
    };
    document.addEventListener('mouseup', onMouseUp);
    return () => document.removeEventListener('mouseup', onMouseUp);
  }, []);

  /* 切檔：捕捉與編輯狀態全部歸零（留言清單只跟目前檔案） */
  useEffect(() => {
    setCapture(null); setDraft(null); setDraftBody('');
    setEditingId(null); setEditBody('');
  }, [currentDocId]);

  const docComments = doc ? comments.filter(c => c.docId === doc.id) : [];
  const list = docComments.filter(c => mode === 'open' ? !c.resolved : c.resolved);
  const shown = [...list].reverse();   // 新留言排最上面（陣列序＝建立序）

  /* 底部「留言」鈕：驗證捕捉仍對得上目前原文（原文若已被改動＝過時選取，擋下） */
  const onNewComment = () => {
    if (!doc) { showToast('請先開啟一個檔案'); return; }
    const seg = capture && doc.segments.find(x => x.id === capture.segId);
    if (!seg || seg.ja.slice(capture.start, capture.end) !== capture.text) {
      showToast('請先用滑鼠在卡片原文中選取要留言的文字');
      return;
    }
    setMode('open');
    setDraft({ segId: capture.segId, start: capture.start, end: capture.end, quote: capture.text });
    setDraftBody('');
  };

  const submitDraft = () => {
    if (!draftBody.trim()) { showToast('留言內容不能空白'); return; }
    addComment({
      id: cid(), docId: doc.id, segId: draft.segId,
      start: draft.start, end: draft.end, quote: draft.quote,
      body: draftBody.trim(), resolved: false,
      createdAt: Date.now(), updatedAt: Date.now()
    });
    setDraft(null); setDraftBody(''); setCapture(null);
    autoSaveAfterSegTool();
  };

  const submitEdit = (id) => {
    if (!editBody.trim()) { showToast('留言內容不能空白'); return; }
    updateCommentBody(id, editBody.trim());
    setEditingId(null); setEditBody('');
    autoSaveAfterSegTool();
  };

  const onResolve = (id, on) => { setCommentResolved(id, on); autoSaveAfterSegTool(); };
  const onDelete = (id) => {
    deleteComment(id);
    if (editingId === id) { setEditingId(null); setEditBody(''); }
    autoSaveAfterSegTool();
  };

  /* Enter 送出（Shift+Enter 換行）；IME 組字守門同分割句子（isComposing / keyCode 229） */
  const enterSubmit = (fn) => (e) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
    e.preventDefault();
    fn();
  };

  /* 點引用文字捲到對應句段卡片 */
  const scrollToSeg = (segId) => {
    const srcEl = document.querySelector(`#seg-list .src-text[data-seg="${segId}"]`);
    srcEl?.closest('.seg')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const handleCls = () =>
    'cmt-handle' + (inWork ? ' visible' : '') + (isOpen ? ' shifted' : '') + (pinned ? ' active' : '');

  let body;
  if (!doc) {
    body = <div className="cmt-empty">尚未開啟任何檔案。</div>;
  } else if (shown.length === 0 && !draft) {
    body = mode === 'open'
      ? <div className="cmt-empty">這個檔案還沒有留言。<br />用滑鼠選取卡片原文的一段文字，<br />再點下方「留言」按鈕。</div>
      : <div className="cmt-empty">還沒有已解決的留言。</div>;
  } else {
    body = shown.map(c => (
      <div className="cmt-card" key={c.id}>
        {mode === 'open' &&
          <button className="cmt-resolve-btn" title="標記為已解決"
                  onClick={() => onResolve(c.id, true)}>
            <i className="bi bi-check2-circle"></i>
          </button>}
        <div className="cmt-quote" title="捲動到這一句" onClick={() => scrollToSeg(c.segId)}>@{c.quote}</div>
        {editingId === c.id
          ? <textarea className="cmt-textarea" autoFocus value={editBody}
                      onChange={e => setEditBody(e.target.value)}
                      onKeyDown={enterSubmit(() => submitEdit(c.id))} />
          : <div className="cmt-body">{c.body}</div>}
        <div className="cmt-foot">
          <span className="cmt-time">{fmtCmtTime(c.createdAt)}</span>
          <span className="cmt-actions">
            {mode === 'open' && (editingId === c.id
              ? <>
                  <button onClick={() => submitEdit(c.id)}>儲存</button>
                  <button onClick={() => { setEditingId(null); setEditBody(''); }}>取消</button>
                </>
              : <>
                  <button onClick={() => { setEditingId(c.id); setEditBody(c.body); }}>編輯</button>
                  <button onClick={() => onDelete(c.id)}>刪除</button>
                </>)}
            {mode === 'resolved' &&
              <>
                <button onClick={() => onResolve(c.id, false)}>復原</button>
                <button onClick={() => onDelete(c.id)}>刪除</button>
              </>}
          </span>
        </div>
      </div>
    ));
  }

  return (
    <>
      <button className={handleCls()} id="cmt-handle"
              onMouseEnter={() => { if (!pinned) setOpen(true); }}
              onClick={() => { const p = !pinned; setPinned(p); setOpen(p); }}>留言側欄</button>
      <aside className={'cmt-sidebar' + (inWork ? ' visible' : '') + (isOpen ? ' open' : '')} id="cmt-sidebar"
             style={{ '--side-scale': scale }}
             onMouseLeave={() => { if (!pinned) setOpen(false); }}>
        <div className="cmt-sidebar-header">
          <span>留言</span>
          <button className="side-scale-btn" id="cmt-scale-btn"
                  onClick={e => { e.stopPropagation(); setScaleIdx((scaleIdx + 1) % SIDE_SCALES.length); }}>
            <i className="bi bi-zoom-in"></i> {scale}x
          </button>
        </div>
        <div className="cmt-tabs">
          <button id="cmt-tab-open" className={mode === 'open' ? 'active' : ''} onClick={() => setMode('open')}>留言</button>
          <button id="cmt-tab-resolved" className={mode === 'resolved' ? 'active' : ''} onClick={() => setMode('resolved')}>已解決</button>
        </div>
        <div className="cmt-sidebar-body" id="cmt-sidebar-body">
          {mode === 'open' && draft &&
            <div className="cmt-editor">
              <div className="cmt-quote">@{draft.quote}</div>
              <textarea className="cmt-textarea" id="cmt-draft-input" autoFocus
                        placeholder="輸入留言內容…" value={draftBody}
                        onChange={e => setDraftBody(e.target.value)}
                        onKeyDown={enterSubmit(submitDraft)} />
              <div className="cmt-editor-foot">
                <span className="cmt-enter-hint">按 Enter 送出</span>
                <button className="cmt-cancel-btn" onClick={() => { setDraft(null); setDraftBody(''); }}>取消</button>
              </div>
            </div>}
          {body}
        </div>
        <div className="cmt-sidebar-foot">
          <button className="cmt-new-btn" id="cmt-new-btn" onClick={onNewComment}>留言</button>
        </div>
      </aside>
    </>
  );
}
