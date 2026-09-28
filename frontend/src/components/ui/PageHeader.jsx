import styles from './PageHeader.module.css'

/**
 * Page-level heading block. Rendered on every route so the `<h1>` is never
 * missing (§18.2). On small screens the mobile top bar carries the short title,
 * so this one stays compact.
 *
 * @param {{ title: string, description?: string, actions?: import('react').ReactNode, eyebrow?: string }} props
 */
export default function PageHeader({ title, description, actions, eyebrow }) {
  return (
    <div className={styles.header}>
      <div className={styles.text}>
        {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
        <h1 className={styles.title}>{title}</h1>
        {description ? <p className={styles.description}>{description}</p> : null}
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </div>
  )
}
