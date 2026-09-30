/**
 * Ruchita Interiors — Python interpreter discovery.
 *
 * Shared by the root dev and test scripts so both agree on which interpreter
 * runs the backend. Order:
 *
 *   1. Ruchita_PYTHON   explicit override
 *   2. venv              root project virtual environment
 *   3. backend/venv      legacy per-backend virtual environment
 *   4. python3 / python on PATH
 *
 * @returns {{ command: string, label: string } | null}
 */

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/** @param {string[]} segments */
function venvPython(...segments) {
  const root = join(here, '..', ...segments)
  return process.platform === 'win32' ? join(root, 'Scripts', 'python.exe') : join(root, 'bin', 'python')
}

const CANDIDATES = [
  { command: process.env.Ruchita_PYTHON, label: 'Ruchita_PYTHON' },
  { command: venvPython('venv'), label: 'venv' },
  { command: venvPython('backend', 'venv'), label: 'backend/venv' },
  { command: process.platform === 'win32' ? 'python' : 'python3', label: 'PATH' },
].filter((candidate) => candidate.command)

export function resolvePython() {
  return CANDIDATES.find((candidate) => (candidate.label === 'PATH' ? true : existsSync(candidate.command))) ?? null
}

export const SETUP_HINT = [
  'No Python interpreter found. Create one with:',
  '  python -m venv venv',
  '  venv/Scripts/pip install -r backend/requirements.txt -r backend/requirements-dev.txt   (Windows)',
  '  venv/bin/pip install -r backend/requirements.txt -r backend/requirements-dev.txt       (macOS/Linux)',
].join('\n')
