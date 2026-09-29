/**
 * Ruchita Interiors — document component tests (Phase 6, §14.3, §14.4).
 *
 * `DocumentPaper` is the send-ready artefact, so these assert what the client
 * actually receives: snapshot client data, server-computed totals, the
 * category grouping the items table relies on, and the §21.23 wordmark fallback
 * when no logo is set.
 *
 * The numbers asserted here are the ones the backend stored on the payload
 * (paise, §8.1). The component must render them verbatim — it never recomputes a
 * grand total, because the server is the calculation authority (D2).
 */

import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import DocumentPaper, { groupItemsByCategory } from './DocumentPaper.jsx'

const SETTINGS = {
  company_name: 'Ruchita Interiors',
  tagline: 'Interior design & execution',
  phone: '+91 98765 43210',
  email: 'hello@ruchitainteriors.in',
  website: 'ruchitainteriors.in',
  address_line1: '14, Rose Villa',
  address_line2: 'Near City Centre',
  city: 'Indore',
  state: 'Madhya Pradesh',
  pincode: '452001',
  gstin: '23ABCDE1234F1Z5',
  signatory_name: 'Ruchita Sharma',
  footer_text: 'Modular Kitchen · Wardrobes · False Ceiling · Turnkey Interiors',
}

/** A payload shaped exactly like the server's `GET /quotations/:id` response. */
function quotation(overrides = {}) {
  return {
    id: 42,
    number: 'QTN-2026-0007',
    status: 'sent',
    quotation_date: '2026-09-29',
    valid_until: '2026-10-14',
    client_snapshot: {
      name: 'Meera Iyer',
      phone: '+91 90000 11111',
      email: 'meera@example.com',
      address: '22, Green Meadows, Indore',
      project_address: 'Plot 14, Sardar Patel Nagar, Indore',
      gstin: '23ABCDE9999Z1Z2',
    },
    discount_type: 'percent',
    discount_bp: 500,
    discount_fixed_paise: null,
    gst_bp: 1800,
    other_charges_label: 'Site Preparation',
    other_charges_paise: 250000,
    subtotal_paise: 1000000,
    discount_paise: 50000,
    gst_paise: 171000,
    grand_total_paise: 1171000,
    terms_text: 'Payment due within 15 days of quotation.\nWork begins on mutual agreement.',
    notes: 'Internal only.',
    items: [
      {
        id: 1,
        position: 0,
        category: 'Kitchen',
        name: 'Modular base cabinet',
        description: '18mm prelaminated board, epoxy finish.',
        unit: 'running ft',
        qty_milli: 12500,
        rate_paise: 95000,
        line_total_paise: 1187500,
      },
      {
        id: 2,
        position: 1,
        category: 'Kitchen',
        name: 'Quartz countertop',
        description: null,
        unit: 'sq.ft',
        qty_milli: 4000,
        rate_paise: 120000,
        line_total_paise: 480000,
      },
      {
        id: 3,
        position: 2,
        category: 'False Ceiling',
        name: 'POP false ceiling',
        description: 'With concealed cove lighting.',
        unit: 'sq.ft',
        qty_milli: 8000,
        rate_paise: 45000,
        line_total_paise: 360000,
      },
    ],
    ...overrides,
  }
}

describe('groupItemsByCategory', () => {
  it('groups consecutive items and keeps document order', () => {
    const groups = groupItemsByCategory([
      { id: 1, category: 'Kitchen' },
      { id: 2, category: 'Kitchen' },
      { id: 3, category: 'Painting' },
    ])
    expect(groups.map((g) => g.category)).toEqual(['Kitchen', 'Painting'])
    expect(groups[0].items.map((i) => i.id)).toEqual([1, 2])
  })

  it('does not merge the same category appearing non-consecutively', () => {
    const groups = groupItemsByCategory([
      { id: 1, category: 'Kitchen' },
      { id: 2, category: 'Bathroom' },
      { id: 3, category: 'Kitchen' },
    ])
    expect(groups.map((g) => g.category)).toEqual(['Kitchen', 'Bathroom', 'Kitchen'])
  })

  it('leaves uncategorised items in their own unnamed group', () => {
    const groups = groupItemsByCategory([
      { id: 1, category: null },
      { id: 2, category: '   ' },
    ])
    expect(groups).toHaveLength(2)
    expect(groups.every((g) => g.category === '')).toBe(true)
  })

  it('reports the document index each group starts at, so # keeps counting across groups', () => {
    const groups = groupItemsByCategory([
      { id: 1, category: 'Kitchen' },
      { id: 2, category: 'Kitchen' },
      { id: 3, category: 'Painting' },
    ])
    expect(groups.map((g) => g.startIndex)).toEqual([0, 2])
  })

  it('handles an empty item list', () => {
    expect(groupItemsByCategory([])).toEqual([])
  })
})

