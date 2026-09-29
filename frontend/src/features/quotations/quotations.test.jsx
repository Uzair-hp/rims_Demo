/**
 * Ruchita Interiors — quotation feature unit tests (§10, §15).
 *
 * Covers the display-only calculation mirror and the form validator. These
 * mirror the backend calculation/validation suites; the server stays the
 * authority, but the editor's live preview and inline errors rely on these.
 */

import { describe, it, expect } from 'vitest'
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
