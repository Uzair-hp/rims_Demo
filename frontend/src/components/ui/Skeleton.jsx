import styles from './Skeleton.module.css'

/**
 * Loading placeholder. A shimmer rather than a spinner, because these stand in
 * for content that is already occupying the page (list rows, cards, stat tiles).
 *
 * @param {{ height?: string, width?: string, radius?: string, className?: string }} props
 */
export default function Skeleton({
  height = '1em',
  width = '100%',
  radius = 'var(--radius-sm)',
  className = '',
}) {
  return (
    <span
      className={`${styles.skeleton} ${className}`.trim()}
      style={{ blockSize: height, inlineSize: width, borderRadius: radius }}
      aria-hidden="true"
    />
  )
}
