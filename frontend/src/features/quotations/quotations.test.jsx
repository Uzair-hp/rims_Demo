/**
 * Ruchita Interiors — quotation feature unit tests (§10, §15).
 *
 * Covers the display-only calculation mirror and the form validator. These
 * mirror the backend calculation/validation suites; the server stays the
 * authority, but the editor's live preview and inline errors rely on these.
 */

import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  calcDiscount,
  calcGst,
  calcLineTotal,
  calcTotals,
  milliToInput,
  unitsToMilli,
} from '../../lib/calc.js'
import { isValidLine, validateItem, validateQuotation } from '../../lib/validation.js'
import { paiseToInput, rupeesToPaise } from '../../lib/money.js'
import { statusLabel, STATUS_OPTIONS, ACTION_META } from './status.js'
import { PAGE_SIZE } from './useQuotations.js'
import { buildQuotationListQuery } from '../../api/endpoints/quotations.js'
import ItemsEditor, { itemFromService, newItem } from './ItemsEditor.jsx'
import { buildPayload, fromQuotation, pickDefaultTerms } from './QuotationEditor.jsx'

describe('calcLineTotal', () => {
  it('computes qty × rate / 1000 with half-up rounding', () => {
    expect(calcLineTotal(1000, 10000)).toBe(10000) // 1 unit × ₹100
    expect(calcLineTotal(1500, 10000)).toBe(15000) // 1.5 × ₹100
    expect(calcLineTotal(0, 10000)).toBe(0)
  })

  it('rounds half up on fractional paise', () => {
    // qty×rate / 1000: 500/1000 = 0.5 → 1 (half-up)
    expect(calcLineTotal(1, 500)).toBe(1)
    // 499/1000 = 0.499 → 0
    expect(calcLineTotal(1, 499)).toBe(0)
  })

  it('stays exact for very large qty × rate', () => {
    // Above Number.MAX_SAFE_INTEGER for the intermediate product.
    expect(calcLineTotal(1_000_000_000, 1_000_000)).toBe(1_000_000_000_000)
  })
})

describe('calcDiscount', () => {
  it('applies a percentage in basis points', () => {
    expect(calcDiscount(100000, 'percent', 1000, 0)).toBe(10000) // 10%
  })

  it('clamps a fixed discount to the subtotal', () => {
    expect(calcDiscount(5000, 'fixed', 0, 9999)).toBe(5000)
    expect(calcDiscount(9999, 'fixed', 0, 5000)).toBe(5000)
  })
})

describe('calcGst', () => {
  it('applies gst in basis points', () => {
    expect(calcGst(100000, 1800)).toBe(18000) // 18%
  })

  it('caps at the 28% ceiling', () => {
    expect(calcGst(100000, 5000)).toBe(28000)
  })
})

describe('calcTotals', () => {
  it('rolls subtotal → discount → taxable → gst → grand total', () => {
    const totals = calcTotals({
      items: [
        { qty_milli: 1000, rate_paise: 100000 }, // ₹1000
        { qty_milli: 2000, rate_paise: 50000 }, // ₹1000
      ],
      discountType: 'percent',
      discountBp: 1000, // 10%
      gstBp: 1800, // 18%
      otherChargesPaise: 5000, // ₹50
    })
    expect(totals.subtotalPaise).toBe(200000)
    expect(totals.discountPaise).toBe(20000)
    expect(totals.taxablePaise).toBe(180000)
    expect(totals.gstPaise).toBe(32400)
    expect(totals.grandTotalPaise).toBe(180000 + 32400 + 5000)
  })

  it('handles an empty item list', () => {
    const totals = calcTotals({ items: [] })
    expect(totals.subtotalPaise).toBe(0)
    expect(totals.grandTotalPaise).toBe(0)
  })
})

describe('unitsToMilli / milliToInput', () => {
  it('round-trips natural units', () => {
    expect(unitsToMilli('1.5')).toBe(1500)
    expect(unitsToMilli('2')).toBe(2000)
    expect(unitsToMilli('')).toBe(0)
    expect(milliToInput(1500)).toBe('1.5')
    expect(milliToInput(2000)).toBe('2')
    expect(milliToInput(0)).toBe('')
  })
})

