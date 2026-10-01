import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Sidebar from './Sidebar.jsx'

/**
 * Sidebar branding tests.
 *
 * The sidebar is the app's one brand placement (§18.6): the mark with the company
 * name directly beneath it. The Dashboard used to carry a second copy, so these
 * assert both that the lockup is here and that it is well-formed — the name
 * after the mark, and not announced twice by a repeating `alt`.
 *
 * `Sidebar` is rendered directly rather than through `AppShell` so the test does
 * not need the router's provider stack or an authenticated session; the parts
 * exercised here are the mark, the wordmark and the collapsed rail.
 *
 * The sidebar is `display: none` below `lg`, and jsdom applies that real CSS rule
 * while ignoring the media query that reveals it. Role queries therefore treat it
 * as hidden, so structural assertions here go through the DOM rather than through
 * `getByRole` — otherwise every test would need `hidden: true` and say nothing
 * about the branding.
 */

const settingsState = vi.hoisted(() => ({ logoSrc: null }))

vi.mock('../../features/auth/AuthProvider.jsx', () => ({
  useAuth: () => ({ user: { name: 'Owner', email: 'owner@test.local' }, signOut: vi.fn() }),
}))

vi.mock('../../app/useTheme.js', () => ({
  useTheme: () => ({ resolvedTheme: 'light', toggleTheme: vi.fn() }),
}))

vi.mock('../../features/settings/SettingsProvider.jsx', () => ({
  useSettings: () => settingsState,
}))

const renderSidebar = (props = {}) => {
  const utils = render(
    <MemoryRouter>
      <Sidebar {...props} />
    </MemoryRouter>,
  )
  return { ...utils, sidebar: utils.container.querySelector('aside') }
}

beforeEach(() => {
  settingsState.logoSrc = null
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})

describe('Sidebar branding', () => {
  it('shows the company name once, in the sidebar', () => {
    const { sidebar } = renderSidebar()

    const name = screen.getByText('Ruchita Interiors')
    expect(screen.getAllByText('Ruchita Interiors')).toHaveLength(1)
    expect(sidebar.contains(name)).toBe(true)
  })

  it('offers a close control instead of a collapse toggle in the drawer variant', () => {
    // The drawer plate is always full width on a phone, so there is nothing to
    // collapse; the control that dismisses it takes that slot instead.
    const { sidebar } = renderSidebar({ variant: 'drawer', onClose: vi.fn() })

    const close = sidebar.querySelector('button[aria-label="Close navigation"]')
    expect(close).toBeInTheDocument()
    expect(sidebar.querySelector('button[aria-pressed]')).not.toBeInTheDocument()
  })

  it('lists no create shortcuts unless they are passed in', () => {
    const without = renderSidebar({ variant: 'drawer', onClose: vi.fn() })
    expect(without.sidebar.textContent).not.toMatch(/New quotation/)
    without.unmount()

    const with_ = renderSidebar({
      variant: 'drawer',
      onClose: vi.fn(),
      createActions: [{ to: '/quotations/new', label: 'New quotation', icon: 'fileText' }],
    })
    expect(with_.sidebar.textContent).toMatch(/New quotation/)
  })

  it('places the name directly below the logo', () => {
    const { sidebar } = renderSidebar()

    const name = screen.getByText('Ruchita Interiors')
    const logo = sidebar.querySelector('img[src="/brand/logo.svg"]')
    expect(logo).toBeInTheDocument()

    // The name comes after the mark in document order, and is a sibling of the
    // plate that holds it — that is what "directly below" means in the DOM.
    const plate = logo.closest('span')
    expect(plate.parentElement).toBe(name.parentElement)
    expect(plate.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('keeps the existing bundled logo', () => {
    const { sidebar } = renderSidebar()
    expect(sidebar.querySelector('img[src="/brand/logo.svg"]')).toBeInTheDocument()
  })

  it('prefers an uploaded logo when Settings has one', () => {
    settingsState.logoSrc = '/api/v1/uploads/logo?v=1'
    const { sidebar } = renderSidebar()

    expect(sidebar.querySelector('img[src*="uploads/logo"]')).toBeInTheDocument()
  })

  it('does not repeat the name in the logo alt text', () => {
    const { sidebar } = renderSidebar()

    // The name is visible right under the mark, so an alt repeating it would make
    // a screen reader say it twice for one logo.
    const logo = sidebar.querySelector('.brand img') || sidebar.querySelector('img')
    expect(logo).toHaveAttribute('alt', '')
  })

  it('drops the wordmark in the collapsed rail, keeping the mark', () => {
    const { sidebar } = renderSidebar({ collapsed: true })

    // 76px has no room for the name; the mark carries the identity alone.
    expect(screen.queryByText('Ruchita Interiors')).not.toBeInTheDocument()
    expect(sidebar.querySelector('img[src="/brand/logo.svg"]')).toBeInTheDocument()
  })

  it('preserves the navigation in both rail states', () => {
    const expanded = renderSidebar()
    const expandedNav = expanded.sidebar.querySelector('nav[aria-label="Primary"]')
    expect(expandedNav).toBeInTheDocument()
    expect(expandedNav.querySelectorAll('a').length).toBeGreaterThan(0)
    expanded.unmount()

    const collapsed = renderSidebar({ collapsed: true })
    const collapsedNav = collapsed.sidebar.querySelector('nav[aria-label="Primary"]')
    expect(collapsedNav).toBeInTheDocument()
    expect(collapsedNav.querySelectorAll('a').length).toBeGreaterThan(0)
  })

  it('preserves the collapse toggle behaviour', () => {
    const expanded = renderSidebar({ collapsed: false })
    const toggle = expanded.sidebar.querySelector('button[aria-pressed]')
    expect(toggle.getAttribute('aria-label')).toBe('Collapse sidebar')
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    expanded.unmount()

    const collapsed = renderSidebar({ collapsed: true })
    const expandToggle = collapsed.sidebar.querySelector('button[aria-pressed]')
    expect(expandToggle.getAttribute('aria-label')).toBe('Expand sidebar')
    expect(expandToggle.getAttribute('aria-pressed')).toBe('true')
  })
})
