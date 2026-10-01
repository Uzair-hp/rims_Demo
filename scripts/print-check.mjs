/**
 * Print-check harness: render the two A4 documents with a real layout engine.
 *

jsdom has no layout, so it cannot answer the only question that matters about a
print stylesheet: how tall is the payment block, and does the page still fit. This
harness reads the *actual* production CSS bundle, builds markup using the real
hashed class names, and drives headless Chrome through the real print path.

Run from the repository root, after `npm run build`:
    node scripts/print-check.mjs

Writes print-check/invoice.pdf and print-check/balance.pdf.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'frontend', 'dist')
const out = join(root, 'print-check')
mkdirSync(out, { recursive: true })

const chrome = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

/**
 * The main stylesheet, not just any stylesheet.
 *
 * `dist/assets` also holds a lazily-loaded chunk (`DashboardCharts-*.css`), and
 * picking the first `.css` picks that one - 1.6 KB of chart styles containing none
 * of the document classes. Selecting the entry bundle explicitly, and asserting it
 * actually contains the document sheet, is what makes a missing class fail loudly
 * instead of silently measuring an unstyled element.
 */
const cssFile = readdirSync(join(dist, 'assets')).find((f) => /^index-[^/]+\.css$/.test(f))
if (!cssFile) throw new Error('No built entry stylesheet found. Run `npm run build` first.')
const css = readFileSync(join(dist, 'assets', cssFile), 'utf8')
if (!css.includes('_paper_')) {
  throw new Error(`${cssFile} does not look like the main stylesheet (no ._paper_ class).`)
}

/**
 * Look a class up in the built bundle by pattern.
 *
 * Resolved from the CSS rather than hand-written, so this cannot silently drift
 * from what ships: rename a class in the component and the lookup fails loudly here
 * instead of quietly measuring an unstyled element.
 */
function cls(name, label) {
  // The *whole* hashed token, numeric suffix included. CSS Modules disambiguates
  // colliding names with a trailing index - `._paymentRows_9zvkr_460`, not
  // `._paymentRows_9zvkr` - so emitting the bare name produces a class attribute
  // that matches nothing and the page renders unstyled. That produced a convincing
  // 89mm payment block and a false "sheet overflows" verdict before this was fixed.
  //
  // `module` pins which stylesheet the class belongs to, because this feature has
  // three `.blockLabel`s and two `.paper`s and resolving to the wrong one would
  // measure the wrong sheet.
  const module = MODULES[label]
  if (!module) throw new Error(`No module pinned for class ${name} (${label})`)
  const pattern = new RegExp(`\\.${name}_${module}_\\d+`)
  const match = pattern.exec(css)
  if (!match) throw new Error(`No class .${name}_${module}_NNN in the built CSS (${label})`)
  // Strip the leading dot. In the stylesheet `._paymentRow_9zvkr_460` is the
  // selector (dot + class name), but in `class="..."` the class name is
  // `_paymentRow_9zvkr_460` with no dot. Returning `match[0]` verbatim put
  // `._paymentRow_9zvkr_460` into the attribute, so the class name gained a leading
  // dot, matched nothing, and every measurement below was of unstyled markup - which
  // is how an 89mm payment block and a false "sheet overflows" verdict appeared.
  return match[0].slice(1)
}

/**
 * Class name -> owning CSS Module, so `cls` resolves the right one.
 *
 * The *value* is an anchor class unique to that module, not a hard-coded hash. A
 * hash is derived by vite from the file's contents, so it changes the moment an
 * unrelated rule in that file is edited - pinning one meant this harness broke on
 * any change to a stylesheet it only reads, which is a harness that trains you to
 * ignore its failures.
 *
 * Each anchor below is verified to be unique to one module, which is what actually
 * disambiguates: `.paper` and `.blockLabel` each exist in two modules.
 *
 * The anchors were re-picked when the payment block became a shared component: the
 * old ones (`_paymentQr`, `_qrCard`) belonged to rules that no longer exist, and an
 * anchor pointing at a deleted class fails the whole run loudly rather than measuring
 * the wrong thing quietly.
 */
