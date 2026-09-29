/**
 * Ruchita Interiors — quotation editor (§10, §13, §20).
 *
 * One component for both "new quotation" and "edit draft/sent". It owns the form,
 * shows live totals from `lib/calc` (a display mirror — the server recomputes on
 * save), and persists through the quotations API. Drafts autosave ~10s after the
 * last edit; a `beforeunload` guard warns if there are unsaved changes (§20).
 *
 * The client is chosen through the shared `ClientPicker`, so the editor and the
 * Clients page can never disagree on the directory.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHeader from '../../components/ui/PageHeader.jsx'
import Button from '../../components/ui/Button.jsx'
import Card from '../../components/ui/Card.jsx'
import Skeleton from '../../components/ui/Skeleton.jsx'
import TextField from '../../components/ui/TextField.jsx'
import ClientPicker from '../clients/ClientPicker.jsx'
import QuotationPreview from '../documents/QuotationPreview.jsx'
import { useSettings } from '../settings/SettingsProvider.jsx'
import ItemsEditor, { newItem } from './ItemsEditor.jsx'
import TotalsPanel from './TotalsPanel.jsx'
import { createQuotation, fetchQuotation, updateQuotation } from '../../api/endpoints/quotations.js'
import { calcLineTotal, calcTotals } from '../../lib/calc.js'
import { paiseToInput, rupeesToPaise } from '../../lib/money.js'
import { validateQuotation } from '../../lib/validation.js'
import styles from './QuotationEditor.module.css'

const AUTOSAVE_MS = 10000

const todayIso = () => new Date().toISOString().slice(0, 10)

function emptyForm() {
  return {
    client: null,
    client_id: null,
    quotation_date: todayIso(),
    valid_until: '',
    discount_type: 'percent',
    discount_bp: 0,
    discount_fixed_paise: 0,
    gst_bp: 1800,
    other_charges_label: 'Other charges',
    other_charges_paise: 0,
    terms_text: '',
    notes: '',
    items: [newItem()],
  }
}

function fromQuotation(q) {
  return {
    client: q.client_snapshot ? { id: q.client_id, name: q.client_snapshot.name } : null,
    client_id: q.client_id,
    quotation_date: q.quotation_date || todayIso(),
    valid_until: q.valid_until || '',
    discount_type: q.discount_type || 'percent',
    discount_bp: q.discount_bp || 0,
    discount_fixed_paise: q.discount_fixed_paise || 0,
    gst_bp: q.gst_bp ?? 1800,
    other_charges_label: q.other_charges_label || 'Other charges',
    other_charges_paise: q.other_charges_paise || 0,
    terms_text: q.terms_text || '',
    notes: q.notes || '',
    items: (q.items || []).map((it) =>
      newItem({
        name: it.name || '',
        description: it.description || '',
        unit: it.unit || '',
        category: it.category || '',
        qty_milli: it.qty_milli || 0,
        rate_paise: it.rate_paise || 0,
      }),
    ),
  }
}

function buildPayload(form) {
  const isPercent = form.discount_type === 'percent'
  return {
    client_id: form.client_id,
    quotation_date: form.quotation_date,
    valid_until: form.valid_until || null,
    discount_type: form.discount_type,
    discount_bp: isPercent ? Number(form.discount_bp || 0) : null,
    discount_fixed_paise: isPercent ? null : Number(form.discount_fixed_paise || 0),
    gst_bp: Number(form.gst_bp || 0),
    other_charges_label: form.other_charges_label || 'Other charges',
    other_charges_paise: Number(form.other_charges_paise || 0),
    terms_text: form.terms_text || null,
    notes: form.notes || null,
    items: form.items.map((it, i) => ({
      name: it.name,
      description: it.description || null,
      unit: it.unit || null,
      category: it.category || null,
      qty_milli: Number(it.qty_milli || 0),
      rate_paise: Number(it.rate_paise || 0),
      position: i,
    })),
  }
}

/**
 * Build a document-shaped object for the preview overlay from the current form.
 *
 * Phase 6: the preview is rendered from what is on screen right now, not from a
 * server round trip, so the user can check a document before committing it. That
 * is safe because the preview is display-only — the numbers come from the same
 * `lib/calc` mirror the live totals panel uses, and saving still recomputes
 * everything server-side (§10.1). An unsaved quotation has no number, which is
 * why `number` stays null and the overlay labels the document as unsaved.
 */
