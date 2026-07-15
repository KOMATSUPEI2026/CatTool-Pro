/* 術語庫/翻譯記憶共用分頁（每頁 10 筆），DOM 結構與 vanilla paginationHtml 對齊 */
export const PAGE_SIZE = 10;

export function clampPage(page, totalItems){
  const pages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  return Math.min(Math.max(1, page), pages);
}

export default function Pagination({ total, page, onPage }) {
  const pages = Math.ceil(total / PAGE_SIZE);
  if (pages <= 1) return null;
  return (
    <div className="pagination">
      {Array.from({ length: pages }, (_, i) => i + 1).map(i =>
        <button key={i} className={'page-btn' + (i === page ? ' active' : '')}
                data-page={i} onClick={() => onPage(i)}>{i}</button>)}
    </div>
  );
}
