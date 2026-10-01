import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import NavDrawer from './NavDrawer.jsx'

// Read as text rather than imported: jsdom runs no animations, so there is nothing
// to observe at runtime, and `import ...?raw` does not survive the import linter.
// Vitest runs from the frontend root, which is where this path is anchored.
const drawerCss = readFileSync(resolve(process.cwd(), 'src/components/layout/NavDrawer.module.css'), 'utf8')
import { useIsDesktop } from '../../hooks/useMediaQuery.js'

/**
 * Drawer behaviour the route-level shell tests cannot see on their own: the focus
 * handling, the scroll lock, and the mount/unmount lifecycle.
 *
 * `NavDrawer` is rendered directly rather than through `AppShell` so the open
 * state does not depend on the hamburger, and the desktop-width unmount is
 * exercised by stubbing `matchMedia`'s consumer instead of resizing a jsdom
 * window.
 *
 * `Sidebar` reads three providers for its branding and account row; they are
 * stubbed the same way `Sidebar.test.jsx` does, so the drawer renders without a
 * router stack or a session.
 */

vi.mock('../../features/auth/AuthProvider.jsx', () => ({
  useAuth: () => ({ user: { name: 'Owner', email: 'owner@test.local' }, signOut: vi.fn() }),
}))

vi.mock('../../app/useTheme.js', () => ({
  useTheme: () => ({ resolvedTheme: 'light', toggleTheme: vi.fn() }),
}))

vi.mock('../../features/settings/SettingsProvider.jsx', () => ({
  useSettings: () => ({ logoSrc: null }),
}))

vi.mock('../../hooks/useMediaQuery.js', () => ({
  useIsDesktop: vi.fn(() => false),
}))

const renderDrawer = (props = {}) =>
  render(
    <MemoryRouter>
      <NavDrawer open onClose={() => {}} {...props} />
    </MemoryRouter>,
  )

beforeEach(() => {
  vi.mocked(useIsDesktop).mockReturnValue(false)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})

describe('NavDrawer', () => {
  it('renders nothing while closed', () => {
    renderDrawer({ open: false })
    expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument()
  })

  it('exposes a labelled modal dialog with the id the hamburger points at', () => {
    renderDrawer()

    const dialog = screen.getByRole('dialog', { name: 'Navigation' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    // `TopBar` wires `aria-controls` to this id; a rename would silently break
    // the association between the button and the panel it opens.
    expect(dialog).toHaveAttribute('id', 'primary-navigation')
  })

  it('keeps the sidebar navigation landmark inside the dialog', () => {
    renderDrawer()

    const dialog = screen.getByRole('dialog', { name: 'Navigation' })
    expect(within(dialog).getByRole('navigation', { name: 'Primary' })).toBeInTheDocument()
  })

  it('moves focus into the panel so a keyboard user is not left behind it', async () => {
    renderDrawer()

    const dialog = screen.getByRole('dialog', { name: 'Navigation' })
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
  })

  it('traps Tab inside the panel', async () => {
    renderDrawer()

    const dialog = screen.getByRole('dialog', { name: 'Navigation' })
    const focusable = [...dialog.querySelectorAll('a[href], button')]
    const last = focusable[focusable.length - 1]

    last.focus()
    await userEvent.tab()

    // Tab from the last control wraps to the first rather than reaching the page
    // behind the modal drawer.
    expect(dialog.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).toBe(focusable[0])
  })

  it('closes on Escape from anywhere on the page', async () => {
    const onClose = vi.fn()
    renderDrawer({ onClose })

    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('closes when the scrim is clicked', async () => {
    const onClose = vi.fn()
    renderDrawer({ onClose })

    await userEvent.click(screen.getByRole('button', { name: 'Close navigation overlay' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('gives the scrim a different name from the close button', () => {
    renderDrawer()

    // Two controls with one accessible name is ambiguous to announce and
    // impossible to target individually; the scrim is the background dismiss.
    expect(screen.getByRole('button', { name: 'Close navigation overlay' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close navigation' })).toBeInTheDocument()
  })

  it('locks background scrolling while open and restores it once the panel is gone', async () => {
    const onClose = vi.fn()
    const { rerender, unmount } = renderDrawer({ onClose })

    expect(document.body.style.overflow).toBe('hidden')

    // Still locked through the slide-out: the panel is on screen and swallowing
    // touches, so releasing the page early would let it scroll under the drawer.
    rerender(
      <MemoryRouter>
        <NavDrawer open={false} onClose={onClose} />
      </MemoryRouter>,
    )
    expect(document.body.style.overflow).toBe('hidden')

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument())
    unmount()
    expect(document.body.style.overflow).not.toBe('hidden')
  })

  it('keeps the panel mounted long enough to animate out', async () => {
    const { rerender } = renderDrawer()

    rerender(
      <MemoryRouter>
        <NavDrawer open={false} onClose={() => {}} />
      </MemoryRouter>,
    )

    // Still mounted right after the close request: unmounting here would cut the
    // slide-out off mid-travel, which is why the exit is animated at all.
    expect(screen.getByRole('dialog', { name: 'Navigation' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument())
  })

  it('opens with an animation, because the panel is mounted already in its open state', () => {
    // The slide-in regression, asserted as a mechanism rather than with timing.
    //
    // The panel is inserted already carrying `.panelOpen`, so a *transition* would
    // have no previous computed value to move away from and the drawer would
    // appear instead of sliding in — while closing, which only removes that class
    // from an element already on screen, animated correctly the whole time. An
    // animation has no such requirement: it plays from its `from` keyframe as soon
    // as the element exists.
    //
    // The stylesheet is read as text because jsdom runs no animations, so there is
    // nothing to observe at runtime; what matters is that the contract is written
    // down and stays written.
    expect(drawerCss).toMatch(/\.panelOpen\s*\{[^}]*animation:/)

    // Starting off-screen is the point of it: a keyframe that began at rest would
    // just hold the panel still for 220ms before it appeared.
    const keyframes = drawerCss.slice(drawerCss.indexOf('@keyframes nav-drawer-panel-enter'))
    expect(keyframes).toMatch(/from\s*\{[^}]*translateX\(-100%\)/)
    expect(keyframes).toMatch(/to\s*\{[^}]*translateX\(0\)/)

    // Same duration and easing as the exit transition, so the two halves of the
    // gesture read as one movement rather than two different ones.
    expect(drawerCss).toMatch(
      /\.panel\s*\{[^}]*transition:\s*transform\s+var\(--duration-slow\)\s+var\(--ease-out\)/,
    )
    expect(drawerCss).toMatch(
      /\.panelOpen\s*\{[^}]*animation:[^;]*var\(--duration-slow\)\s+var\(--ease-out\)/,
    )

    // The scrim fades the same way for the same reason.
    expect(drawerCss).toMatch(/\.backdropOpen\s*\{[^}]*animation:/)
    expect(drawerCss).toMatch(/@keyframes\s+nav-drawer-scrim-enter/)
  })

  it('renders no panel on a desktop width, where the sidebar is already on screen', () => {
    vi.mocked(useIsDesktop).mockReturnValue(true)
    renderDrawer()
    expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument()
  })
})
