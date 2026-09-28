/**
 * Ruchita Interiors — backend test runner.
 *
 * Used by the root `npm test` so the same interpreter discovery serves dev and
 * tests on Windows, macOS and Linux alike.
 */

import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolvePython, SETUP_HINT } from './python.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const backend = join(here, '..', 'backend')

const python = resolvePython()
if (!python) {
  console.error(SETUP_HINT)
  process.exit(1)
}

const child = spawn(python.command, ['-m', 'pytest', 'tests', '-q'], {
  cwd: backend,
  stdio: 'inherit',
  shell: false,
})

child.on('error', (error) => {
  console.error(`[api tests] failed to start: ${error.message}`)
  process.exit(1)
})

child.on('exit', (code) => process.exit(code ?? 0))
