import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Scrollbar redesign guards (PLAN §18.10, Appendix B3).
 *
 * The scrollbar is one global layer in `base.css` plus a handful of tokens, so
 * there is nothing to assert through the DOM: jsdom applies no scrollbar CSS and
 * resolves no custom properties. These read the stylesheets as text, the way the
 * rail tests in `Sidebar.test.jsx` do, to pin the two things that matter — that
 * every scrolling surface gets one slim, token-driven bar, and that the values
 * stay in `tokens.css` rather than leaking literals into the stylesheet.
 */

const read = (relative) => readFileSync(resolve(process.cwd(), relative), 'utf8')

const BASE_CSS = read('src/styles/base.css')
const TOKENS_CSS = read('src/styles/tokens.css')
const SIDEBAR_CSS = read('src/components/layout/Sidebar.module.css')

/* The scrollbar layer only: from its banner to the reduced-motion block that
   happens to follow it, so "no raw values" is asserted against the new code and
   not the whole reset. */
const scrollbars = BASE_CSS.slice(
  BASE_CSS.indexOf('Scrollbars (§18.10)'),
  BASE_CSS.indexOf('@media (prefers-reduced-motion'),
)

const block = (css, selector) =>
  css.match(new RegExp(`${selector.replace(/[[\]']/g, '\\$&')}\\s*\\{[^}]*\\}`))?.[0] || ''

describe('Scrollbars', () => {
  it('gives every scrolling surface one slim, token-driven bar', () => {
    expect(scrollbars).toMatch(/\*\s*\{[^}]*scrollbar-width:\s*thin/)
    expect(scrollbars).toMatch(/scrollbar-color:\s*var\(--scrollbar-thumb\)\s+var\(--scrollbar-track\)/)
    expect(scrollbars).toMatch(/::-webkit-scrollbar\s*\{[^}]*inline-size:\s*var\(--scrollbar-size\)/)
    expect(scrollbars).toMatch(/::-webkit-scrollbar-thumb\s*\{[^}]*background:\s*var\(--scrollbar-thumb\)/)
    // The inset, rounded-pill thumb is the whole "sleek" treatment.
    expect(scrollbars).toMatch(/border-radius:\s*var\(--radius-pill\)/)
    expect(scrollbars).toMatch(/background-clip:\s*padding-box/)
  })

  it('writes no raw colour or size values in the scrollbar layer', () => {
    // Appendix B3: the only file allowed raw values is tokens.css. A literal
    // here would be the first crack in that rule.
    expect(scrollbars).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    expect(scrollbars).not.toMatch(/\brgb(h|a)?\(/i)
    expect(scrollbars).not.toMatch(/\b\d+px\b/)
  })

  it('declares the thumb tokens per theme and keeps the rail family fixed', () => {
    const root = block(TOKENS_CSS, ':root')
    const dark = block(TOKENS_CSS, "[data-theme='dark']")

    expect(root).toMatch(/--scrollbar-size:\s*\d/)
    expect(root).toMatch(/--scrollbar-thumb:\s*rgb/)
    expect(root).toMatch(/--scrollbar-thumb-rail:\s*rgb/)
    // The thumb inverts with the theme, so the dark block must restate it.
    expect(dark).toMatch(/--scrollbar-thumb:\s*rgb/)

    // The rail is a fixed ink plate in both themes, so its thumb must NOT be
    // redefined in the dark block — that is the copy-paste mistake this pins.
    expect(dark).not.toMatch(/--scrollbar-thumb-rail/)
  })

  it('re-points the navigation rail at the fixed rail thumb', () => {
    // The sidebar scrolls inside the dark plate, where the themed thumb would be
    // invisible; it re-points the token rather than duplicating the thumb rules.
    expect(SIDEBAR_CSS).toMatch(/--scrollbar-thumb:\s*var\(--scrollbar-thumb-rail\)/)
  })
})
