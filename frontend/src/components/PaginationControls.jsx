const PaginationControls = ({ page, pages, onPageChange }) => {
  if (pages <= 1) return null;

  const visiblePages = new Set([1, pages]);
  for (let number = Math.max(1, page - 2); number <= Math.min(pages, page + 2); number += 1) {
    visiblePages.add(number);
  }
  const pageNumbers = [...visiblePages].sort((left, right) => left - right);

  return (
    <nav className="store-pagination" aria-label="Product pages">
      <button type="button" onClick={() => onPageChange(page - 1)} disabled={page <= 1}>
        Previous
      </button>
      {pageNumbers.map((number, index) => (
        <span className="store-pagination-item" key={number}>
          {index > 0 && number - pageNumbers[index - 1] > 1 && <span aria-hidden="true">…</span>}
          <button
            type="button"
            className={number === page ? 'active' : ''}
            aria-current={number === page ? 'page' : undefined}
            onClick={() => onPageChange(number)}
          >
            {number}
          </button>
        </span>
      ))}
      <button type="button" onClick={() => onPageChange(page + 1)} disabled={page >= pages}>
        Next
      </button>
    </nav>
  );
};

export default PaginationControls;
