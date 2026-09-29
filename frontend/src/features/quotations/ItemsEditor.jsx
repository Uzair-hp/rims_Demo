/**
 * Ruchita Interiors — line items editor (§10, §18.5).
 *
 * A controlled table of quotation lines. The parent owns the array; this
 * component edits one field at a time and reports the whole list back. Quantities
 * are entered in natural units and rates in rupees, then stored as milli-units and
 * paise — the integer units the API and `lib/calc` expect.
 *
 * Below `md` the header row is hidden and each line reads as a stacked card
 * (labels come from the field's own placeholder + aria-label), per §18.6.
 */

import Button from '../../components/ui/Button.jsx'
import Icon from '../../components/ui/Icon.jsx'
import { calcLineTotal, milliToInput, unitsToMilli } from '../../lib/calc.js'
import { formatPaise, paiseToInput, rupeesToPaise } from '../../lib/money.js'
import styles from './ItemsEditor.module.css'

let nextKey = 1
export function newItem(overrides = {}) {
  return {
    key: `item-${nextKey++}`,
    name: '',
    description: '',
    unit: '',
    category: '',
    qty_milli: 0,
    rate_paise: 0,
    ...overrides,
  }
}

/**
 * @param {{
 *   items: Array<object>,
 *   onChange: (items: Array<object>) => void,
 *   errors?: Array<Record<string, string>>,
 *   units?: string[],
 *   categories?: string[],
 *   disabled?: boolean,
 * }} props
 */
export default function ItemsEditor({
  items,
  onChange,
  errors = [],
  units = [],
  categories = [],
  disabled = false,
}) {
  const update = (index, patch) => {
    onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  }

  const remove = (index) => {
    onChange(items.filter((_, i) => i !== index))
  }

  // Reorder by swapping with the neighbour (§ FR-Q2). The whole item object —
  // key and all fields — moves intact, so every value is preserved and `position`
  // is re-derived from the array index at save time.
  const move = (index, dir) => {
    const target = index + dir
    if (target < 0 || target >= items.length) return
    const next = items.slice()
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
  }

  const add = () => onChange([...items, newItem()])

  return (
    <div className={styles.editor}>
      <div className={styles.tableHead} aria-hidden="true">
        <span>Item</span>
        <span>Qty</span>
        <span>Unit</span>
        <span>Rate (₹)</span>
        <span className={styles.right}>Line total</span>
        <span />
      </div>

      <ul className={styles.rows}>
        {items.map((item, index) => {
          const rowErrors = errors[index] || {}
          const lineTotal = calcLineTotal(item.qty_milli, item.rate_paise)
          return (
            <li key={item.key ?? index} className={styles.row}>
              <div className={styles.cellName}>
                <input
                  className={`${styles.input} ${rowErrors.name ? styles.invalid : ''}`.trim()}
                  placeholder="Item name"
                  aria-label={`Item ${index + 1} name`}
                  value={item.name}
                  disabled={disabled}
                  onChange={(e) => update(index, { name: e.target.value })}
                />
                <input
                  className={styles.inputSubtle}
                  placeholder="Description (optional)"
                  aria-label={`Item ${index + 1} description`}
                  value={item.description || ''}
                  disabled={disabled}
                  onChange={(e) => update(index, { description: e.target.value })}
                />
                <input
                  className={styles.inputSubtle}
                  placeholder="Category (optional)"
                  aria-label={`Item ${index + 1} category`}
                  list="ri-categories"
                  value={item.category || ''}
                  disabled={disabled}
                  onChange={(e) => update(index, { category: e.target.value })}
                />
                {rowErrors.name ? (
                  <p className={styles.error} role="alert">
                    {rowErrors.name}
                  </p>
                ) : null}
              </div>

              <div className={styles.cellQty}>
                <input
                  className={`${styles.input} ${styles.num} ${rowErrors.qty_milli ? styles.invalid : ''}`.trim()}
                  type="text"
                  inputMode="decimal"
                  placeholder="Qty"
                  aria-label={`Item ${index + 1} quantity`}
                  defaultValue={milliToInput(item.qty_milli)}
                  disabled={disabled}
                  onBlur={(e) => update(index, { qty_milli: unitsToMilli(e.target.value) })}
                />
              </div>

              <div className={styles.cellUnit}>
                <input
                  className={styles.input}
                  placeholder="Unit"
                  aria-label={`Item ${index + 1} unit`}
                  list="ri-units"
                  value={item.unit || ''}
                  disabled={disabled}
                  onChange={(e) => update(index, { unit: e.target.value })}
                />
              </div>

              <div className={styles.cellRate}>
                <input
                  className={`${styles.input} ${styles.num} ${rowErrors.rate_paise ? styles.invalid : ''}`.trim()}
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  aria-label={`Item ${index + 1} rate in rupees`}
                  defaultValue={paiseToInput(item.rate_paise)}
                  disabled={disabled}
                  onBlur={(e) => update(index, { rate_paise: rupeesToPaise(e.target.value) })}
                />
              </div>

              <div className={styles.cellTotal}>
                <span className={styles.totalLabel} aria-hidden="true">
                  Line total
                </span>
                <span className={styles.totalValue}>{formatPaise(lineTotal)}</span>
              </div>

              <div className={styles.cellRemove}>
                <button
                  type="button"
                  className={styles.iconBtn}
                  aria-label={`Move item ${index + 1} up`}
                  disabled={disabled || index === 0}
                  onClick={() => move(index, -1)}
                >
                  <Icon name="chevronUp" size={18} />
                </button>
                <button
                  type="button"
                  className={styles.iconBtn}
                  aria-label={`Move item ${index + 1} down`}
                  disabled={disabled || index === items.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <Icon name="chevronDown" size={18} />
                </button>
                <button
                  type="button"
                  className={styles.remove}
                  aria-label={`Remove item ${index + 1}`}
                  disabled={disabled || items.length === 1}
                  onClick={() => remove(index)}
                >
                  <Icon name="trash" size={18} />
                </button>
              </div>
            </li>
          )
        })}
      </ul>

      {units.length ? (
        <datalist id="ri-units">
          {units.map((u) => (
            <option key={u} value={u} />
          ))}
        </datalist>
      ) : null}

      {categories.length ? (
        <datalist id="ri-categories">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      ) : null}

      <Button variant="ghost" size="sm" icon="plus" onClick={add} disabled={disabled}>
        Add item
      </Button>
    </div>
  )
}
