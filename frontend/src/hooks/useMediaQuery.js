import { useCallback, useSyncExternalStore } from 'react'
import { readBreakpoints } from '../lib/breakpoints.js'

/**
 * Subscribes to a media query, re-reading the threshold from the CSS custom
 * properties so JS and CSS can never disagree about where the layout switches.
 *
 * @param {string} name One of the keys in `BREAKPOINT_TOKEN_NAMES`.
 * @returns {boolean}
 */
export function useMediaQuery(name) {
  const subscribe = useCallback(
    (onStoreChange) => {
      const media = window.matchMedia(`(min-width: ${readBreakpoints()[name]}px)`)
      media.addEventListener('change', onStoreChange)
      return () => media.removeEventListener('change', onStoreChange)
    },
    [name],
  )

  const getSnapshot = useCallback(
    () => window.matchMedia(`(min-width: ${readBreakpoints()[name]}px)`).matches,
    [name],
  )

  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}

/** Desktop/sidebar layout starts at `lg` (§18.6). */
export function useIsDesktop() {
  return useMediaQuery('lg')
}