describe('rupeesToPaise / paiseToInput', () => {
  it('converts rupees to paise and back', () => {
    expect(rupeesToPaise('100')).toBe(10000)
    expect(rupeesToPaise('100.50')).toBe(10050)
    expect(rupeesToPaise('')).toBe(0)
    expect(paiseToInput(10050)).toBe('100.50')
    expect(paiseToInput(0)).toBe('')
  })
})

describe('validateItem / isValidLine', () => {
  it('requires a name', () => {
    expect(validateItem({ name: '', qty_milli: 1000, rate_paise: 100 }).name).toBeTruthy()
    expect(validateItem({ name: 'Sofa', qty_milli: 1000, rate_paise: 100 }).name).toBeUndefined()
  })

  it('treats a line as valid only with name, qty and rate', () => {
    expect(isValidLine({ name: 'Sofa', qty_milli: 1000, rate_paise: 100 })).toBe(true)
    expect(isValidLine({ name: 'Sofa', qty_milli: 0, rate_paise: 100 })).toBe(false)
    expect(isValidLine({ name: '', qty_milli: 1000, rate_paise: 100 })).toBe(false)
  })
})

describe('validateQuotation', () => {
  const validForm = {
    client_id: 1,
    quotation_date: '2026-09-29',
    discount_type: 'percent',
    discount_bp: 0,
    gst_bp: 1800,
    other_charges_paise: 0,
    items: [{ name: 'Sofa', qty_milli: 1000, rate_paise: 100000 }],
  }

  it('passes a complete form', () => {
    expect(validateQuotation(validForm).ok).toBe(true)
  })

  it('requires a client', () => {
    const result = validateQuotation({ ...validForm, client_id: null })
    expect(result.ok).toBe(false)
    expect(result.fields.client_id).toBeTruthy()
  })

  it('requires at least one valid line', () => {
    const result = validateQuotation({ ...validForm, items: [{ name: '', qty_milli: 0, rate_paise: 0 }] })
    expect(result.ok).toBe(false)
    expect(result.fields.items).toBeTruthy()
  })

  it('rejects a percentage discount over 100%', () => {
    const result = validateQuotation({ ...validForm, discount_bp: 10001 })
    expect(result.ok).toBe(false)
    expect(result.fields.discount_bp).toBeTruthy()
  })

  it('rejects gst above the 28% ceiling', () => {
    const result = validateQuotation({ ...validForm, gst_bp: 2801 })
    expect(result.ok).toBe(false)
    expect(result.fields.gst_bp).toBeTruthy()
  })
})

describe('status helpers', () => {
  it('labels known statuses and falls back gracefully', () => {
    expect(statusLabel('draft')).toBe('Draft')
    expect(statusLabel('converted')).toBe('Converted')
    expect(statusLabel(undefined)).toBe('Unknown')
  })

  it('exposes an "all statuses" filter option first', () => {
    expect(STATUS_OPTIONS[0].value).toBe('')
  })

  it('has presentation metadata for every lifecycle action', () => {
    for (const key of ['send', 'approve', 'reject', 'reopen', 'duplicate', 'delete', 'create_invoice']) {
      expect(ACTION_META[key]).toBeTruthy()
      expect(ACTION_META[key].label).toBeTruthy()
    }
  })
})

describe('useQuotations', () => {
  it('exports the shared page size', () => {
    expect(PAGE_SIZE).toBe(25)
  })
})

