/**
 * Ruchita Interiors — Python interpreter discovery.
 *
 * Shared by the root dev and test scripts so both agree on which interpreter
 * runs the backend. Order:
 *
 *   1. Ruchita_PYTHON   explicit override
 *   2. backend/venv     per-project virtual environment
 *   3. python3 / python on PATH
 *
 * @returns {{ command: string, label: string } | null}
 */

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const venvPython =
  process.platform === 'win32'
    ? join(here, '..', 'backend', 'venv', 'Scripts', 'python.exe')
    : join(here, '..', 'backend', 'venv', 'bin', 'python')

const CANDIDATES = [
  { command: process.env.Ruchita_PYTHON, label: 'Ruchita_PYTHON' },
  { command: venvPython, label: 'backend/venv' },
  { command: process.platform === 'win32' ? 'python' : 'python3', label: 'PATH' },
].filter((candidate) => candidate.command)

export function resolvePython() {
  return CANDIDATES.find((candidate) => (candidate.label === 'PATH' ? true : existsSync(candidate.command))) ?? null
}

export const SETUP_HINT = [
  'No Python interpreter found. Create one with:',
  '  python -m venv backend/venv',
  '  backend/venv/Scripts/pip install -r backend/requirements.txt   (Windows)',
  '  backend/venv/bin/pip install -r backend/requirements.txt       (macOS/Linux)',
].join('\n')
