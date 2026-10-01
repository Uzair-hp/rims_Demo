import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import ClientForm from './ClientForm.jsx'

/**
 * Client form — the required phone number (FR-C1, §4.2).
 *
 * The behaviours worth pinning are the ones a user notices. The field must not
 * complain while a number is still being typed (`90000` is a legitimate
 * intermediate state, not a wrong one), it must clean a pasted `+91 90000 12345`
 * into ten digits, it must block a save with a bad number, and it must show what
 * the *server* said when the server refused — a 409 duplicate naming another
 * client is knowledge no local rule has.
 *
 * The accept/reject sets are the ones in `backend/tests/test_clients.py`; the two
 * are a pair and `lib/phone.test.js` asserts the frontend mirrors them.
 */

function renderForm(props = {}) {
  const onSave = props.onSave ?? vi.fn()
  render(<ClientForm onSave={onSave} {...props} />)
  return { onSave }
}

const phoneField = () => screen.getByLabelText(/phone/i)
const nameField = () => screen.getByLabelText(/client name/i)
const submit = () => screen.getByRole('button', { name: /save client/i })

describe('Client form — phone field', () => {
  it('is a required telephone input with a numeric keypad', () => {
    renderForm()
    const field = phoneField()

    expect(field).toHaveAttribute('type', 'tel')
    expect(field).toHaveAttribute('inputmode', 'numeric')
    expect(field).toHaveAttribute('autocomplete', 'tel')
    expect(field).toBeRequired()
  })

  it('shows a fixed +91 prefix that is not part of the value', () => {
    renderForm()
    // The prefix is decoration: the stored number is bare digits, so submitting
    // the country code would store a number the API then rejects.
    expect(screen.getByText('+91')).toBeInTheDocument()
    expect(phoneField().value).toBe('')
  })

  it('groups the digits as they are typed', async () => {
    const user = userEvent.setup()
    renderForm()
    const field = phoneField()

    await user.type(field, '9000012345')
    expect(field).toHaveValue('90000 12345')
  })

  it('cleans a pasted +91 number into ten grouped digits', async () => {
    const user = userEvent.setup()
    renderForm()
    const field = phoneField()

    // The acceptance case from the brief, pasted rather than typed.
    await user.click(field)
    await user.paste('+91 90000 12345')
    expect(field).toHaveValue('90000 12345')
  })

  it('cleans a pasted 0-prefixed number with dashes', async () => {
    const user = userEvent.setup()
    renderForm()
    const field = phoneField()

    await user.click(field)
    await user.paste('090000-12345')
    expect(field).toHaveValue('90000 12345')
  })

  it('caps the field at ten digits', async () => {
    const user = userEvent.setup()
    renderForm()
    const field = phoneField()

    await user.type(field, '90000123456789')
    expect(field).toHaveValue('90000 12345')
  })
})

describe('Client form — phone validation', () => {
  it('says nothing on the way in, only once the field is left', async () => {
    const user = userEvent.setup()
    renderForm()
    const field = phoneField()

    // `9000` is four of ten digits. While the caret is still in the field nothing
    // is said: complaining at a user mid-number, on every keystroke, is the
    // single most irritating thing a form can do.
    await user.type(field, '9000')
    expect(screen.queryByText(/valid 10-digit/i)).toBeNull()

    // Completing it is silent too — a correct number never produces a message.
    await user.type(field, '012345')
    expect(screen.queryByText(/valid 10-digit/i)).toBeNull()

    await user.tab()
    expect(screen.queryByText(/valid 10-digit/i)).toBeNull()
  })

  it('rejects an incomplete number once the field is left', async () => {
    const user = userEvent.setup()
    renderForm()

    // Leaving a half-typed number is a real state worth reporting: the user has
    // moved on, so it will not be finished by accident.
    await user.type(phoneField(), '9000')
    await user.tab()
    expect(await screen.findByText(/valid 10-digit indian mobile number/i)).toBeInTheDocument()
  })

  it('reports a completed but invalid number on blur', async () => {
    const user = userEvent.setup()
    renderForm()
    const field = phoneField()

    await user.type(field, '5000012345')
    await user.tab()

    const error = await screen.findByText(/valid 10-digit indian mobile number/i)
    expect(error).toBeInTheDocument()
    expect(field).toHaveAttribute('aria-invalid', 'true')
  })

  it.each([
    ['2000', 'too short'],
    ['9999999999', 'all the same digit'],
    ['1234567890', 'an ascending run'],
    ['9876543210', 'a descending run'],
  ])('rejects %s (%s)', async (value) => {
    const user = userEvent.setup()
    renderForm()

    await user.type(phoneField(), value)
    await user.tab()
    expect(await screen.findByText(/valid 10-digit indian mobile number/i)).toBeInTheDocument()
  })

  it('requires a phone number at all', async () => {
    const user = userEvent.setup()
    const { onSave } = renderForm()

    await user.type(nameField(), 'Acme Decorators')
    // The submit control is disabled while the form is incomplete, so a save
    // without a phone is not merely rejected — it is not offered. Either way the
    // API is never asked to accept one.
    expect(submit()).toBeDisabled()

    // Submitting the form directly (Enter, or a form submit from assistive tech)
    // still marks the fields so the reason is visible rather than silent.
    await user.keyboard('{Enter}')
    await waitFor(() => {
      expect(onSave).not.toHaveBeenCalled()
    })
  })

  it('saves the ten bare digits, not the formatted field value', async () => {
    const user = userEvent.setup()
    const { onSave } = renderForm()

    await user.type(nameField(), 'Acme Decorators')
    await user.type(phoneField(), '+91 90000 12345')
    await user.click(submit())

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1)
    })
    // What the API stores is digits only; the grouping is presentation.
    expect(onSave.mock.calls[0][0].phone).toBe('9000012345')
  })

  it('enables save only when both required fields are valid', async () => {
    const user = userEvent.setup()
    renderForm()

    // Nothing typed: blocked on the name.
    expect(submit()).toBeDisabled()

    await user.type(nameField(), 'Acme Decorators')
    expect(submit()).toBeDisabled()

    await user.type(phoneField(), '9000')
    expect(submit()).toBeDisabled()

    await user.type(phoneField(), '012345')
    expect(submit()).toBeEnabled()
  })
})

describe('Client form — server errors', () => {
  it('shows a 409 duplicate message that names the client holding the number', () => {
    // No local rule can know another client already holds this number, so the
    // server's wording must survive to the field rather than being replaced by
    // the generic "not a valid number".
    renderForm({ errors: { phone: 'That phone number is already used by Acme Decorators.' } })

    expect(screen.getByText('That phone number is already used by Acme Decorators.')).toBeInTheDocument()
  })

  it('shows a server name error, which the previous version dropped', () => {
    // `ClientForm` used to short-circuit the name field to its own local rule
    // and discard the server's message for it entirely.
    renderForm({ errors: { name: 'A client name is required.' } })

    expect(screen.getByText('A client name is required.')).toBeInTheDocument()
  })
})

describe('Client form — seeding', () => {
  it('prefills the name for a create-as-new-client path', () => {
    // The picker's "create 'Acme' as a new client" arrives here already named.
    renderForm({ initial: { name: 'Acme' } })
    expect(nameField()).toHaveValue('Acme')
  })

  it('prefills a stored number for the edit path', () => {
    renderForm({ mode: 'edit', initial: { name: 'Acme', phone: '9000012345' } })
    expect(phoneField()).toHaveValue('90000 12345')
  })
})
