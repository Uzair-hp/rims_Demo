import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import StatusBadge from './StatusBadge.jsx'
import styles from './StatusBadge.module.css'

/**
 * StatusBadge colour tests (§18.6).
 *
 * These assert the *class* rather than the rendered colour, because the colour
 * itself comes from design tokens and jsdom does not resolve custom properties.
 * Asserting the class is the meaningful unit here: it is what proves each status
 * maps to its own variant, and that an unknown status degrades to neutral instead
 * of silently borrowing another status's colour.
 *
 * The bug these exist to prevent: both quotation pages once rendered
 * `<StatusBadge>` with no `status` prop, so all five quotation statuses fell
 * through to neutral grey.
 */
describe('StatusBadge', () => {
  const QUOTATION_VARIANTS = {
    draft: styles.qDraft,
    sent: styles.qSent,
    approved: styles.qApproved,
    rejected: styles.qRejected,
    converted: styles.qConverted,
  }

  it('gives every quotation status its own variant', () => {
    for (const [status, variant] of Object.entries(QUOTATION_VARIANTS)) {
      expect(variant, `${status} must have a variant class`).toBeTruthy()
    }
    // Five statuses, five distinct classes — a copy-paste that reused one class
    // would make two statuses indistinguishable.
    expect(new Set(Object.values(QUOTATION_VARIANTS)).size).toBe(5)
  })

  it('maps each quotation status to its variant', () => {
    for (const [status, variant] of Object.entries(QUOTATION_VARIANTS)) {
      const { container } = render(<StatusBadge status={status}>{status}</StatusBadge>)
      expect(container.firstChild.className).toContain(variant)
    }
  })

  it('keeps the payment variants intact', () => {
    // The quotation map was added alongside these, not in place of them.
    const cases = {
      unpaid: styles.unpaid,
      partially_paid: styles.partial,
      paid: styles.paid,
    }
    for (const [status, variant] of Object.entries(cases)) {
      const { container } = render(<StatusBadge status={status} />)
      expect(container.firstChild.className).toContain(variant)
    }
  })

  it('falls back to neutral for an unknown status', () => {
    const { container } = render(<StatusBadge status="something-else" />)
    expect(container.firstChild.className).toContain(styles.neutral)
  })

  it('does not colour a payment status with a quotation variant', () => {
    // The two vocabularies share one lookup. If they ever overlapped, "paid"
    // would pick up a quotation colour.
    const { container } = render(<StatusBadge status="paid" />)
    const className = container.firstChild.className
    for (const variant of Object.values(QUOTATION_VARIANTS)) {
      expect(className).not.toContain(variant)
    }
  })

  it('keeps the archived variant independent of any status', () => {
    const { container } = render(<StatusBadge archived>Archived</StatusBadge>)
    expect(container.firstChild.className).toContain(styles.archived)
    expect(screen.getByText('Archived')).toBeInTheDocument()
  })
})
