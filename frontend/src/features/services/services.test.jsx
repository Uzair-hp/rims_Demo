/**
 * Ruchita Interiors — services feature tests (SERVICES_PLAN §9, Phase 9A).
 *
 * Unit tests for the rules the services feature owns client-side: the form
 * validation mirror (rate > 0, name required, caps) and the picker contract
 * helpers. Backend integration (CRUD, archive, snapshot) is covered by
 * `backend/tests/test_services.py`; this suite stays to pure logic, the same
 * split `clients.test.jsx` uses.
 */

import { describe, it, expect } from 'vitest'
import { validateService } from '../../lib/validation.js'
import { PAGE_SIZE } from './useServices.js'

describe('validateService', () => {
  const valid = {
    name: 'Modular kitchen',
    category: 'Kitchen',
    description: 'Full modular kitchen',
    unit: 'job',
    default_qty_milli: 1000,
    rate_paise: 500000,
  }

  it('accepts a complete service', () => {
    expect(validateService(valid)).toEqual({})
  })

  it('requires a name (FR-SV1)', () => {
    expect(validateService({ ...valid, name: '' }).name).toBeTruthy()
    expect(validateService({ ...valid, name: '   ' }).name).toBeTruthy()
    expect(validateService({ ...valid, name: undefined }).name).toBeTruthy()
  })

  it('rejects a zero rate (S3)', () => {
    expect(validateService({ ...valid, rate_paise: 0 }).rate_paise).toBeTruthy()
  })

  it('rejects a negative rate (S3)', () => {
    expect(validateService({ ...valid, rate_paise: -1 }).rate_paise).toBeTruthy()
  })

  it('accepts the smallest positive rate — one paisa', () => {
    expect(validateService({ ...valid, rate_paise: 1 })).toEqual({})
  })

  it('rejects a rate above the §10.3 cap', () => {
    expect(validateService({ ...valid, rate_paise: 10 ** 12 + 1 }).rate_paise).toBeTruthy()
  })

  it('allows a zero default quantity but not a negative one', () => {
    expect(validateService({ ...valid, default_qty_milli: 0 })).toEqual({})
    expect(validateService({ ...valid, default_qty_milli: -1 }).default_qty_milli).toBeTruthy()
  })

  it('caps the optional text fields (§4.1)', () => {
    expect(validateService({ ...valid, category: 'x'.repeat(101) }).category).toBeTruthy()
    expect(validateService({ ...valid, description: 'x'.repeat(2001) }).description).toBeTruthy()
    expect(validateService({ ...valid, unit: 'x'.repeat(51) }).unit).toBeTruthy()
    expect(validateService({ ...valid, name: 'x'.repeat(201) }).name).toBeTruthy()
  })

  it('reports no errors for fields at exactly the cap', () => {
    expect(
      validateService({
        ...valid,
        category: 'x'.repeat(100),
        description: 'x'.repeat(2000),
        unit: 'x'.repeat(50),
        name: 'x'.repeat(200),
      }),
    ).toEqual({})
  })

  it('treats missing optional fields as valid', () => {
    expect(validateService({ name: 'Painting', rate_paise: 100000 })).toEqual({})
  })
})

describe('useServices constants', () => {
  it('uses the shared 25-row page size', () => {
    expect(PAGE_SIZE).toBe(25)
  })
})