describe('buildQuotationListQuery', () => {
  it('emits only the params that are set, mapping to snake_case', () => {
    const query = buildQuotationListQuery({
      q: 'sofa',
      status: 'sent',
      clientId: 7,
      dateFrom: '2026-01-01',
      dateTo: '2026-02-01',
      minAmount: 10000,
      maxAmount: 500000,
      sort: 'grand_total_paise',
      order: 'asc',
      page: 2,
      pageSize: 25,
    })
    const p = new URLSearchParams(query)
    expect(p.get('q')).toBe('sofa')
    expect(p.get('status')).toBe('sent')
    expect(p.get('client_id')).toBe('7')
    expect(p.get('date_from')).toBe('2026-01-01')
    expect(p.get('date_to')).toBe('2026-02-01')
    expect(p.get('min_amount')).toBe('10000')
    expect(p.get('max_amount')).toBe('500000')
    expect(p.get('sort')).toBe('grand_total_paise')
    expect(p.get('order')).toBe('asc')
    expect(p.get('page')).toBe('2')
    expect(p.get('page_size')).toBe('25')
  })

  it('omits empty, null and undefined params', () => {
    const query = buildQuotationListQuery({ q: '', status: undefined, minAmount: '', maxAmount: null })
    expect(query).toBe('')
  })

  it('keeps a zero minimum amount (valid paise) but drops an empty one', () => {
    expect(new URLSearchParams(buildQuotationListQuery({ minAmount: 0 })).get('min_amount')).toBe('0')
    expect(new URLSearchParams(buildQuotationListQuery({ minAmount: '' })).has('min_amount')).toBe(false)
  })
})

function ItemsHarness({ initial }) {
  const [items, setItems] = useState(initial)
  return <ItemsEditor items={items} onChange={setItems} categories={['Living Room', 'Kitchen']} />
}

describe('ItemsEditor — reorder (FR-Q2)', () => {
  it('moves a line down, preserving its data and array order', async () => {
    const user = userEvent.setup()
    const initial = [
      newItem({ name: 'Sofa', qty_milli: 1000, rate_paise: 100000 }),
      newItem({ name: 'Table', qty_milli: 2000, rate_paise: 50000 }),
    ]
    render(<ItemsHarness initial={initial} />)

    const nameInputs = () => screen.getAllByLabelText(/name$/i).map((el) => el.value)
    expect(nameInputs()).toEqual(['Sofa', 'Table'])

    await user.click(screen.getByLabelText('Move item 1 down'))
    expect(nameInputs()).toEqual(['Table', 'Sofa'])
  })

  it('disables move-up on the first row and move-down on the last', () => {
    render(
      <ItemsHarness initial={[newItem({ name: 'A' }), newItem({ name: 'B' }), newItem({ name: 'C' })]} />,
    )
    expect(screen.getByLabelText('Move item 1 up')).toBeDisabled()
    expect(screen.getByLabelText('Move item 1 down')).not.toBeDisabled()
    expect(screen.getByLabelText('Move item 3 down')).toBeDisabled()
    expect(screen.getByLabelText('Move item 3 up')).not.toBeDisabled()
  })
})

describe('ItemsEditor — per-item category (FR-Q2/Q3)', () => {
  it('edits the category and reports it back on the item', async () => {
    const user = userEvent.setup()
    render(<ItemsHarness initial={[newItem({ name: 'Sofa' })]} />)

    const category = screen.getByLabelText('Item 1 category')
    expect(category.value).toBe('')
    await user.type(category, 'Living Room')
    expect(category.value).toBe('Living Room')
  })

  it('exposes the settings categories as datalist suggestions', () => {
    render(<ItemsHarness initial={[newItem({ name: 'Sofa' })]} />)
    const list = document.getElementById('ri-categories')
    expect(list).toBeTruthy()
    const values = within(list)
      .getAllByRole('option', { hidden: true })
      .map((o) => o.value)
    expect(values).toEqual(['Living Room', 'Kitchen'])
  })

  it('preserves an existing category when the item loads', () => {
    render(<ItemsHarness initial={[newItem({ name: 'Sofa', category: 'Kitchen' })]} />)
    expect(screen.getByLabelText('Item 1 category').value).toBe('Kitchen')
  })
})

/**
 * FR-S4 / §15: a new document starts from the default terms for its scope.
 *
 * This is the rule behind the fix for printed quotations carrying no Terms &
 * Conditions at all — a new quotation used to start with an empty terms field,
 * saved `terms_text: null`, and the document had nothing to render.
 */
