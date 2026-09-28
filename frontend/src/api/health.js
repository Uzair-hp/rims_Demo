import { get } from './client.js'

/**
 * Backend liveness probe.
 *
 * `/health` is the one endpoint that needs no session (PLAN §9.2), which is why
 * the app shell can use it to report API reachability before login exists.
 *
 * @param {{ signal?: AbortSignal }} [options]
 */
export function fetchHealth(options) {
  return get('/health', options)
}
