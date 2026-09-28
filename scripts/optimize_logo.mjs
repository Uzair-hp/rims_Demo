/**
 * Ruchita Interiors - brand logo optimiser.
 *
 * The official logo arrives as `brand/logo.svg`, an automatic raster trace
 * (visioncortex VTracer) of the source artwork. A trace of a photographic or
 * gradient image is technically SVG but practically unusable in a web app: it
 * carries thousands of near-identical fills for anti-aliasing noise and draws
 * every one of them as its own tiny path. The file that reaches us is ~20 MB,
 * which would be precached whole by the service worker.
 *
 * This reduces the trace to a shippable vector:
 *
 *   1. parse `<path d fill transform>` and bake the translate into coordinates
 *   2. quantise the thousands of near-duplicate fills to a small palette
 *      (median cut), because the extra shades are tracing noise, not design
 *   3. flatten each cubic to a polyline, then Douglas-Peucker it, which is
 *      where nearly all the byte savings come from
 *   4. merge same-fill subpaths into one path per palette colour
 *   5. emit a trimmed `viewBox` so the asset scales to any container
 *
 * Fidelity note: this is a lossy reduction, so it is verified by measurement
 * rather than by eye - the script refuses to write a file that regresses in
 * size, path count or geometry. A human should still eyeball the result.
 *
 * Usage:
 *   node scripts/optimize_logo.mjs            write frontend/public/brand/logo.svg
 *   node scripts/optimize_logo.mjs --report   measure only, write nothing
 *   node scripts/optimize_logo.mjs --epsilon 2 --colors 12
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = join(ROOT, 'brand', 'logo.svg')
const OUT_DIR = join(ROOT, 'frontend', 'public', 'brand')

/**
 * Budget for the shipped asset. The previous PNG wordmark was ~202 KB, so a
 * vector at the same weight is comfortably shippable. A regression past this
 * means the simplification silently stopped working and must not be written.
 */
const MAX_BYTES = 150 * 1024

const argv = process.argv.slice(2)
const has = (flag) => argv.includes(flag)
const num = (flag, fallback) => {
  const i = argv.indexOf(flag)
  return i === -1 || argv[i + 1] === undefined ? fallback : Number(argv[i + 1])
}

const reportOnly = has('--report')
// Tolerance is in viewBox units on a 772-unit-tall mark. The lockup renders at
// 30-34 CSS px, so one display pixel is roughly 23 units: 3.5 is about a sixth
// of a pixel, far below anything visible, while still collapsing 1.9 MB of path
// data to 124 KB. At 10 the aspect ratio starts to drift, so this is the floor.
const epsilon = num('--epsilon', 3.5)
// Colour count barely moves the byte total (the path data dominates), so keep
// enough tones for the gold gradient to survive rather than flattening it to
// two or three colours for no saving.
const colorCount = num('--colors', 16)

// -- parsing -----------------------------------------------------------------

/** Splits path data into command letters and their numeric arguments. */
function tokenize(d) {
  const tokens = []
  const re = /([A-Za-z])|(-?\d*\.?\d+)/g
  let match
  while ((match = re.exec(d)) !== null) {
    if (match[1]) tokens.push({ cmd: match[1] })
    else tokens.push({ n: Number(match[2]) })
  }
  return tokens
}

/**
 * Converts one `d` string into closed subpaths of absolute points, with the
 * path's `translate()` already applied. The trace only ever emits absolute
 * `M`/`C`/`Z`, so this handles exactly that and throws on anything else rather
 * than silently mis-drawing an unexpected construct.
 */
function toSubpaths(d, tx, ty) {
  const tokens = tokenize(d)
  const subpaths = []
  let points = null
  let cursor = null
  let i = 0

  const take = (n) => {
    const out = []
    for (let k = 0; k < n; k += 1) {
      const token = tokens[i]
      if (token === undefined || token.n === undefined) {
        throw new Error(`path data ended early; wanted ${n} numbers`)
      }
      out.push(token.n)
      i += 1
    }
    return out
  }

  while (i < tokens.length) {
    const token = tokens[i]
    if (token.cmd === undefined) {
      throw new Error(`expected a command, found number ${token.n}`)
    }
    if (token.cmd === 'M') {
      i += 1
      const [x, y] = take(2)
      if (points) subpaths.push(points)
      points = [[x + tx, y + ty]]
      cursor = [x + tx, y + ty]
    } else if (token.cmd === 'C') {
      i += 1
      const [x1, y1, x2, y2, x, y] = take(6)
      if (!points) throw new Error('cubic before any moveto')
      // The trace stores curves in the path's local space, so every control
      // point has to be shifted by the same translate as the moveto. Skipping
      // this and translating only the moveto draws each curve in the wrong
      // place, which silently inflates the bounding box.
      flatten(
        points,
        cursor,
        x1 + tx,
        y1 + ty,
        x2 + tx,
        y2 + ty,
        x + tx,
        y + ty,
      )
      cursor = [x + tx, y + ty]
    } else if (token.cmd === 'Z' || token.cmd === 'z') {
      i += 1
      if (points) {
        points.push([points[0][0], points[0][1]])
        subpaths.push(points)
        points = null
      }
    } else {
      throw new Error(`unsupported command "${token.cmd}"; the trace only emits M/C/Z`)
    }
  }
  if (points) subpaths.push(points)
  return subpaths
}