const MODULE_ANCHORS = {
  doc: '_colEmpty', // only DocumentPaper marks the empty category cell
  due: '_paidStamp', // only PaymentDuePaper renders the settled stamp
  card: '_qrColumn', // only UpiQrCard has a QR column
  pay: '_scanLabel', // only PaymentDetailsCard labels the code "Scan to Pay"
}

/** The CSS Modules hash for the module that owns `anchor`, resolved from the bundle. */
function moduleHash(anchor) {
  const found = new Set(
    [...css.matchAll(new RegExp(`\\.${anchor}_([a-z0-9]+)_\\d+`, 'g'))].map((m) => m[1]),
  )
  if (found.size !== 1) {
    throw new Error(
      `Anchor class .${anchor} must be unique to one module, found: ${[...found].join(', ')}`,
    )
  }
  return [...found][0]
}

const MODULES = Object.fromEntries(
  Object.entries(MODULE_ANCHORS).map(([key, anchor]) => [key, moduleHash(anchor)]),
)

const C = {
  // Resolved within a single module rather than matched loosely. Two of the modules
  // here define a `.blockLabel` and a `.paper`, and `InvoiceDetailPage` also
  // has a `.paymentRow` - so an unpinned `[a-z0-9]+` pattern can resolve to the wrong
  // sheet and quietly measure the wrong thing.
  paper: cls('_paper', 'doc'),
  payment: cls('_payment', 'doc'),
  blockLabel: cls('_blockLabel', 'doc'),
  duePaper: cls('_paper', 'due'),
  summary: cls('_summary', 'due'),
  summaryRow: cls('_summaryRow', 'due'),
  paidStamp: cls('_paidStamp', 'due'),
  // The shared Payment Details card, printed once per document on both sheets.
  paymentCard: cls('_card', 'pay'),
  payHeader: cls('_header', 'pay'),
  payBody: cls('_body', 'pay'),
  payDetails: cls('_details', 'pay'),
  payTile: cls('_tile', 'pay'),
  payRows: cls('_rows', 'pay'),
  payRow: cls('_row', 'pay'),
  payHint: cls('_hint', 'pay'),
  card: cls('_card', 'card'),
  body: cls('_body', 'card'),
  qrColumn: cls('_qrColumn', 'card'),
  qr: cls('_qr', 'card'),
  detailsTile: cls('_details', 'card'),
  amount: cls('_amount', 'card'),
  note: cls('_note', 'card'),
  payHeading: cls('_heading', 'pay'),
  payScan: cls('_scanLabel', 'pay'),
}

/** A QR as a real <img> at true physical size, so the browser lays it out. */
const QR_SRC =
  'data:image/svg+xml,' +
  encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' width='98' height='98'><rect width='98' height='98' fill='#fff'/>" +
      '<rect x="4" y="4" width="24" height="24" fill="#1d1b16"/><rect x="34" y="4" width="24" height="24" fill="#1d1b16"/>' +
      '<rect x="64" y="4" width="24" height="24" fill="#1d1b16"/><rect x="4" y="34" width="24" height="24" fill="#1d1b16"/>' +
      '<rect x="64" y="34" width="24" height="24" fill="#1d1b16"/><rect x="4" y="64" width="24" height="24" fill="#1d1b16"/>' +
      '<rect x="34" y="64" width="24" height="24" fill="#1d1b16"/><rect x="64" y="64" width="24" height="24" fill="#1d1b16"/></svg>',
  )

