import Icon from '../ui/Icon.jsx'
import { useTheme } from '../../app/useTheme.js'
import styles from './ThemeToggle.module.css'

/**
 * Shared theme control for the mobile top bar, desktop sidebar and More sheet.
 *
 * @param {{ className?: string, showLabel?: boolean }} props
 */
export default function ThemeToggle({ className = '', showLabel = true }) {
  const { resolvedTheme, toggleTheme } = useTheme()
  const label = resolvedTheme === 'dark' ? 'Light theme' : 'Dark theme'
  const classes = [styles.button, !showLabel ? styles.iconOnly : '', className].filter(Boolean).join(' ')

  return (
    <button type="button" className={classes} onClick={toggleTheme} aria-label={`Switch to ${label.toLowerCase()}`}>
      <Icon name={resolvedTheme === 'dark' ? 'sun' : 'moon'} size={20} />
      {showLabel ? <span>{label}</span> : null}
    </button>
  )
}