describe('pickDefaultTerms', () => {
  const both = { id: 1, scope: 'both', is_default: true, body: 'Shared terms.' }
  const quotationOnly = { id: 2, scope: 'quotation', is_default: true, body: 'Quotation terms.' }

  it('prefers an exact-scope default over a shared one', () => {
    expect(pickDefaultTerms([both, quotationOnly], 'quotation')).toBe('Quotation terms.')
  })

  it('falls back to the shared "both" default when there is no exact one', () => {
    expect(pickDefaultTerms([both], 'quotation')).toBe('Shared terms.')
  })

  it('does not use an exact-scope default belonging to the other document type', () => {
    const invoiceOnly = { id: 3, scope: 'invoice', is_default: true, body: 'Invoice terms.' }
    expect(pickDefaultTerms([invoiceOnly], 'quotation')).toBe('')
  })

  it('ignores entries that are not flagged as the default', () => {
    const notDefault = { id: 4, scope: 'quotation', is_default: false, body: 'Not the default.' }
    expect(pickDefaultTerms([notDefault], 'quotation')).toBe('')
  })

  it('ignores a default with an empty body', () => {
    const empty = { id: 5, scope: 'quotation', is_default: true, body: '' }
    expect(pickDefaultTerms([empty], 'quotation')).toBe('')
  })

  it('returns an empty string for a missing or empty list', () => {
    expect(pickDefaultTerms([], 'quotation')).toBe('')
    expect(pickDefaultTerms(null, 'quotation')).toBe('')
    expect(pickDefaultTerms(undefined, 'quotation')).toBe('')
  })
})

/**
 * SERVICES_PLAN S2 — a catalogue service becomes a *copy*, not a live link.
 *
 * These assertions pin that copy: everything is snapshotted onto the line at add
 * time, and the provenance fields are recorded so the editor can tell the user
 * what "standard" meant before they edited the rate.
 */
describe('itemFromService', () => {
  const service = {
    id: 7,
    name: 'Modular kitchen',
    description: 'Full modular kitchen',
    unit: 'job',
    category: 'Kitchen',
    default_qty_milli: 2000,
    rate_paise: 500000,
  }

  it('copies every field onto an ordinary editable line', () => {
    const item = itemFromService(service)
    expect(item).toMatchObject({
      name: 'Modular kitchen',
      description: 'Full modular kitchen',
      unit: 'job',
      category: 'Kitchen',
      qty_milli: 2000,
      rate_paise: 500000,
    })
  })

  it('records the catalogue row and the rate snapshot', () => {
    expect(itemFromService(service)).toMatchObject({
      service_id: 7,
      catalog_rate_paise: 500000,
    })
  })

  it('falls back to one unit when the service has no default quantity', () => {
    expect(itemFromService({ ...service, default_qty_milli: null }).qty_milli).toBe(1000)
    expect(itemFromService({ ...service, default_qty_milli: 0 }).qty_milli).toBe(0)
  })

  it('normalises absent text to empty strings, not null', () => {
    const item = itemFromService({
      ...service,
      description: null,
      unit: null,
      category: null,
    })
    expect(item.description).toBe('')
    expect(item.unit).toBe('')
    expect(item.category).toBe('')
  })

  it('gives every added line its own key, so React can track the reorder', () => {
    expect(itemFromService(service).key).not.toBe(itemFromService(service).key)
  })

  it('leaves a hand-typed line without provenance', () => {
    expect(newItem({ name: 'Sofa' })).toMatchObject({ service_id: null, catalog_rate_paise: null })
  })
})

describe('ItemsEditor — catalogue provenance (S7/S8)', () => {
  const catalogItem = (overrides = {}) =>
    itemFromService({
      id: 7,
      name: 'Modular kitchen',
      description: 'Full modular kitchen',
      unit: 'job',
      category: 'Kitchen',
      default_qty_milli: 1000,
      rate_paise: 500000,
      ...overrides,
    })

  it('marks a catalogue-sourced line', () => {
    render(<ItemsHarness initial={[catalogItem()]} />)
    expect(screen.getByText('Catalog')).toBeInTheDocument()
  })

  it('does not mark a hand-typed line', () => {
    render(<ItemsHarness initial={[newItem({ name: 'Sofa', qty_milli: 1000, rate_paise: 100000 })]} />)
    expect(screen.queryByText('Catalog')).toBeNull()
  })

  it('leaves the line alone while the rate still matches the snapshot', () => {
    render(<ItemsHarness initial={[catalogItem()]} />)
    // Same rate as the catalogue: nothing to flag.
    expect(screen.queryByText(/standard/i)).toBeNull()
  })

  it('offers the snapshot once the rate is edited, and keeps the marker', async () => {
    const user = userEvent.setup()
    render(<ItemsHarness initial={[catalogItem()]} />)

    const rate = screen.getByLabelText('Item 1 rate in rupees')
    await user.clear(rate)
    await user.type(rate, '600')
    // The rate input commits on blur, so the hint can only appear after it.
    await user.tab()

    expect(screen.getByText('Standard ₹5,000.00')).toBeInTheDocument()
    expect(screen.getByText('Catalog')).toBeInTheDocument()
  })
})