const inr = (paise) =>
  '\u20b9' +
  (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const style = (extra = '') =>
  `<style>${css}</style><style>body{margin:0;background:#f1efe9}${extra}</style>`

/** The compact QR tile, as `variant="tile"` renders it. */
const upiTile = (amountPaise, note) => `
<section class="${C.card}" data-variant="tile" data-upi-qr>
  <div class="${C.body}">
    <div class="${C.qrColumn}">
      <img class="${C.qr}" src="${QR_SRC}" alt="UPI QR code to pay ${inr(amountPaise)}">
    </div>
    <div class="${C.detailsTile}">
      <p class="${C.amount}">${inr(amountPaise)}</p>
      <p class="${C.note}">Ref ${note}</p>
    </div>
  </div>
</section>`

/**
 * The shared Payment Details card, in the layout both documents print.
 *
 * `withQr` is what distinguishes the four FR-P8 invoice presentations and the two
 * Balance Bill states, so each is rendered rather than inferred.
 */
const paymentCard = ({ withQr, withBank, withUpiRow = true, hint = '' }) => `
<section class="${C.paymentCard}" data-payment-card>
  <div class="${C.payHeader}">
    <p class="${C.payHeading}"><span>Payment Details</span></p>
    ${withQr ? `<p class="${C.payScan}"><span>Scan to Pay</span></p>` : ''}
  </div>
  <div class="${C.payBody}">
    <div class="${C.payDetails}">
      ${withBank ? `<dl class="${C.payRows}">${[
        ['Account Name', 'Ruchita Interiors LLP'],
        ['Account Number', '00123456789'],
        ['Bank', 'HDFC Bank'],
        ['Branch', 'Vijay Nagar'],
        ['IFSC', 'HDFC0001234'],
      ]
        .map(
          ([label, value]) =>
            `<div class="${C.payRow}"><dt>${label}</dt><dd>${value}</dd></div>`,
        )
        .join('')}</dl>` : ''}
      ${withUpiRow ? `<div class="${C.payRow}"><dt>UPI ID</dt><dd>ruchitainteriors@upi</dd></div>` : ''}
      ${hint ? `<p class="${C.payHint}">${hint}</p>` : ''}
    </div>
    ${withQr ? `<div class="${C.payTile}">${upiTile(5000000, 'INV-2026-0001')}</div>` : ''}
  </div>
</section>`

const itemRows = [
  'Modular base cabinet',
  'Wardrobe carcass',
  'Quartz countertop',
  'Handles and hardware',
  'Site preparation',
]
  .map(
    (name, i) =>
      `<tr><td style="padding:2mm 1mm;border-block-end:1px solid #f1efe9">${name}</td>` +
      `<td style="text-align:right;padding:2mm 1mm;border-block-end:1px solid #f1efe9">${i + 1}.000</td>` +
      `<td style="text-align:right;padding:2mm 1mm;border-block-end:1px solid #f1efe9">${inr(4000000 + i * 500000)}</td>` +
      `<td style="text-align:right;padding:2mm 1mm;border-block-end:1px solid #f1efe9">${inr(4000000 + i * 500000)}</td></tr>`,
  )
  .join('')

const header = `
<header style="display:flex;justify-content:space-between;padding-block-end:3mm;border-block-end:.6mm solid #c9a24b">
  <div><p style="margin:0;font-size:18pt;font-weight:600">Ruchita Interiors</p></div>
  <div style="text-align:end;font-size:8pt;color:#5a564c">
    <p style="margin:0">14, Rose Villa, Indore, Madhya Pradesh 452001</p>
    <p style="margin:0">+91 98765 43210</p>
  </div>
</header>`

const terms = `
<section style="margin-block-start:5mm;padding-block-start:3mm;border-block-start:1px solid #e4e0d5">
  <h2 class="${C.blockLabel}">Terms &amp; Conditions</h2>
  <ol style="margin:0;padding-inline-start:4mm;font-size:8.5pt;color:#1d1b16;line-height:1.5">
    <li>50% advance is required to begin work.</li>
    <li>Prices are valid for the stated validity period.</li>
    <li>Delivery timelines start from advance receipt and material confirmation.</li>
    <li>Any design change after approval may affect cost and schedule.</li>
    <li>Warranty covers workmanship as agreed in the work order.</li>
  </ol>
</section>
<footer style="margin-block-start:5mm;padding-block-start:3mm;border-block-start:1px solid #e4e0d5;font-size:8pt;color:#8a8578">
  <p style="margin:0">Ruchita Interiors</p>
  <p style="margin:0">Modular Kitchen &middot; Wardrobes &middot; Turnkey Interiors</p>
</footer>`

/**
 * The four FR-P8 presentations of the invoice's payment block, as separate strings
 * so each can be measured rather than reasoned about.
 *
 * The QR encodes the grand total (50000.00), never the outstanding balance: the
 * invoice's figure has to be the one printed on its own sheet, or a reprint would
 * ask for a different sum.
 */
const paymentSection = (inner) => `
  <section class="${C.payment}" data-document-payment>${inner}</section>`

/** `payment_method = NULL` — both electronic rails, the tallest of the four. */
const invoicePayment = paymentSection(
  paymentCard({
    withQr: true,
    withBank: true,
    hint: 'Please verify the amount before paying, and quote INV-2026-0001.',
  }),
)

/** `payment_method = 'upi'` — the code and the UPI ID, and no bank details at all. */
const invoicePaymentUpi = paymentSection(
  paymentCard({
    withQr: true,
    withBank: false,
    hint: 'Please verify the amount before paying, and quote INV-2026-0001.',
  }),
)

/** `payment_method = 'bank_transfer'` — rows only, so they get the full width. */
const invoicePaymentBank = paymentSection(paymentCard({ withQr: false, withBank: true }))

/** `payment_method = 'cash'` — the method line is the whole instruction. */
const invoicePaymentCash = paymentSection(
  `<section class="${C.paymentCard}" data-payment-card>
     <div class="${C.payHeader}"><p class="${C.payHeading}"><span>Payment Details</span></p></div>
     <div class="${C.payBody}"><div class="${C.payDetails}">
       <p style="margin:0 0 1.5mm;font-size:9pt"><strong>Payment Method: Cash</strong></p>
     </div></div>
   </section>`,
)

/**
 * The invoice, in the `payment_method = NULL` presentation (FR-P8): both electronic
 * rails, so the QR sits *beside* the bank rows.
 */
const invoiceHtml = `<!doctype html><html><head><meta charset="utf-8">
<title>Invoice print check</title>${style()}</head><body>
<article class="${C.paper}" data-document-paper aria-label="Invoice document">
  ${header}
  <div style="display:flex;align-items:flex-end;justify-content:space-between;padding-block:4mm">
    <div style="font-size:9.5pt">
      <p style="margin:0">Issue date&nbsp;&nbsp;29 Sep 2026</p>
      <p style="margin:0">Due date&nbsp;&nbsp;&nbsp;&nbsp;29 Oct 2026</p>
    </div>
    <div style="text-align:end">
      <h1 style="margin:0;font-size:16pt;text-transform:uppercase">Tax Invoice</h1>
      <p style="margin:0;font-size:11pt;font-weight:600">INV-2026-0001</p>
    </div>
  </div>
  <section style="padding-block:3mm;border-block:1px solid #e4e0d5">
    <h2 class="${C.blockLabel}">Bill To</h2>
    <p style="margin:0 0 1mm;font-size:11pt;font-weight:600">Meera Iyer</p>
    <p style="margin:0;font-size:9pt;color:#5a564c">22, Green Meadows, Indore</p>
  </section>
  <table style="width:100%;border-collapse:collapse;margin-block:4mm;font-size:9pt">
    <thead><tr>
      <th style="text-align:left;padding:2mm 1mm;border-block-end:1px solid #e4e0d5">Item &amp; Description</th>
      <th style="text-align:right;padding:2mm 1mm;border-block-end:1px solid #e4e0d5">Qty</th>
      <th style="text-align:right;padding:2mm 1mm;border-block-end:1px solid #e4e0d5">Rate</th>
      <th style="text-align:right;padding:2mm 1mm;border-block-end:1px solid #e4e0d5">Amount</th>
    </tr></thead>
    <tbody>${itemRows}</tbody>
  </table>
  <section style="display:flex;justify-content:flex-end;margin-block:3mm">
    <dl style="width:76mm;margin:0;font-size:9pt">
      <div style="display:flex;justify-content:space-between;padding:1.2mm 0"><dt>Subtotal</dt><dd>${inr(6000000)}</dd></div>
      <div style="display:flex;justify-content:space-between;padding:1.2mm 0"><dt>Discount</dt><dd>&minus;${inr(1000000)}</dd></div>
      <div style="display:flex;justify-content:space-between;margin-block-start:1mm;padding:2mm 2.5mm;background:#f5edda;border-inline-start:.7mm solid #c9a24b">
        <dt style="font-weight:700">Grand Total</dt><dd style="font-weight:700">${inr(5000000)}</dd></div>
    </dl>
  </section>
  ${invoicePayment}
  ${terms}
</article></body></html>`

/**
 * The balance document: the amount-bearing QR, in the shared Payment Details card.
 *
 * Rendered from a function so the outstanding and the settled states are the *same*
 * markup with the card present or absent, which is exactly how the component behaves -
 * there is no second settled layout to keep in step.
 */
const balanceHtml = (settled = false) => `<!doctype html><html><head><meta charset="utf-8">
<title>Payment due print check</title>${style()}</head><body>
<article class="${settled ? C.duePaper + ' ' + cls('_paperSettled', 'due') : C.duePaper}" data-document-paper data-payment-due data-fully-paid="${settled}">
  ${header}
  <div class="${settled ? '' : ''}" style="display:flex;align-items:flex-end;justify-content:space-between;padding-block:4mm">
    <div><h1 style="margin:0;font-size:16pt;text-transform:uppercase">PAYMENT DUE</h1></div>
    <div style="display:flex;flex-direction:column;align-items:flex-end;gap:2mm;text-align:end">
      ${settled ? `<p class="${C.paidStamp}" data-paid-stamp="true">Fully Paid</p>` : ''}
      <p style="margin:0"><span style="display:block;font-size:7.5pt;text-transform:uppercase;color:#8a8578">Reference</span>
      <span style="font-size:11pt;font-weight:600">INV-2026-0001</span></p>
    </div>
  </div>
  <section style="display:grid;grid-template-columns:1fr 1fr;gap:4mm;padding-block:3mm;border-block:1px solid #e4e0d5">
    <div>
      <h2 class="${C.blockLabel}">Bill To</h2>
      <p style="margin:0 0 1mm;font-size:11pt;font-weight:600">Meera Iyer</p>
      <p style="margin:0;font-size:9pt;color:#5a564c">22, Green Meadows, Indore</p>
    </div>
    <div>
      <h2 class="${C.blockLabel}">Project / Site Address</h2>
      <p style="margin:0;font-size:9pt;color:#5a564c">Plot 14, Indore</p>
    </div>
  </section>
  <section class="${C.summary}">
    <h2 class="${C.blockLabel}">Balance Summary</h2>
    <dl style="margin:0;display:flex;flex-direction:column;border-block-end:1px solid #e4e0d5">
      <div class="${C.summaryRow}"><dt style="font-size:9.5pt;color:#5a564c">Original invoice total</dt><dd style="margin:0;font-size:10.5pt">${inr(5000000)}</dd></div>
      <div class="${C.summaryRow}"><dt style="font-size:9.5pt;color:#5a564c">Total received</dt><dd style="margin:0;font-size:10.5pt">${inr(settled ? 5000000 : 2000000)}</dd></div>
      <div class="${C.summaryRow}"><dt style="font-size:9.5pt;color:#5a564c">Outstanding balance</dt><dd style="margin:0;font-size:10.5pt">${inr(settled ? 0 : 3000000)}</dd></div>
      <div class="${C.summaryRow}" style="${settled ? 'margin-block-start:1mm;padding:2mm 2.5mm;background:#e4f3ea;border-inline-start:.7mm solid #177245' : 'margin-block-start:1mm;padding:2mm 2.5mm;background:#f5edda;border-inline-start:.7mm solid #c9a24b'}"><dt style="font-weight:700;color:${settled ? '#177245' : '#6e5620'}">Amount due now</dt><dd style="margin:0;font-size:12pt;font-weight:700;color:${settled ? '#177245' : '#6e5620'}">${inr(settled ? 0 : 3000000)}</dd></div>
    </dl>
  </section>
  ${
    settled
      ? ''
      : `<section data-document-payment>${paymentCard({
          withQr: true,
          withBank: true,
        })}</section>`
  }
  <footer style="margin-block-start:6mm;padding-block-start:3mm;border-block-start:1px solid #e4e0d5;font-size:8pt">
  ${
    settled
      ? '<p style="margin:0 0 2mm;font-size:11pt;font-weight:700;color:#177245">Payment received in full. Thank you.</p>'
      : `<p style="margin:0 0 1.5mm;color:#5a564c">Generated 30 Sep 2026 &middot; Due 29 Oct 2026</p>
         <p style="margin:0 0 2mm;font-size:8pt;line-height:1.45;color:#5a564c">This is a payment reminder for invoice INV-2026-0001, not a new invoice. The balance shown is what the ledger recorded as outstanding when this document was generated.</p>
         <p style="margin:0;font-style:italic;font-weight:600">Verify the amount before paying.</p>`
  }
  </footer>
</article></body></html>`

/**
 * Injected into each page: reports the geometry that jsdom cannot see.
 *
 * `getBoundingClientRect` in real Chrome answers the two questions this feature
 * turns on - is the payment block a sensible height, and does the sheet still fit
 * one A4 page - and whether any interactive chrome survived into the print form.
 */
const PROBE = `<script>
window.addEventListener('load', () => {
  const box = (sel) => document.querySelector(sel);
  const rect = (el) => (el ? el.getBoundingClientRect() : null);
  const paper = box('[data-document-paper]');
  const block = box('[data-payment-card]') || box('[data-document-payment]') || box('[data-upi-qr]');
  const qr = box('[data-upi-qr] img');
  const p = rect(paper);
  const b = rect(block);
  const q = rect(qr);
  const mm = (v) => Math.round((v / 96) * 25.4 * 10) / 10;
  document.title = 'PROBE' + JSON.stringify({
    sheet: p ? mm(p.height) : null,
    block: b ? mm(b.height) : null,
    qr: q ? mm(q.width) : null,
    chrome: !!box('[data-upi-qr] button, [data-upi-qr] a'),
    title: !!box('[data-upi-qr] h3'),
    cards: document.querySelectorAll('[data-payment-card]').length,
    stamps: document.querySelectorAll('[data-paid-stamp]').length,
    // The bank details must appear exactly once per document. A regression that
    // reintroduces a second block prints the account number twice on one page.
    //
    // Scoped to the sheet, not to the whole body: this probe is an inline script
    // inside the body, and its own source text would otherwise be counted as a
    // duplicate of the account number it is looking for.
    bankRepeats: ((paper ? paper.textContent : '').match(/00123456789/g) || []).length,
    fullyPaid: document.querySelector('[data-fully-paid]')?.dataset.fullyPaid ?? null,
  });
});
</script>`

/** Printable A4 height in px: 297mm less the 14mm top and bottom margins. */
const A4_PRINTABLE_MM = 297 - 28

function run(name, html, extraArgs) {
  const file = join(out, `${name}.html`)
  writeFileSync(file, html.replace('</body>', `${PROBE}</body>`), 'utf8')
  execFileSync(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--run-all-compositor-stages-before-draw',
      '--virtual-time-budget=2000',
      ...extraArgs,
      `file:///${file.replace(/\\/g, '/')}`,
    ],
    { stdio: 'pipe', encoding: 'utf8' },
  )
  return file
}

