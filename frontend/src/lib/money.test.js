import { describe, expect, it } from 'vitest'
import { formatPaise } from './money.js'

describe('formatPaise', () => {
  it('formats paise as an Indian-grouped rupee amount with two decimals', () => {
    expect(formatPaise(0)).toBe('\u{20B9}0.00')
    expect(formatPaise(5)).toBe('\u{20B9}0.05')
    expect(formatPaise(100)).toBe('\u{20B9}1.00')
    expect(formatPaise(1050)).toBe('\u{20B9}10.50')
    expect(formatPaise(1234567)).toBe('\u{20B9}12,345.67')
    expect(formatPaise(123456789)).toBe('\u{20B9}12,34,567.89')
  })

  it('uses the Indian grouping style for large values', () => {
    expect(formatPaise(123456789)).toBe('\u{20B9}12,34,567.89')
    expect(formatPaise(100000)).toBe('\u{20B9}1,000.00')
    expect(formatPaise(10000000)).toBe('\u{20B9}1,00,000.00')
  })

  it('treats null, undefined and NaN as zero', () => {
    expect(formatPaise(null)).toBe('\u{20B9}0.00')
    expect(formatPaise(undefined)).toBe('\u{20B9}0.00')
    expect(formatPaise(NaN)).toBe('\u{20B9}0.00')
  })
})
