import { useState } from 'react';

/* V59 匯出 Modal 家族（微調2 改「勾選格式＋匯出鈕」確認型）：
   - 格式鈕＝toggle 多選（未選 outline／已選 seal 實心），可跨群組複選
     （如「雙語 JSON＋譯文 xlsx」），按底部匯出鈕才一次執行、可指定儲存路徑
   - ExportModal＝工作區款殼（modal-card 置中＋右上 X，標題黑字；術語庫/翻譯記憶同款）；
     專案管理區用 PmModal 殼（teal 色帶），兩殼共用 ExportPicker 內容 */

export function ExportPicker({ groups, submitId, submitLabel, onSubmit }) {
  const [sel, setSel] = useState(new Set());
  const toggle = (key) => setSel(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  return (
    <>
      <div className="export-groups">
        {groups.map((g, gi) => (
          <div className={'export-group' + (g.row ? ' row' : '')} key={g.label || gi}>
            {g.label && <h4>{g.label}</h4>}
            {g.options.map(o => (
              <button key={o.id} id={o.id}
                      className={'btn small export-fmt-btn ' + (sel.has(o.key) ? 'seal selected' : 'outline')}
                      onClick={() => toggle(o.key)}>
                {o.label}
              </button>
            ))}
          </div>
        ))}
      </div>
      <button id={submitId} className="btn seal export-submit" disabled={sel.size === 0}
              onClick={() => onSubmit([...sel])}>
        {submitLabel}
      </button>
    </>
  );
}

/* 文件匯出的固定格式清單（工作區與專案區共用；id 前綴區分兩處入口）。
   JSON 只在雙語群組（既有格式本就是雙語，V59 微調拿掉譯文 JSON） */
export function docExportGroups(idPrefix) {
  return [
    {
      label: '雙語',
      options: [
        { id: `${idPrefix}-bi-xlsx`, key: 'bi-xlsx', label: 'xlsx' },
        { id: `${idPrefix}-tmx`, key: 'tmx', label: 'TMX' },
        { id: `${idPrefix}-xlf12`, key: 'xlf12', label: 'XLF 1.2' },
        { id: `${idPrefix}-xlf20`, key: 'xlf20', label: 'XLF 2.0' },
        { id: `${idPrefix}-bi-json`, key: 'json', label: 'JSON' }
      ]
    },
    {
      label: '譯文',
      options: [
        { id: `${idPrefix}-tgt-xlsx`, key: 'tgt-xlsx', label: 'xlsx' }
      ]
    }
  ];
}

export default function ExportModal({ title, groups, submitId, submitLabel, onSubmit, onClose }) {
  return (
    <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-card modal-card-center export-modal">
        <button className="modal-close-x" data-role="close" title="關閉" onClick={onClose}>
          <i className="bi bi-x-circle-fill"></i>
        </button>
        <h3>{title}</h3>
        <ExportPicker groups={groups} submitId={submitId} submitLabel={submitLabel} onSubmit={onSubmit} />
      </div>
    </div>
  );
}
