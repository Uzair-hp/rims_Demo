import Button from '../../components/ui/Button.jsx'
import Icon from '../../components/ui/Icon.jsx'
import styles from './settings.module.css'

/**
 * One §15 settings section (§18.3 surface treatment).
 *
 * Renders a heading, optional description, and either a save-enabled `<form>`
 * (when a `useSectionForm` result is passed) or free content for sections whose
 * actions are immediate (logo upload, terms rows). The footer carries the
 * section's own status: an inline error (`role="alert"`) or a saved note
 * (`role="status"`), beside that section's Save button — never a global one.
 *
 * Each section is an `<h2>` under the page's single `<h1>` (§18.2), so the
 * Settings page keeps exactly one level-one heading on every viewport.
 *
 * @param {{
 *   title: string,
 *   description?: string,
 *   headingId?: string,
 *   form?: { submitting: boolean, saved: boolean, error: string | null, handleSubmit: (event: any) => void },
 *   saveLabel?: string | null,
 *   children: import('react').ReactNode,
 * }} props
 */
export default function Section({ title, description, headingId, form, saveLabel = 'Save', children }) {
  const heading = (
    <div className={styles.sectionHead}>
      <h2 className={styles.sectionTitle} id={headingId}>
        {title}
      </h2>
      {description ? <p className={styles.sectionDescription}>{description}</p> : null}
    </div>
  )

  if (!form) {
    return (
      <section className={styles.section} aria-labelledby={headingId}>
        {heading}
        <div className={styles.sectionBody}>{children}</div>
      </section>
    )
  }

  return (
    <section className={styles.section} aria-labelledby={headingId}>
      {heading}
      <form className={styles.sectionBody} onSubmit={form.handleSubmit} noValidate>
        {children}
        <div className={styles.sectionFooter}>
          <div className={styles.sectionStatus}>
            {form.error ? (
              <p className={styles.sectionError} role="alert">
                {form.error}
              </p>
            ) : null}
            {form.saved && !form.error ? (
              <p className={styles.sectionSaved} role="status">
                <Icon name="check" size={14} />
                <span>Saved</span>
              </p>
            ) : null}
          </div>
          {saveLabel ? (
            <Button type="submit" variant="primary" loading={form.submitting} disabled={form.submitting}>
              {saveLabel}
            </Button>
          ) : null}
        </div>
      </form>
    </section>
  )
}