function buildPreviewDocument(form, totals, id, number) {
  const isPercent = form.discount_type === 'percent'
  return {
    id: id ?? null,
    number: number ?? null,
    client_id: form.client_id,
    // Whatever the picker gave us. The saved quotation gets the real snapshot from
    // the server on its next read, so a partial preview here is honest rather
    // than a second source of truth for client details (§8.4).
    client_snapshot: {
      name: form.client?.name || '',
      phone: form.client?.phone || '',
      email: form.client?.email || '',
      address: form.client?.address || '',
      project_address: form.client?.project_address || '',
      gstin: form.client?.gstin || '',
    },
    quotation_date: form.quotation_date,
    valid_until: form.valid_until || null,
    status: 'draft',
    discount_type: form.discount_type,
    discount_bp: isPercent ? form.discount_bp : null,
    discount_fixed_paise: isPercent ? null : form.discount_fixed_paise,
    gst_bp: form.gst_bp,
    other_charges_label: form.other_charges_label,
    other_charges_paise: form.other_charges_paise,
    subtotal_paise: totals.subtotalPaise,
    discount_paise: totals.discountPaise,
    gst_paise: totals.gstPaise,
    grand_total_paise: totals.grandTotalPaise,
    terms_text: form.terms_text || null,
    items: form.items.map((it, i) => ({
      id: `preview-${i}`,
      position: i,
      category: it.category || null,
      name: it.name || '',
      description: it.description || null,
      unit: it.unit || null,
      qty_milli: Number(it.qty_milli || 0),
      rate_paise: Number(it.rate_paise || 0),
      line_total_paise: calcLineTotal(it.qty_milli, it.rate_paise),
    })),
  }
}

/**
 * Uncontrolled numeric input (commits on blur), so typing a decimal is never
 * reformatted mid-keystroke. Mounted only after the form's initial values exist.
 */