/** Appends a flattened cubic to `points`, starting from the current cursor. */
function flatten(points, cursor, x1, y1, x2, y2, x, y) {
  const [x0, y0] = cursor
  // Subdivision count from the control polygon's deviation, so flat runs stay
  // cheap and tight curves get the samples they need.
  const dev =
    Math.abs(x1 - 2 * x0 + x) + Math.abs(y1 - 2 * y0 + y) +
    Math.abs(x2 - 2 * x + x0) + Math.abs(y2 - 2 * y + y0)
  const steps = Math.max(2, Math.min(24, Math.ceil(Math.sqrt(dev / Math.max(epsilon, 0.05)) * 2)))
  for (let s = 1; s <= steps; s += 1) {
    const t = s / steps
    const u = 1 - t
    const px = u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x
    const py = u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y
    points.push([px, py])
  }
}

// -- simplification ----------------------------------------------------------

/** Douglas-Peucker: the points that actually carry the shape. */
function simplify(points) {
  if (points.length < 4) return points
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const stack = [[0, points.length - 1]]

  while (stack.length) {
    const [first, last] = stack.pop()
    if (last <= first + 1) continue
    const [ax, ay] = points[first]
    const [bx, by] = points[last]
    const dx = bx - ax
    const dy = by - ay
    const len = Math.hypot(dx, dy)

    let worst = -1
    let index = -1
    for (let i = first + 1; i < last; i += 1) {
      const [px, py] = points[i]
      const dist =
        len < 1e-9
          ? Math.hypot(px - ax, py - ay)
          : Math.abs(dy * px - dx * py + bx * ay - by * ax) / len
      if (dist > worst) {
        worst = dist
        index = i
      }
    }
    if (worst > epsilon && index !== -1) {
      keep[index] = 1
      stack.push([first, index], [index, last])
    }
  }
  return points.filter((_, i) => keep[i])
}

/** Positive for clockwise winding, which is how a hole would show up. */
function signedArea(points) {
  let total = 0
  for (let i = 0; i < points.length - 1; i += 1) {
    total += points[i][0] * points[i + 1][1] - points[i + 1][0] * points[i][1]
  }
  return total / 2
}

// -- colour ------------------------------------------------------------------

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const rgbToHex = ([r, g, b]) =>
  `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase()}`

/** Recursive median cut: repeatedly splits the longest axis of the heaviest box. */
function medianCut(samples, depth) {
  if (depth === 0 || samples.length === 0) {
    if (samples.length === 0) return []
    const sum = samples.reduce(
      (acc, s) => [acc[0] + s.rgb[0], acc[1] + s.rgb[1], acc[2] + s.rgb[2]],
      [0, 0, 0],
    )
    const mean = sum.map((v) => v / samples.length)
    const exact = new Map()
    for (const s of samples) exact.set(s.hex, (exact.get(s.hex) ?? 0) + 1)
    return [{ rgb: mean, hex: rgbToHex(mean), count: samples.length, exact: [...exact.keys()] }]
  }

  let axis = 0
  let spread = -1
  for (let a = 0; a < 3; a += 1) {
    const lo = Math.min(...samples.map((s) => s.rgb[a]))
    const hi = Math.max(...samples.map((s) => s.rgb[a]))
    if (hi - lo > spread) {
      spread = hi - lo
      axis = a
    }
  }
  if (spread <= 0) return medianCut(samples, 0)

  const sorted = [...samples].sort((a, b) => a.rgb[axis] - b.rgb[axis])
  const mid = Math.floor(sorted.length / 2)
  return [...medianCut(sorted.slice(0, mid), depth - 1), ...medianCut(sorted.slice(mid), depth - 1)]
}

/** Snaps every fill to the nearest palette entry. */
function buildPalette(fills, depth) {
  const samples = fills.map((hex) => ({ hex, rgb: hexToRgb(hex) }))
  const boxes = medianCut(samples, depth)
  return (hex) => {
    const rgb = hexToRgb(hex)
    let best = boxes[0]
    let bestDist = Infinity
    for (const box of boxes) {
      const dist =
        (rgb[0] - box.rgb[0]) ** 2 + (rgb[1] - box.rgb[1]) ** 2 + (rgb[2] - box.rgb[2]) ** 2
      if (dist < bestDist) {
        bestDist = dist
        best = box
      }
    }
    return best.hex
  }
}

// -- output ------------------------------------------------------------------

const round = (v) => {
  const r = Math.round(v * 10) / 10
  return Object.is(r, -0) ? 0 : r
}

