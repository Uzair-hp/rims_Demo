import { useId } from 'react'
import styles from './TextField.module.css'

/**
 * Labelled form control with hint and inline error (§15, §20).
 *
 * One component for every plain field in the app: label above the control,
 * optional hint line, and an error rendered in a `role="alert"` node wired to
 * the input through `aria-describedby` / `aria-invalid`, so screen readers
 * announce the message the moment it appears.
 *
 * `onChange` hands back the *value*, not the event — every caller is a controlled
 * form storing one string per key, and threading the raw event through would add
 * noise without adding power.
 *
 * @param {{
 *   label: string,
 *   value: string,
 *   onChange: (value: string) => void,
 *   name?: string,
 *   type?: string,
 *   as?: 'input' | 'textarea' | 'select',
 *   error?: string | null,
 *   hint?: string,
 *   required?: boolean,
 *   disabled?: boolean,
 *   autoComplete?: string,
 *   placeholder?: string,
 *   rows?: number,
 *   inputMode?: 'text' | 'numeric' | 'decimal' | 'email' | 'tel' | 'url',
 *   maxLength?: number,
 *   className?: string,
 *   children?: import('react').ReactNode,
 *   [key: string]: any,
 * }} props
 */
export default function TextField({
  label,
  value,
  onChange,
  name,
  type = 'text',
  as = 'input',
  error,
  hint,
  required = false,
  disabled = false,
  autoComplete,
  placeholder,
  rows = 5,
  inputMode,
  maxLength,
  className = '',
  children,
  ...rest
}) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined

  const shared = {
    id,
    name,
    value: value ?? '',
    disabled,
    required,
    autoComplete,
    'aria-describedby': describedBy,
    'aria-invalid': error ? true : undefined,
    onChange: (event) => onChange(event.target.value),
  }

  const controlClass = `${styles.control} ${error ? styles.invalid : ''}`.trim()

  return (
    <div className={`${styles.field} ${className}`.trim()}>
      <label className={styles.label} htmlFor={id}>
        {label}
        {required ? (
          <span className={styles.required} aria-hidden="true">
            {' *'}
          </span>
        ) : null}
      </label>

      {as === 'textarea' ? (
        <textarea className={controlClass} rows={rows} placeholder={placeholder} {...shared} {...rest} />
      ) : as === 'select' ? (
        <select className={controlClass} {...shared} {...rest}>
          {children}
        </select>
      ) : (
        <input
          className={controlClass}
          type={type}
          placeholder={placeholder}
          inputMode={inputMode}
          maxLength={maxLength}
          {...shared}
          {...rest}
        />
      )}

      {hint ? (
        <p className={styles.hint} id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className={styles.error} id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
