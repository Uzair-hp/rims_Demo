/**
 * Breakpoint scale shared by CSS and JavaScript.
 *
 * Media queries cannot read custom properties, so the values live in
 * `styles/tokens.css` and are read back from the computed style here. That keeps
 * the JS media queries from drifting away from the CSS ones.
 */

export const BREAKPOINT_TOKEN_NAMES = {
  sm: '--breakpoint-sm',
  md: '--breakpoint-md',
  lg: '--breakpoint-lg',
  xl: '--breakpoint-xl',
}

/** @returns {Record<keyof typeof BREAKPOINT_TOKEN_NAMES, number>} pixel values */
export function readBreakpoints() {
  if (typeof window === 'undefined') {
    return { sm: 480, md: 768, lg: 1024, xl: 1280 }
  }
  const styles = window.getComputedStyle(document.documentElement)
  /** @type {Record<string, number>} */
  const parsed = {}
  for (const [name, token] of Object.entries(BREAKPOINT_TOKEN_NAMES)) {
    const raw = styles.getPropertyValue(token).trim()
    const value = Number.parseFloat(raw)
    parsed[name] = Number.isFinite(value) ? value : 0
  }
  return /** @type {any} */ (parsed)
}
