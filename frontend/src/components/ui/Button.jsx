import { forwardRef } from 'react'
import { Link } from 'react-router-dom'
import Icon from './Icon.jsx'
import styles from './Button.module.css'

/**
 * Buttons render gold for the single primary action on a screen and ink for
 * everything else (§18.4), so a page can never have two competing primaries.
 */
const VARIANTS = {
  primary: styles.primary,
  secondary: styles.secondary,
  ghost: styles.ghost,
  danger: styles.danger,
}

const SIZES = {
  sm: styles.sm,
  md: styles.md,
  lg: styles.lg,
}

/**
 * @param {{
 *   variant?: keyof typeof VARIANTS,
 *   size?: keyof typeof SIZES,
 *   icon?: string,
 *   iconRight?: string,
 *   loading?: boolean,
 *   fullWidth?: boolean,
 *   to?: string,
 *   href?: string,
 *   className?: string,
 *   children?: import('react').ReactNode,
 *   [key: string]: any
 * }} props
 */
const Button = forwardRef(function Button(
  {
    variant = 'secondary',
    size = 'md',
    icon,
    iconRight,
    loading = false,
    fullWidth = false,
    to,
    href,
    className = '',
    children,
    disabled,
    ...rest
  },
  ref,
) {
  const classes = [
    styles.button,
    VARIANTS[variant],
    SIZES[size],
    fullWidth ? styles.fullWidth : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  const content = (
    <>
      {loading ? (
        <span className={styles.spinner} aria-hidden="true" />
      ) : icon ? (
        <Icon name={icon} size={18} />
      ) : null}
      <span className={styles.label}>{children}</span>
      {!loading && iconRight ? <Icon name={iconRight} size={18} /> : null}
    </>
  )

  if (to) {
    return (
      <Link ref={ref} to={to} className={classes} {...rest}>
        {content}
      </Link>
    )
  }

  if (href) {
    return (
      <a ref={ref} href={href} className={classes} {...rest}>
        {content}
      </a>
    )
  }

  return (
    <button
      ref={ref}
      type="button"
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {content}
    </button>
  )
})

export default Button
