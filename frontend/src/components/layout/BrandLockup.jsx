import { useState } from 'react'
import styles from './BrandLockup.module.css'

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
 * @param {{ variant?: 'plate' | 'text' | 'login', height?: number, logoSrc?: string | null, className?: string }} props
 */
export default function BrandLockup({ variant = 'plate', height = 32, logoSrc = null, className = '' }) {
  const [uploadedFailed, setUploadedFailed] = useState(false)
  const showUploaded = Boolean(logoSrc) && !uploadedFailed

  if (variant === 'text') {
    return (
      <span className={`${styles.text} ${className}`.trim()}>
        <span className={styles.textName}>Ruchita Interiors</span>
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
              alt="Ruchita Interiors"
              height={height}
              className={styles.image}
              style={{ maxBlockSize: `${height}px` }}
              onError={() => setUploadedFailed(true)}
            />
          ) : (
            <img
              src="/brand/logo.svg"
              alt="Ruchita Interiors"
              height={height}
              width={Math.round((height * 1424) / 772.5)}
              className={styles.image}
            />
          )}
        </div>
        <span className={styles.loginWordmark}>RUCHITA INTERIORS</span>
        <span className={styles.loginRule} aria-hidden="true" />
      </div>
    )
  }

  if (showUploaded) {
    // The uploaded logo's intrinsic ratio is unknown until it loads, so only the
    // height is fixed: the width follows the image itself, never stretched.
    return (
      <span className={`${styles.plate} ${className}`.trim()}>
        <img
          src={logoSrc}
          alt="Ruchita Interiors"
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
        alt="Ruchita Interiors"
        height={height}
        width={Math.round((height * 1424) / 772.5)}
        className={styles.image}
      />
    </span>
  )
}
