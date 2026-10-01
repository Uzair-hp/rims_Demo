/*
 * Apply the stored theme before first paint.
 *
 * A dark-theme user must never see a white flash on reload, which means the
 * `data-theme` attribute has to be on <html> before the browser paints. React
 * cannot do that from a component: by the time it renders, the page has already
 * painted with the stylesheet's light default.
 *
 * This lives in a file rather than inline in index.html so the Content-Security-
 *-Policy can forbid inline script outright (`script-src 'self'`, no hash, no
 * 'unsafe-inline'). A synchronously-loaded external script in <head> still runs
 * before the first paint, so the no-flash guarantee is unchanged.
 *
 * Kept tiny and dependency-free on purpose: it runs ahead of the bundle.
 */
;(function () {
  try {
    var stored = window.localStorage.getItem('ri.theme')
    var theme =
      stored === 'light' || stored === 'dark'
        ? stored
        : window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
    document.documentElement.setAttribute('data-theme', theme)
  } catch {
    // Storage can throw in private mode; the light default is a safe fallback.
    document.documentElement.setAttribute('data-theme', 'light')
  }
})()