describe('DocumentPaper — identity and header', () => {
  it('renders the company block from the settings row', () => {
    render(<DocumentPaper document={quotation()} settings={SETTINGS} />)

    expect(screen.getByText('Ruchita Interiors')).toBeInTheDocument()
    expect(screen.getByText('Interior design & execution')).toBeInTheDocument()
    expect(
      screen.getByText('14, Rose Villa, Near City Centre, Indore, Madhya Pradesh, 452001'),
    ).toBeInTheDocument()
    expect(screen.getByText('GSTIN: 23ABCDE1234F1Z5')).toBeInTheDocument()
  })

  it('falls back to the bundled wordmark when no logo is set (§21.23)', () => {
    render(<DocumentPaper document={quotation()} settings={SETTINGS} logoSrc={null} />)

    // The company name serves as the wordmark, in place of an <img>.
    expect(screen.getByText('Ruchita Interiors')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /logo/i })).not.toBeInTheDocument()
  })

  it('renders the uploaded logo when one is set', () => {
    render(<DocumentPaper document={quotation()} settings={SETTINGS} logoSrc="/api/v1/uploads/logo?v=1" />)

    expect(screen.getByRole('img', { name: /logo/i })).toHaveAttribute('src', '/api/v1/uploads/logo?v=1')
  })
})

describe('DocumentPaper — title strip and client block', () => {
  it('shows the document number, kind and both dates', () => {
    render(<DocumentPaper document={quotation()} settings={SETTINGS} />)

    expect(screen.getByRole('heading', { level: 1, name: 'Quotation' })).toBeInTheDocument()
    expect(screen.getByText('QTN-2026-0007')).toBeInTheDocument()
    expect(screen.getByText('29 Sep 2026')).toBeInTheDocument()
    expect(screen.getByText('14 Oct 2026')).toBeInTheDocument()
  })

  it('renders the client from the snapshot, not the live client record', () => {
    render(<DocumentPaper document={quotation()} settings={SETTINGS} />)

    expect(screen.getByText('Meera Iyer')).toBeInTheDocument()
    expect(screen.getByText('22, Green Meadows, Indore')).toBeInTheDocument()
    expect(screen.getByText('Plot 14, Sardar Patel Nagar, Indore')).toBeInTheDocument()
    expect(screen.getByText('+91 90000 11111')).toBeInTheDocument()
  })

  it('omits optional company fields cleanly rather than printing undefined (§21.24)', () => {
    const sparse = { ...SETTINGS, tagline: null, website: null, gstin: null, address_line1: null }
    render(<DocumentPaper document={quotation()} settings={sparse} />)

    expect(screen.getByText('Ruchita Interiors')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/undefined|null|NaN/)
  })

  it('survives a quotation with no items yet (Draft, §21.1)', () => {
    const empty = quotation({ items: [], terms_text: null, client_snapshot: null })
    render(<DocumentPaper document={empty} settings={SETTINGS} />)

    expect(screen.getByText('No items yet.')).toBeInTheDocument()
    // Absent client data renders as a dash, not as an empty or broken name.
    expect(screen.getByRole('heading', { name: 'Bill To' }).parentElement.textContent).toContain('—')
  })
})

