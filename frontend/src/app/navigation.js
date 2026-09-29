/**
 * Navigation map — the single source of truth for labels, icons and page titles.
 *
 * §18.6 requires consistent labels, so the desktop sidebar, the mobile top bar
 * and the document title all read from here rather than repeating strings.
 */

export const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: 'home', end: true },
  { to: '/quotations', label: 'Quotations', icon: 'fileText' },
  { to: '/invoices', label: 'Invoices', icon: 'receipt' },
  { to: '/clients', label: 'Clients', icon: 'users' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
]

/** Five slots for the mobile bottom bar: three primary plus More and New (§18.6). */
export const BOTTOM_NAV_ITEMS = [NAV_ITEMS[0], NAV_ITEMS[1], NAV_ITEMS[2]]

export const MORE_NAV_ITEMS = [NAV_ITEMS[3], NAV_ITEMS[4]]

/**
 * New-button targets, ordered by usefulness (§18.6).
 *
 * There is deliberately no "New invoice" entry: an invoice only ever exists by
 * converting an approved quotation (FR-I1), so offering a direct create would
 * point at a flow that does not exist. The quotations entry above is where new
 * invoices actually come from.
 */
export const CREATE_ACTIONS = [
  { to: '/quotations/new', label: 'New quotation', icon: 'fileText' },
  { to: '/clients', label: 'New client', icon: 'user' },
]

/** @type {Record<string, string>} path prefix -> document title */
export const PAGE_TITLES = {
  '/': 'Dashboard',
  '/login': 'Sign in',
  '/quotations': 'Quotations',
  '/quotations/new': 'New quotation',
  '/invoices': 'Invoices',
  '/clients': 'Clients',
  '/settings': 'Settings',
}

/**
 * @param {string} pathname
 * @returns {string}
 */
export function titleForPath(pathname) {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname]
  if (pathname.includes('/edit')) return 'Edit quotation'
  // The print routes are named apart from the on-screen routes: a print tab
  // should not read as if the user is looking at the editable detail page.
  // (The document's own number is shown in the print toolbar, not here — the
  // title is static per path and the id is not.)
  if (/^\/print\/quotation\/[^/]+$/.test(pathname)) return 'Print quotation'
  if (/^\/print\/invoice\/[^/]+$/.test(pathname)) return 'Print invoice'
  if (/\/quotations\/[^/]+$/.test(pathname)) return 'Quotation'
  if (/\/invoices\/[^/]+$/.test(pathname)) return 'Invoice'
  if (/\/clients\/[^/]+$/.test(pathname)) return 'Client'

  // An unmatched path renders the 404 page, so the title must say so. Falling
  // through to the bare brand name left a tab titled "Ruchita Interiors" on a page
  // that reads "That page does not exist" - found by the browser check, since no
  // unit test looked at the title for an unknown route.
  if (pathname !== '/') return 'Page not found'
  return 'Ruchita Interiors'
}
