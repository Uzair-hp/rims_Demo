import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { titleForPath } from './navigation.js'

/**
 * Keeps the document title in step with the route (§18.6). Mounted once inside
 * the router so it reacts to every navigation.
 */
export default function DocumentTitle() {
  const { pathname } = useLocation()

  useEffect(() => {
    const section = titleForPath(pathname)
    document.title = section === 'Ruchita Interiors' ? section : `${section} · Ruchita Interiors`
  }, [pathname])

  return null
}
