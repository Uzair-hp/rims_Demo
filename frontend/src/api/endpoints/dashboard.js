/**
 * Ruchita Interiors — dashboard API call (§9.2).
 *
 * One function, because there is one request (§9.2: "one request, one query
 * set"). The Dashboard renders metric cards, two charts and three recent lists
 * from this single response.
 *
 * The alternative — calling the quotations, invoices, clients and payments
 * endpoints and totalling the results in the browser — was explicitly rejected:
 * it would make the client a second implementation of the money rules, which is
 * the one thing §11's "computed, never stored" exists to prevent. Every figure
 * here arrives already computed, in paise, by `services/dashboard.py`.
 */

import { get } from '../client.js'

/** GET /dashboard/summary — the whole Dashboard payload. */
export const fetchDashboardSummary = () => get('/dashboard/summary').then((body) => body.data)