describe('DocumentPaper — items table', () => {
  it('renders one row per item with quantity, rate and server line total', () => {
    render(<DocumentPaper document={quotation()} settings={SETTINGS} />)
    const table = screen.getByRole('table')

    // 12.5 running ft of a ₹950 base cabinet.
    expect(within(table).getByText('12.5')).toBeInTheDocument()
    expect(within(table).getByText('₹950.00')).toBeInTheDocument()
    expect(within(table).getByText('₹11,875.00')).toBeInTheDocument()
    expect(within(table).getByText('₹4,800.00')).toBeInTheDocument()
    expect(within(table).getByText('₹3,600.00')).toBeInTheDocument()
  })

  it('shows a grouping subheader for each category, once per run', () => {
    render(<DocumentPaper document={quotation()} settings={SETTINGS} />)

    expect(screen.getByText('Kitchen')).toBeInTheDocument()
    expect(screen.getByText('False Ceiling')).toBeInTheDocument()
  })

  it('numbers items continuously across category groups', () => {
    render(<DocumentPaper document={quotation()} settings={SETTINGS} />)

    // Items 1 and 2 are Kitchen, item 3 is False Ceiling — the # column must not
    // restart at the group boundary.
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('wraps a long description under its item name', () => {
    render(<DocumentPaper document={quotation()} settings={SETTINGS} />)

    expect(screen.getByText('18mm prelaminated board, epoxy finish.')).toBeInTheDocument()
    expect(screen.getByText('With concealed cove lighting.')).toBeInTheDocument()
  })

  it('marks the table so the print layer can repeat its header (§14.4)', () => {
    render(<DocumentPaper document={quotation()} settings={SETTINGS} />)

    // The multi-page rules are CSS, so what is testable is that the hooks the
    // stylesheet targets are actually present in the DOM.
    expect(document.querySelector('[data-document-items] thead')).toBeTruthy()
    expect(document.querySelector('[data-document-totals]')).toBeTruthy()
  })
})

describe('DocumentPaper — totals block', () => {
  it('renders the server totals in the §10.2 order', () => {
    render(<DocumentPaper document={quotation()} settings={SETTINGS} />)

    expect(screen.getByText('Subtotal')).toBeInTheDocument()
    // 5% of a ₹10,000 subtotal.
    expect(screen.getByText('Discount (5%)')).toBeInTheDocument()
    expect(screen.getByText('Taxable Value')).toBeInTheDocument()
    expect(screen.getByText('GST 18%')).toBeInTheDocument()
    expect(screen.getByText('Site Preparation')).toBeInTheDocument()
    expect(screen.getByText('Grand Total')).toBeInTheDocument()
  })

  it('uses the server grand total, never a recomputed one (D2)', () => {
    // The item line totals sum to ₹20,275, which does not match the header totals
    // on purpose: this asserts the component trusts the document, not the rows.
    render(<DocumentPaper document={quotation()} settings={SETTINGS} />)

    expect(screen.getByText('Grand Total').parentElement.textContent).toContain('₹11,710.00')
  })

  it('labels a fixed discount without a percentage (§14.3)', () => {
    const fixed = quotation({ discount_type: 'fixed', discount_bp: null, discount_fixed_paise: 50000 })
    render(<DocumentPaper document={fixed} settings={SETTINGS} />)

    expect(screen.getByText('Discount')).toBeInTheDocument()
    expect(screen.queryByText(/Discount \(/)).not.toBeInTheDocument()
  })

  it('omits the discount and other-charges rows when they are zero', () => {
    const plain = quotation({
      discount_paise: 0,
      other_charges_paise: 0,
      discount_bp: 0,
    })
    render(<DocumentPaper document={plain} settings={SETTINGS} />)

    expect(screen.queryByText(/^Discount/)).not.toBeInTheDocument()
    expect(screen.queryByText('Site Preparation')).not.toBeInTheDocument()
  })
})

describe('DocumentPaper — terms, signatory and footer', () => {
  it('renders the terms snapshot as a numbered list', () => {
    render(<DocumentPaper document={quotation()} settings={SETTINGS} />)

    const terms = screen.getByRole('heading', { name: 'Terms & Conditions' }).parentElement
    expect(within(terms).getByText('Payment due within 15 days of quotation.')).toBeInTheDocument()
    expect(within(terms).getByText('Work begins on mutual agreement.')).toBeInTheDocument()
  })

  it('omits the terms block when the quotation has none', () => {
    render(<DocumentPaper document={quotation({ terms_text: null })} settings={SETTINGS} />)

    expect(screen.queryByRole('heading', { name: 'Terms & Conditions' })).not.toBeInTheDocument()
  })

  it('ignores blank lines in the terms text instead of printing empty terms', () => {
    const withBlanks = quotation({ terms_text: 'First term.\n\n\n   \nSecond term.' })
    render(<DocumentPaper document={withBlanks} settings={SETTINGS} />)

    const terms = screen.getByRole('heading', { name: 'Terms & Conditions' }).parentElement
    expect(within(terms).getAllByRole('listitem')).toHaveLength(2)
  })

  it('renders the signatory and footer from settings', () => {
    render(<DocumentPaper document={quotation()} settings={SETTINGS} />)

    expect(screen.getByText('Ruchita Sharma')).toBeInTheDocument()
    expect(screen.getByText('For Ruchita Interiors')).toBeInTheDocument()
    expect(
      screen.getByText('Modular Kitchen · Wardrobes · False Ceiling · Turnkey Interiors'),
    ).toBeInTheDocument()
  })

  it('falls back to a neutral signatory label when none is configured', () => {
    render(<DocumentPaper document={quotation()} settings={{ ...SETTINGS, signatory_name: null }} />)

    expect(screen.getByText('Authorised Signatory')).toBeInTheDocument()
  })

  it('never prints the internal notes field', () => {
    render(<DocumentPaper document={quotation()} settings={SETTINGS} />)

    expect(screen.queryByText('Internal only.')).not.toBeInTheDocument()
  })
})

describe('DocumentPaper — heading level', () => {
  it('defaults to a level-one heading for the standalone print route', () => {
    render(<DocumentPaper document={quotation()} settings={SETTINGS} />)

    expect(screen.getByRole('heading', { level: 1, name: 'Quotation' })).toBeInTheDocument()
  })

  it('drops to level two inside the preview overlay, leaving the page h1 unique', () => {
    render(<DocumentPaper document={quotation()} settings={SETTINGS} titleLevel="h2" />)

    expect(screen.getByRole('heading', { level: 2, name: 'Quotation' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 1, name: 'Quotation' })).not.toBeInTheDocument()
  })
})

describe('DocumentPaper — unsaved preview', () => {
  it('never invents a number for a quotation the server has not numbered (§12)', () => {
    render(<DocumentPaper document={quotation({ number: null })} settings={SETTINGS} isUnsaved />)

    expect(screen.getByText('Draft — not yet saved')).toBeInTheDocument()
    expect(screen.queryByText('QTN-2026-0007')).not.toBeInTheDocument()
  })
})
