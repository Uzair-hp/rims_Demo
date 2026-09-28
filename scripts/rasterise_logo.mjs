/**
 * Rasterise an SVG to a PNG.
 *
 * Used by generate_brand_icons.py. Kept as a file rather than inlined into
 * `node -e` because the command would have to embed two Windows paths and a
 * nested options object, which is both hard to read and easy to break with
 * quoting.
 *
 * Usage: node scripts/rasterise_logo.mjs <input.svg> <output.png> <targetWidth>
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { Resvg } from '@resvg/resvg-js'

const [, , input, output, targetWidth] = process.argv

if (!input || !output || !targetWidth) {
  console.error('usage: node scripts/rasterise_logo.mjs <input.svg> <output.png> <width>')
  process.exit(1)
}

const svg = readFileSync(input, 'utf8')

// resvg is a prebuilt binary, so this needs no native cairo library the way
// cairosvg does - which is the reason the Python side shells out to Node here.
const resvg = new Resvg(svg, {
  fitTo: { mode: 'width', value: Number(targetWidth) },
})
const png = resvg.render().asPng()
writeFileSync(output, png)

console.log(`  rasterised ${input} -> ${output} at ${targetWidth}px wide (${(png.length / 1024).toFixed(1)} KB)`)
