import { useEffect, useRef, useState } from 'react'
import { fetchHealth } from '../../api/health.js'
import Icon from '../ui/Icon.jsx'
import styles from './ApiStatus.module.css'

const POLL_MS = 60000

/**
 * API reachability indicator.
 *
 * Phase 1 has exactly one endpoint, `/health`, and it needs no session, so this
 * is the whole of the "is the backend wired up" story for now. It only surfaces
 * a banner when something is wrong, and it is never printed.
 *
 * @returns {{ online: boolean, checking: boolean }}
 */
export function useApiHealth() {
  const [online, setOnline] = useState(true)
  const [checking, setChecking] = useState(true)
  const active = useRef(true)

  useEffect(() => {
    const controller = new AbortController()
    let timer = 0

    const probe = async () => {
      try {
        await fetchHealth({ signal: controller.signal })
        if (active.current) setOnline(true)
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
        if (active.current) setOnline(false)
      } finally {
        if (active.current) setChecking(false)
        timer = window.setTimeout(probe, POLL_MS)
      }
    }

    probe()
    return () => {
      active.current = false
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [])

  return { online, checking }
}

export default function ApiStatus() {
  const { online, checking } = useApiHealth()
  if (online || checking) return null

  return (
    <div className={`${styles.banner} no-print`} role="status">
      <Icon name="alert" size={18} />
      <p className={styles.text}>
        <strong className={styles.strong}>The API is not responding.</strong> Start it with{' '}
        <code className={styles.code}>npm run dev</code> from the repository root, then this notice will clear
        itself.
      </p>
    </div>
  )
}
