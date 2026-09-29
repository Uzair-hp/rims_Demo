import Button from './Button.jsx'
import styles from './Pagination.module.css'

/**
 * Simple prev/numeric/next pager. `onChange` receives the 1-based page number.
 *
 * @param {{ page: number, pageSize: number, total: number, onChange: (page: number) => void }} props
 */
export default function Pagination({ page, pageSize, total, onChange }) {
  const totalPages = Math.max(1, Math.ceil((total || 0) / (pageSize || 1)))
  const current = Math.min(Math.max(1, page), totalPages)

  const start = Math.max(1, current - 2)
  const end = Math.min(totalPages, current + 2)
  const pages = []
  for (let p = start; p <= end; p++) pages.push(p)

  return (
    <nav className={styles.pagination} aria-label="Pages">
      <Button
        size="sm"
        variant="ghost"
        icon="chevronLeft"
        aria-label="Previous page"
        disabled={current <= 1}
        onClick={() => onChange(current - 1)}
      />
      {pages.map((p) => (
        <Button key={p} size="sm" variant={p === current ? 'primary' : 'ghost'} onClick={() => onChange(p)}>
          {p}
        </Button>
      ))}
      <Button
        size="sm"
        variant="ghost"
        icon="chevronRight"
        aria-label="Next page"
        disabled={current >= totalPages}
        onClick={() => onChange(current + 1)}
      />
    </nav>
  )
}