function probe(name, html) {
  const file = run(name, html, [`--no-pdf-header-footer`, `--print-to-pdf=${join(out, `${name}.pdf`)}`])
  const dom = execFileSync(
    chrome,
    ['--headless=new', '--disable-gpu', '--no-sandbox', '--virtual-time-budget=2000', '--dump-dom', `file:///${file.replace(/\\/g, '/')}`],
    { encoding: 'utf8', stdio: 'pipe' },
  )
  const match = /<title>PROBE(\{.*?\})<\/title>/.exec(dom)
  if (!match) throw new Error(`No geometry returned for ${name}`)
  return JSON.parse(match[1])
}

const results = [
  ['invoice', probe('invoice', invoiceHtml)],
  ['balance', probe('balance', balanceHtml(false))],
  // The settled balance sheet: the same document with the payment card absent. It has
  // to be measured too, because dropping the card changes the page height and a
  // regression that re-added it would silently put a live QR under a "fully paid" stamp.
  ['balance-paid', probe('balance-paid', balanceHtml(true))],
  // The other three FR-P8 presentations, checked for the same A4 fit. Only
  // `not-selected` carries both rails and is therefore the tallest, but a
  // `bank_transfer` invoice renders the rows full-width in two columns where
  // `not-selected` renders them in one beside a code, so the wrap behaviour differs
  // and is worth measuring rather than inferring.
  ['invoice-upi', probe('invoice-upi', invoiceHtml.replace(invoicePayment, invoicePaymentUpi))],
  ['invoice-bank', probe('invoice-bank', invoiceHtml.replace(invoicePayment, invoicePaymentBank))],
  ['invoice-cash', probe('invoice-cash', invoiceHtml.replace(invoicePayment, invoicePaymentCash))],
]