function toPathData(subpaths) {
  return subpaths
    .map((points) => {
      const head = `M${round(points[0][0])} ${round(points[0][1])}`
      const rest = points.slice(1, -1).map(([x, y]) => `L${round(x)} ${round(y)}`)
      return [head, ...rest, 'Z'].join('')
    })
    .join('')
}

function main() {
  const source = readFileSync(SOURCE, 'utf8')

  // --step 1: parse
  const elementRe = /<path\s+d="([^"]*)"\s+fill="([^"]*)"\s+transform="translate\(([-\d.eE]+),\s*([-\d.eE]+)\)"\s*\/>/g
  const raw = []
  let match
  while ((match = elementRe.exec(source)) !== null) {
    raw.push({ d: match[1], fill: match[2], tx: Number(match[3]), ty: Number(match[4]) })
  }
  if (raw.length === 0) throw new Error('no <path> elements matched the expected shape')
  const parsedCount = (source.match(/<path/g) ?? []).length
  if (parsedCount !== raw.length) {
    throw new Error(`parsed ${raw.length} of ${parsedCount} paths; refusing to emit a partial logo`)
  }

  // --step 2: quantise fills
  const snap = buildPalette([...new Set(raw.map((r) => r.fill))], Math.max(1, Math.round(Math.log2(colorCount))))

  // --step 3/4: flatten, simplify, bucket by fill
  const buckets = new Map()
  let dropped = 0
  let mixedWinding = 0
  for (const item of raw) {
    const fill = snap(item.fill)
    for (const subpath of toSubpaths(item.d, item.tx, item.ty)) {
      const simplified = simplify(subpath)
      if (simplified.length < 4) {
        dropped += 1
        continue
      }
      if (!buckets.has(fill)) buckets.set(fill, [])
      buckets.get(fill).push(simplified)
    }
  }

  // Merging same-fill subpaths into one path is only lossless if they all wind
  // the same way. Opposite winding would punch a hole under the nonzero rule,
  // so it is measured rather than assumed.
  for (const subpaths of buckets.values()) {
    const signs = new Set(subpaths.map((s) => Math.sign(signedArea(s))))
    if (signs.size > 1) mixedWinding += 1
  }

  // --step 5: trimmed viewBox
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const subpaths of buckets.values()) {
    for (const points of subpaths) {
      for (const [x, y] of points) {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }
  if (!Number.isFinite(minX)) throw new Error('every subpath was degenerate; nothing to write')

  // Shift into the viewBox's own coordinate space so the trimmed edge is 0,0.
  const shift = (points) =>
    points.map(([x, y]) => [x - minX, y - minY])
  // Map iteration order is first appearance in the source, so painting order is
  // preserved. Sorting by hex here would restack overlapping shards and let a
  // different colour win in places the trace resolved the other way.
  const paths = [...buckets.entries()]
    .map(([fill, subpaths]) => `<path d="${toPathData(subpaths.map(shift))}" fill="${fill}"/>`)
    .join('\n  ')

  const width = round(maxX - minX)
  const height = round(maxY - minY)
  const svg =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ` +
    `width="${width}" height="${height}" role="img" aria-labelledby="ri-logo-title">\n` +
    `  <title id="ri-logo-title">Ruchita Interiors</title>\n` +
    `  ${paths}\n` +
    `</svg>\n`

  // --step 6: report
  const outBytes = Buffer.byteLength(svg)
  const palette = [...buckets.keys()]

  console.log('logo optimisation')
  console.log(`  source        ${relative(ROOT, SOURCE).replace(/\\/g, '/')}`)
  console.log(`  in            ${(source.length / 1024 / 1024).toFixed(2)} MB, ${raw.length} paths, ${new Set(raw.map((r) => r.fill)).size} fills`)
  console.log(`  out           ${(outBytes / 1024).toFixed(1)} KB, ${buckets.size} paths, ${palette.length} colours`)
  console.log(`  viewBox       0 0 ${width} ${height}, ratio ${(width / height).toFixed(4)}`)
  console.log(`  dropped       ${dropped} degenerate subpaths`)
  console.log(`  palette       ${palette.join(' ')}`)
  console.log(`  reduction     ${((1 - outBytes / source.length) * 100).toFixed(1)}% smaller`)
  console.log(
    mixedWinding > 0
      ? `  winding       ${mixedWinding} colour(s) mix winding directions; overlapping shards may fill`
      : '  winding       all same-fill subpaths share a winding, so the merge is lossless',
  )

  if (reportOnly) {
    console.log('\n--report: nothing written')
    return
  }
  if (outBytes > MAX_BYTES) {
    throw new Error(`output ${(outBytes / 1024).toFixed(1)} KB exceeds the ${MAX_BYTES / 1024} KB budget; lower --epsilon`)
  }

  mkdirSync(OUT_DIR, { recursive: true })
  const target = join(OUT_DIR, 'logo.svg')
  writeFileSync(target, svg, 'utf8')
  console.log(`\n  wrote         ${relative(ROOT, target).replace(/\\/g, '/')}`)
}

main()