function NumberInput({ label, defaultValue, onCommit, prefix, suffix, hint, error }) {
  const id = useId()
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <div className={`${styles.inputWrap} ${error ? styles.invalid : ''}`.trim()}>
        {prefix ? <span className={styles.affix}>{prefix}</span> : null}
        <input
          id={id}
          className={styles.numInput}
          type="text"
          inputMode="decimal"
          defaultValue={defaultValue}
          onBlur={(e) => onCommit(e.target.value)}
        />
        {suffix ? <span className={styles.affix}>{suffix}</span> : null}
      </div>
      {hint && !error ? <p className={styles.hint}>{hint}</p> : null}
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export default function QuotationEditor({ mode = 'create', quotationId = null }) {
  const navigate = useNavigate()
  const { settings, logoSrc } = useSettings()
  const units = settings?.units || []
  const categories = settings?.item_categories || []

  const isEdit = mode === 'edit'
  const [form, setForm] = useState(() => emptyForm())
  const [loadStatus, setLoadStatus] = useState(isEdit ? 'loading' : 'ready')
  const [serverStatus, setServerStatus] = useState('draft')
  const [id, setId] = useState(quotationId)
  /**
   * The number the server allocated, once there is one. Held separately from the
   * form because it is the server's to give (§12): a brand-new quotation previews
   * without a number rather than with a fabricated one, and picks the real one up
   * as soon as it has been saved.
   */
  const [serverNumber, setServerNumber] = useState(null)
  const [errors, setErrors] = useState({ fields: {}, items: [] })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [autosaveState, setAutosaveState] = useState('idle')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!isEdit || !quotationId) return undefined
    let cancelled = false
    setLoadStatus('loading')
    fetchQuotation(quotationId)
      .then((q) => {
        if (cancelled) return
        setForm(fromQuotation(q))
        setServerStatus(q.status)
        setServerNumber(q.number || null)
        setId(q.id)
        setLoadStatus('ready')
      })
      .catch(() => {
        if (!cancelled) setLoadStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [isEdit, quotationId])
  /* eslint-enable react-hooks/set-state-in-effect */

  const totals = useMemo(
    () =>
      calcTotals({
        items: form.items,
        discountType: form.discount_type,
        discountBp: form.discount_bp,
        discountFixedPaise: form.discount_fixed_paise,
        gstBp: form.gst_bp,
        otherChargesPaise: form.other_charges_paise,
      }),
    [form],
  )

  const patch = useCallback((changes) => {
    setForm((f) => ({ ...f, ...changes }))
    setDirty(true)
    setAutosaveState('idle')
  }, [])

  const setItems = useCallback((items) => {
    setForm((f) => ({ ...f, items }))
    setDirty(true)
    setAutosaveState('idle')
  }, [])

  const formRef = useRef(form)
  useEffect(() => {
    formRef.current = form
  }, [form])

  // Autosave: only an existing draft, only when the form is valid, ~10s after the
  // last edit. Failures are shown quietly — the manual Save is always available.
  useEffect(() => {
    if (!dirty || !id || serverStatus !== 'draft') return undefined
    if (!validateQuotation(formRef.current).ok) return undefined
    const handle = setTimeout(() => {
      const snapshot = formRef.current
      setAutosaveState('saving')
      updateQuotation(id, buildPayload(snapshot))
        .then(() => {
          setDirty(false)
          setAutosaveState('saved')
        })
        .catch(() => setAutosaveState('error'))
    }, AUTOSAVE_MS)
    return () => clearTimeout(handle)
  }, [form, dirty, id, serverStatus])

  // Warn before leaving with unsaved changes (§20).
  useEffect(() => {
    if (!dirty) return undefined
    const handler = (e) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  const handleSave = async () => {
    const result = validateQuotation(form)
    setErrors(result)
    if (!result.ok) return
    setSaving(true)
    setSaveError(null)
    try {
      const payload = buildPayload(form)
      const saved = id ? await updateQuotation(id, payload) : await createQuotation(payload)
      setDirty(false)
      setAutosaveState('idle')
      // Adopt the server's identity before leaving, so a subsequent visit to this
      // editor has a real number to preview and print with.
      setId(saved.id)
      setServerNumber(saved.number || null)
      setServerStatus(saved.status || serverStatus)
      navigate(`/quotations/${saved.id}`)
    } catch (e) {
      setSaveError(e)
    } finally {
      setSaving(false)
    }
  }

  if (loadStatus === 'loading') {
    return (
      <div className={styles.editor}>
        <PageHeader eyebrow="Quotations" title="Edit quotation" />
        <Skeleton height="12rem" />
        <Skeleton height="8rem" />
      </div>
    )
  }

  if (loadStatus === 'error') {
    return (
      <div className={styles.editor}>
        <PageHeader eyebrow="Quotations" title="Edit quotation" />
        <p className={styles.message} role="alert">
          This quotation could not be loaded.{' '}
          <Button variant="ghost" size="sm" to="/quotations">
            Back to quotations
          </Button>
        </p>
      </div>
    )
  }

  const autosaveText = {
    saving: 'Saving…',
    saved: 'All changes saved',
    error: 'Autosave failed — use Save',
    idle: dirty ? 'Unsaved changes' : '',
  }[autosaveState]

  const isPercent = form.discount_type === 'percent'

  return (
    <div className={styles.editor}>
      <PageHeader
        eyebrow="Quotations"
        title={isEdit ? 'Edit quotation' : 'New quotation'}
        description="Pick a client, add line items and set tax — totals update as you type."
        actions={
          <>
            <Button variant="ghost" size="sm" icon="chevronLeft" to="/quotations">
              Cancel
            </Button>
            <Button variant="ghost" size="sm" icon="eye" onClick={() => setPreviewOpen(true)}>
              Preview
            </Button>
            <Button variant="primary" size="sm" icon="check" loading={saving} onClick={handleSave}>
              Save
            </Button>
          </>
        }
      />

      {autosaveText ? (
        <p className={styles.autosave} data-state={autosaveState} aria-live="polite">
          {autosaveText}
        </p>
      ) : null}

      {saveError ? (
        <p className={styles.message} role="alert">
          {saveError.message || 'The quotation could not be saved.'}
        </p>
      ) : null}

      <div className={styles.grid}>
        <div className={styles.main}>
          <Card className={styles.section}>
            <div className={styles.clientRow}>
              <div className={styles.clientInfo}>
                <span className={styles.fieldLabel}>Client</span>
                {form.client ? (
                  <span className={styles.clientName}>{form.client.name}</span>
                ) : (
                  <span className={styles.clientEmpty}>No client selected</span>
                )}
                {errors.fields.client_id ? (
                  <p className={styles.error} role="alert">
                    {errors.fields.client_id}
                  </p>
                ) : null}
              </div>
              <Button variant="secondary" size="sm" icon="user" onClick={() => setPickerOpen(true)}>
                {form.client ? 'Change' : 'Choose client'}
              </Button>
            </div>

            <div className={styles.dateRow}>
              <TextField
                label="Quotation date"
                type="date"
                value={form.quotation_date}
                onChange={(v) => patch({ quotation_date: v })}
                error={errors.fields.quotation_date}
              />
              <TextField
                label="Valid until"
                type="date"
                value={form.valid_until}
                onChange={(v) => patch({ valid_until: v })}
                hint="Optional"
              />
            </div>
          </Card>

          <Card className={styles.section}>
            <h2 className={styles.sectionTitle}>Items</h2>
            <ItemsEditor
              items={form.items}
              onChange={setItems}
              errors={errors.items}
              units={units}
              categories={categories}
            />
          </Card>

          <Card className={styles.section}>
            <h2 className={styles.sectionTitle}>Discount &amp; tax</h2>
            <div className={styles.chargeRow}>
              <TextField
                as="select"
                label="Discount type"
                value={form.discount_type}
                onChange={(v) => patch({ discount_type: v })}
              >
                <option value="percent">Percentage</option>
                <option value="fixed">Fixed amount</option>
              </TextField>
              {isPercent ? (
                <NumberInput
                  key="discount-percent"
                  label="Discount"
                  suffix="%"
                  defaultValue={form.discount_bp ? String(form.discount_bp / 100) : ''}
                  onCommit={(v) => patch({ discount_bp: Math.round((Number(v) || 0) * 100) })}
                  error={errors.fields.discount_bp}
                />
              ) : (
                <NumberInput
                  key="discount-fixed"
                  label="Discount"
                  prefix="₹"
                  defaultValue={paiseToInput(form.discount_fixed_paise)}
                  onCommit={(v) => patch({ discount_fixed_paise: rupeesToPaise(v) })}
                  error={errors.fields.discount_fixed_paise}
                />
              )}
              <NumberInput
                label="GST"
                suffix="%"
                defaultValue={form.gst_bp ? String(form.gst_bp / 100) : ''}
                onCommit={(v) => patch({ gst_bp: Math.round((Number(v) || 0) * 100) })}
                error={errors.fields.gst_bp}
              />
            </div>
            <div className={styles.chargeRow}>
              <TextField
                label="Other charges label"
                value={form.other_charges_label}
                onChange={(v) => patch({ other_charges_label: v })}
              />
              <NumberInput
                label="Other charges"
                prefix="₹"
                defaultValue={paiseToInput(form.other_charges_paise)}
                onCommit={(v) => patch({ other_charges_paise: rupeesToPaise(v) })}
                error={errors.fields.other_charges_paise}
              />
            </div>
          </Card>

          <Card className={styles.section}>
            <h2 className={styles.sectionTitle}>Terms &amp; notes</h2>
            <TextField
              as="textarea"
              label="Terms"
              rows={4}
              value={form.terms_text}
              onChange={(v) => patch({ terms_text: v })}
              hint="Shown on the quotation document"
            />
            <TextField
              as="textarea"
              label="Internal notes"
              rows={3}
              value={form.notes}
              onChange={(v) => patch({ notes: v })}
              hint="Not shown to the client"
            />
          </Card>
        </div>

        <aside className={styles.aside}>
          <TotalsPanel
            sticky
            totals={totals}
            gstBp={form.gst_bp}
            otherChargesLabel={form.other_charges_label}
          />
        </aside>
      </div>

      <QuotationPreview
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        document={buildPreviewDocument(form, totals, id, serverNumber)}
        settings={settings}
        logoSrc={logoSrc}
        isUnsaved={!id}
        onSave={handleSave}
        saving={saving}
      />

      <ClientPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(client) => {
          patch({ client, client_id: client.id })
          setPickerOpen(false)
        }}
      />
    </div>
  )
}