console.log('Rendered with the real production CSS bundle through Chrome.\n')
for (const [name, r] of results) {
  const fits = r.sheet !== null && r.sheet <= A4_PRINTABLE_MM
  console.log(`print-check/${name}.pdf`)
  console.log(`  sheet height      ${r.sheet}mm   (A4 printable ${A4_PRINTABLE_MM}mm)  ${fits ? 'FITS' : 'OVERFLOWS'}`)
  console.log(`  payment card      ${r.block}mm   (cards rendered: ${r.cards})`)
  if (r.qr !== null) console.log(`  QR                ${r.qr}mm square`)
  if (r.qr !== null) console.log(`  print chrome      buttons=${r.chrome} heading=${r.title}  (both must be false)`)
  console.log(`  account number    printed ${r.bankRepeats}x  (must be 0 or 1)`)
  if (r.fullyPaid) console.log(`  settled           ${r.fullyPaid === 'true'}  stamps=${r.stamps}`)
  console.log()
}

// Fail the run on the regressions this harness exists to prevent.
const problems = []
for (const [name, r] of results) {
  if (r.sheet !== null && r.sheet > A4_PRINTABLE_MM) problems.push(`${name}: sheet is ${r.sheet}mm, over the ${A4_PRINTABLE_MM}mm printable height`)
  if (r.qr !== null && (r.chrome || r.title)) problems.push(`${name}: screen chrome leaked into the print form`)
  if (r.qr !== null && r.qr < 20) problems.push(`${name}: QR is ${r.qr}mm, below the ~20mm scannable floor`)
  if (r.bankRepeats > 1) problems.push(`${name}: account number printed ${r.bankRepeats}x — bank details are duplicated`)
  if (r.cards > 1) problems.push(`${name}: ${r.cards} payment cards rendered — bank details must appear once`)
}

// The settled sheet carries no payment card and no code at all, and says so on paper.
const paid = results.find(([name]) => name === 'balance-paid')[1]
if (paid.qr !== null) problems.push('balance-paid: a settled sheet must carry no QR')
if (paid.cards !== 0) problems.push('balance-paid: a settled sheet must carry no payment card')
if (paid.stamps !== 1) problems.push('balance-paid: the settled sheet must be stamped exactly once')

if (problems.length) {
  console.error('Print check FAILED:')
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log('Print check passed.')
