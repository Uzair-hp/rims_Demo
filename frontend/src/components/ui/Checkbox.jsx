import { useId } from 'react'
import styles from './Checkbox.module.css'

/**
 * A themed checkbox.
 *
 * **A real `<input type="checkbox">`, not a div.** The box is styled with
 * `accent-color` rather than `appearance: none`, so the browser still draws the
 * control and everything that comes with it survives: Space-key toggling,
 * arrow-key grouping, form participation, and the screen-reader announcement
 * ("Show archived, checkbox, not checked"). Rebuilding the box out of spans would
 * cost all of that for a cosmetic gain.
 *
 * `accent-color` is the reason this is small: it makes the *native* control adopt
 * a design token, so light and dark are handled by the token sheet rather than by
 * a second set of rules here (§18.11). The pattern is not new — the Settings
 * terms editor already did this, and extracting it here means one implementation
 * serves both call sites.
 *
 * The label wraps the input, so the whole row is a click target, and the row
 * carries `min-block-size: var(--touch-target-min)` for §19's 44 px rule.
 *
 * @param {{
 *   label: string,
 *   checked: boolean,
 *   onChange: (checked: boolean) => void,
 *   hint?: string,
 *   className?: string,
 * }} props
 */
export default function Checkbox({ label, checked, onChange, hint, className = '' }) {
  // A generated id keeps several instances independent without the caller having
  // to invent one, and `useId` is SSR-safe.
  const id = useId()

  return (
    <div className={[styles.row, className].filter(Boolean).join(' ')}>
      <input
        id={id}
        type="checkbox"
        className={styles.input}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      {hint ? (
        <span className={styles.hint} id={`${id}-hint`}>
          {hint}
        </span>
      ) : null}
    </div>
  )
}
