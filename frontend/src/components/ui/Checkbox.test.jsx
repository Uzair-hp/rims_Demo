import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import Checkbox from './Checkbox.jsx'

/**
 * Checkbox tests.
 *
 * The point of this component is that it is a *real* checkbox, so the tests care
 * about the native behaviour surviving the styling: it is focusable, it toggles
 * with the keyboard, and it is a `checkbox` to assistive technology. A rebuilt
 * box made of divs would pass a screenshot check and fail every one of these.
 */
describe('Checkbox', () => {
  function renderCheckbox(props = {}) {
    const onChange = props.onChange || vi.fn()
    render(<Checkbox label="Show archived" checked={false} onChange={onChange} {...props} />)
    return { onChange, input: screen.getByRole('checkbox', { name: 'Show archived' }) }
  }

  it('is a real checkbox with the given label', () => {
    const { input } = renderCheckbox()
    expect(input).toHaveAttribute('type', 'checkbox')
    expect(input).toBeInTheDocument()
  })

  it('reflects the checked prop', () => {
    const { input } = renderCheckbox({ checked: true })
    expect(input).toBeChecked()
  })

  it('reports the new value when clicked', async () => {
    const user = userEvent.setup()
    const { onChange } = renderCheckbox()

    await user.click(screen.getByRole('checkbox', { name: 'Show archived' }))
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('reports false when a checked box is clicked', async () => {
    const user = userEvent.setup()
    const { onChange } = renderCheckbox({ checked: true })

    await user.click(screen.getByRole('checkbox', { name: 'Show archived' }))
    expect(onChange).toHaveBeenCalledWith(false)
  })

  it('is reachable and operable with the keyboard', async () => {
    const user = userEvent.setup()
    const { onChange, input } = renderCheckbox()

    await user.tab()
    expect(input).toHaveFocus()
    // Space is the native checkbox key; this is the behaviour a div rebuild loses.
    await user.keyboard(' ')
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('toggles when the label text is clicked, not just the box', async () => {
    const user = userEvent.setup()
    const { onChange } = renderCheckbox()

    await user.click(screen.getByText('Show archived'))
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('gives each instance an independent id', () => {
    render(
      <>
        <Checkbox label="Show archived" checked={false} onChange={() => {}} />
        <Checkbox label="Show something else" checked={false} onChange={() => {}} />
      </>,
    )

    const [first, second] = screen.getAllByRole('checkbox')
    expect(first.id).toBeTruthy()
    expect(second.id).toBeTruthy()
    expect(first.id).not.toBe(second.id)
  })

  it('associates an optional hint with the control', () => {
    const { input } = renderCheckbox({ hint: 'Archived clients keep their history.' })
    const describedBy = input.getAttribute('aria-describedby')

    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy)).toHaveTextContent('Archived clients keep their history.')
  })
})
