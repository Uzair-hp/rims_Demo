import styles from './Card.module.css'

/**
 * Content surface. One border, one radius, one shadow step — the only card
 * treatment in the system (§18.3).
 *
 * @param {{
 *   as?: any,
 *   padding?: 'none' | 'sm' | 'md' | 'lg',
 *   interactive?: boolean,
 *   className?: string,
 *   children?: import('react').ReactNode,
 *   [key: string]: any
 * }} props
 */
export default function Card({
  as: Element = 'div',
  padding = 'md',
  interactive = false,
  className = '',
  children,
  ...rest
}) {
  const classes = [styles.card, styles[padding], interactive ? styles.interactive : '', className]
    .filter(Boolean)
    .join(' ')

  return (
    <Element className={classes} {...rest}>
      {children}
    </Element>
  )
}
