/**
 * Ruchita Interiors — backend launcher.
 *
 * Started by the root `npm run dev` (via concurrently) so a fresh clone needs one
 * command. See `python.mjs` for interpreter discovery and setup instructions.
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

console.log(`[api] using ${python.label}: ${python.command}`)

const child = spawn(python.command, ['run.py'], { cwd: backend, stdio: 'inherit', shell: false })

child.on('error', (error) => {
  console.error(`[api] failed to start: ${error.message}`)
  process.exit(1)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}

child.on('exit', (code) => process.exit(code ?? 0))
