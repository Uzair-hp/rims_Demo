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

/* Stylesheet sources, read raw. jsdom resolves no custom properties, so the rail
   assertions below have to look at the CSS itself rather than at a computed style. */
const [SIDEBAR_CSS, LOCKUP_CSS, TOKENS_CSS] = [
  import.meta.glob('./Sidebar.module.css', { query: '?raw', import: 'default', eager: true }),
  import.meta.glob('./BrandLockup.module.css', { query: '?raw', import: 'default', eager: true }),
  import.meta.glob('../../styles/tokens.css', { query: '?raw', import: 'default', eager: true }),
].map((loaded) => loaded[Object.keys(loaded)[0]])

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

/**
 * The rail plate in the dark theme.
 *
 * The sidebar painted itself with `--color-ink` / `--color-ink-inverse`, which are
 * *text* tokens and invert under `[data-theme='dark']` — so the dark theme rendered
 * a near-white slab beside a dark page, with the nav labels at ~2.6:1 because
 * `--color-ink-muted-inverse` is a mid grey on a light plate. The plate now comes
 * from a fixed `--color-rail*` family.
 *
 * jsdom does not resolve custom properties, so a computed style cannot say which
 * token a rule picks up, and it applies no stylesheet cascade at all. These
 * assertions are therefore against the *stylesheet source*, the same approach
 * `services-layout.test.jsx` takes for its chip regressions. The two halves matter
 * separately: the rail must not use an inverting token, and the tokens must not be
 * redefined in the dark block — that is the part a future "just tune it in dark
 * mode" edit would break, silently re-inverting the plate.
 */
describe('Sidebar — the rail is an ink plate in both themes', () => {
  const read = (source) => String(source ?? '')
  const sidebarCss = () => read(SIDEBAR_CSS)
  const lockupCss = () => read(LOCKUP_CSS)
  const tokensCss = () => read(TOKENS_CSS)

  /** The `:root` block and the `[data-theme='dark']` block, by name. */
  const block = (selector) =>
    tokensCss().match(new RegExp(`${selector.replace(/[[\]]/g, '\\$&')}\\s*\\{[^}]*\\}`))?.[0] || ''

  it('paints the plate and its text from the rail family, not the inverting ink tokens', () => {
    const css = sidebarCss()

    expect(css).toMatch(/background:\s*var\(--color-rail\)/)
    expect(css).toMatch(/color:\s*var\(--color-rail-ink\)/)

    // Every label on the rail -- links, group heading, the account block and sign
    // out -- must read off the rail, or one of them is left in the theme's text
    // colour on a plate that no longer matches it.
    expect(css).not.toMatch(/var\(--color-ink-inverse\)/)
    expect(css).not.toMatch(/var\(--color-ink-muted-inverse\)/)
  })

  it('keeps hover states and rail edges visible, since the plate is now always dark', () => {
    const css = sidebarCss()

    // `--color-surface-translucent` is a *white* wash, which is invisible over the
    // white plate the old dark theme produced.
    expect(css).not.toMatch(/var\(--color-surface-translucent\)/)
    expect(css).toMatch(/var\(--color-rail-hover\)/)
    expect(css).toMatch(/var\(--color-rail-border\)/)
  })

  it('declares the rail family once, in :root, and not in the dark block', () => {
    expect(block(':root')).toMatch(/--color-rail:/)
    expect(block(':root')).toMatch(/--color-rail-ink-muted:/)

    // The whole point: both themes want the same plate, so a dark override would
    // undo the fix. `--color-rail*` must not appear after the dark selector.
    expect(block("\\[data-theme='dark'\\]")).not.toMatch(/--color-rail/)
  })

  it('keeps the muted rail label at AA on the plate', () => {
    // #b5afa2 on #1d1b16 is ~7.8:1. Asserted as a ratio so a future retune of
    // either value fails here rather than in someone's eyes.
    const luminance = (hex) => {
      const channels = hex
        .slice(1)
        .match(/../g)
        .map((part) => parseInt(part, 16) / 255)
        .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
    }
    const ratio = (a, b) => {
      const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
      return (light + 0.05) / (dark + 0.05)
    }

    const declared = (name) => block(':root').match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i'))?.[1]
    expect(ratio(declared('--color-rail-ink-muted'), declared('--color-rail'))).toBeGreaterThanOrEqual(4.5)
    expect(ratio(declared('--color-rail-ink'), declared('--color-rail'))).toBeGreaterThanOrEqual(4.5)
  })

  it('puts the logo plate on the rail colour too', () => {
    // `.plate` stays `--color-ink` for the standalone variant, so the sidebar's
    // `stack` variant re-points it; otherwise the mark sits in a white tile.
    expect(lockupCss()).toMatch(/\.stack \.plate\s*\{[^}]*background:\s*var\(--color-rail\)/)
  })
})
