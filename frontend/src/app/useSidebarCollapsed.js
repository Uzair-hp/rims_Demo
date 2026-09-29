import { useCallback, useState } from 'react'

const STORAGE_KEY = 'ri.sidebar.collapsed'

/** @returns {boolean} */
function readStored() {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Desktop sidebar collapse state, persisted locally.
 *
 * Only meaningful from `lg` up, where the sidebar is shown; below that the
 * bottom bar is used instead and this value is ignored. Mirrors the persistence
 * pattern in `useTheme` so a chosen state survives reloads.
 *
 * @returns {{ collapsed: boolean, toggleCollapsed: () => void }}
 */
export function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState(readStored)

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
      } catch {
        /* storage unavailable (private mode): the session default still applies */
      }
      return next
    })
  }, [])

  return { collapsed, toggleCollapsed }
}
