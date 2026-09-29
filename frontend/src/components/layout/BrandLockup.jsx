import { useState } from 'react'
import styles from './BrandLockup.module.css'

/**
 * The company name, in one place.
 *
 * It was previously written out in three variants; a single constant means the
 * sidebar lockup, the plain-text fallback and the login page cannot disagree
 * about how the business is named.
 */
const COMPANY_NAME = 'Ruchita Interiors'

/**
 * Brand lockup.
 *
 * The official wordmark is gold artwork, so it is only ever shown on the ink
 * plate — never as bare gold text on a light surface, which is exactly the
 * contrast problem §18.4 and §18.11 defer to Phase 6. `variant="text"` is the
 * plain-type fallback for the mobile top bar, where the plate would be too heavy.
 *
 * Phase 3: when Settings holds an uploaded company logo (`logoSrc`, from
 * `GET /uploads/logo`), it replaces the bundled mark — same plate, same slot,
 * no layout change. A failed image load falls back to the bundled vector, so a
 * stale or malformed upload can never leave an empty brand slot (§20).
 *
 * The mark itself is the vector in `public/brand/logo.svg`, reduced from the
 * source trace by `scripts/optimize_logo.mjs`; the PNG siblings under
 * `public/icons` exist only for surfaces that cannot take a vector.
 *
 * Phase 6: `variant="login"` renders the logo + wordmark + gold line for the
 * login page (both desktop charcoal panel and mobile header band).
 *
 * `variant="stack"` renders the plate with the company name beneath it, for the
 * sidebar — the app's one primary brand placement. See the inline comment there
 * for why its wordmark is gold rather than ink. `showWordmark={false}` drops the
 * name and leaves the mark, which is what the collapsed 76px rail needs.
 *
 * @param {{ variant?: 'plate' | 'text' | 'login' | 'stack', height?: number, logoSrc?: string | null, alt?: string, showWordmark?: boolean, className?: string }} props
 */
export default function BrandLockup({
  variant = 'plate',
  height = 32,
  logoSrc = null,
  alt = 'Ruchita Interiors',
  showWordmark = true,
  className = '',
}) {
  const [uploadedFailed, setUploadedFailed] = useState(false)
  const showUploaded = Boolean(logoSrc) && !uploadedFailed

  if (variant === 'text') {
    return (
      <span className={`${styles.text} ${className}`.trim()}>
        <span className={styles.textName}>{COMPANY_NAME}</span>
        <span className={styles.textRule} aria-hidden="true" />
      </span>
    )
  }

  if (variant === 'login') {
    return (
      <div className={`${styles.login} ${className}`.trim()}>
        <div className={styles.loginLogo}>
          {showUploaded ? (
            <img
              src={logoSrc}
              alt={alt}
              height={height}
              className={styles.image}
              style={{ maxBlockSize: `${height}px` }}
              onError={() => setUploadedFailed(true)}
            />
          ) : (
            <img
              src="/brand/logo.svg"
              alt={alt}
              height={height}
              width={Math.round((height * 1424) / 772.5)}
              className={styles.image}
            />
          )}
        </div>
        <span className={styles.loginWordmark}>{COMPANY_NAME}</span>
        <span className={styles.loginRule} aria-hidden="true" />
      </div>
    )
  }

  if (variant === 'stack') {
    /*
     * The sidebar lockup: the ink plate, with the company name directly beneath.
     *
     * This is the app's primary brand placement. The Dashboard deliberately does
     * *not* repeat it — one location, so the name is never stated twice in view.
     *
     * The wordmark reuses the `text` variant's typography exactly
     * (`--font-display`, `--font-size-lg`, semibold) and differs only in colour:
     * the sidebar is on `--color-ink` in both themes, where `--color-ink` text
     * would be invisible, so the name is set in `--gold`. That token is defined
     * per theme (#c9a24b light, #d9b45c dark), so the wordmark stays legible on
     * the dark rail in both.
     */
    return (
      <span className={`${styles.stack} ${className}`.trim()}>
        <span className={styles.plate}>
          {showUploaded ? (
            <img
              src={logoSrc}
              alt={alt}
              height={height}
              className={styles.image}
              style={{ maxBlockSize: `${height}px` }}
              onError={() => setUploadedFailed(true)}
            />
          ) : (
            <img
              src="/brand/logo.svg"
              alt={alt}
              height={height}
              width={Math.round((height * 1424) / 772.5)}
              className={styles.image}
            />
          )}
        </span>
        <span className={styles.stackWordmark}>{showWordmark ? COMPANY_NAME : null}</span>
      </span>
    )
  }

  if (showUploaded) {
    // The uploaded logo's intrinsic ratio is unknown until it loads, so only the
    // height is fixed: the width follows the image itself, never stretched.
    return (
      <span className={`${styles.plate} ${className}`.trim()}>
        <img
          src={logoSrc}
          alt={alt}
          height={height}
          className={styles.image}
          style={{ maxBlockSize: `${height}px` }}
          onError={() => setUploadedFailed(true)}
        />
      </span>
    )
  }

  return (
    <span className={`${styles.plate} ${className}`.trim()}>
      <img
        src="/brand/logo.svg"
        alt={alt}
        height={height}
        width={Math.round((height * 1424) / 772.5)}
        className={styles.image}
      />
    </span>
  )
}
