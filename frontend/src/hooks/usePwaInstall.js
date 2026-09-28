import { useEffect, useState } from 'react'

/**
 * Captures the browser's install prompt so the PWA can be installed from the
 * app itself, and reports standalone mode for the iOS case where no event fires.
 *
 * @returns {{ canInstall: boolean, isStandalone: boolean, install: () => Promise<'accepted' | 'dismissed' | 'unavailable'> }}
 */
export function usePwaInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [isStandalone, setIsStandalone] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true
  })

  useEffect(() => {
    const onPrompt = (event) => {
      event.preventDefault()
      setDeferredPrompt(event)
    }
    const onInstalled = () => {
      setDeferredPrompt(null)
      setIsStandalone(true)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const install = async () => {
    if (!deferredPrompt) return 'unavailable'
    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    setDeferredPrompt(null)
    return outcome
  }

  return { canInstall: Boolean(deferredPrompt), isStandalone, install }
}