describe('ItemsEditor — add from services', () => {
  it('offers the catalogue control only when a picker is wired up', () => {
    render(<ItemsHarness initial={[newItem({ name: 'Sofa' })]} />)
    expect(screen.queryByRole('button', { name: /add from services/i })).toBeNull()
  })

  it('opens the picker', async () => {
    const user = userEvent.setup()
    const onAddFromServices = vi.fn()
    render(
      <ItemsEditor
        items={[newItem({ name: 'Sofa' })]}
        onChange={vi.fn()}
        onAddFromServices={onAddFromServices}
      />,
    )

    await user.click(screen.getByRole('button', { name: /add from services/i }))
    expect(onAddFromServices).toHaveBeenCalled()
  })

  it('disables the control with the rest of the editor', () => {
    render(
      <ItemsEditor
        items={[newItem({ name: 'Sofa' })]}
        onChange={vi.fn()}
        onAddFromServices={vi.fn()}
        disabled
      />,
    )
    expect(screen.getByRole('button', { name: /add from services/i })).toBeDisabled()
  })
})

/**
 * The provenance round trip (SERVICES_PLAN 9A.3).
 *
 * `fromQuotation` and `buildPayload` used to ignore `service_id` and
 * `catalog_rate_paise` entirely, so merely opening a saved catalog-derived
 * quotation — or letting it autosave — destroyed the link to the catalogue and the
 * rate snapshot for good. The pair is the fix, so it is asserted directly.
 */
describe('fromQuotation / buildPayload provenance', () => {
  const saved = {
    client_id: 3,
    quotation_date: '2026-10-01',
    items: [
      {
        name: 'Modular kitchen',
        description: null,
        unit: 'job',
        category: 'Kitchen',
        qty_milli: 1000,
        rate_paise: 600000,
        service_id: 7,
        catalog_rate_paise: 500000,
      },
      {
        name: 'Sofa',
        description: null,
        unit: 'ea',
        category: null,
        qty_milli: 1000,
        rate_paise: 100000,
        service_id: null,
        catalog_rate_paise: null,
      },
    ],
  }

  it('reads both fields back off a saved quotation', () => {
    const form = fromQuotation(saved)
    expect(form.items[0]).toMatchObject({ service_id: 7, catalog_rate_paise: 500000 })
    expect(form.items[1]).toMatchObject({ service_id: null, catalog_rate_paise: null })
  })

  it('sends both fields back on save, preserving an edited rate against its snapshot', () => {
    const payload = buildPayload(fromQuotation(saved))
    expect(payload.items[0]).toMatchObject({
      rate_paise: 600000,
      service_id: 7,
      catalog_rate_paise: 500000,
    })
  })

  it('declares hand-typed lines as having no provenance rather than omitting it', () => {
    const payload = buildPayload(fromQuotation(saved))
    expect(payload.items[1]).toHaveProperty('service_id', null)
    expect(payload.items[1]).toHaveProperty('catalog_rate_paise', null)
  })

  it('treats absent fields as null, so an older saved quotation loads cleanly', () => {
    const form = fromQuotation({ items: [{ name: 'Sofa', qty_milli: 1000, rate_paise: 100000 }] })
    expect(form.items[0]).toMatchObject({ service_id: null, catalog_rate_paise: null })
  })

  it('keeps position derived from the array index', () => {
    const payload = buildPayload(fromQuotation(saved))
    expect(payload.items.map((it) => it.position)).toEqual([0, 1])
  })
})
