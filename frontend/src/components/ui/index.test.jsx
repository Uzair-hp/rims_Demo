import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Button from './Button.jsx'
import EmptyState from './EmptyState.jsx'

const wrapper = ({ children }) => <MemoryRouter>{children}</MemoryRouter>

describe('Button', () => {
  it('renders a real button by default', () => {
    render(<Button>Save</Button>)
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'button')
  })

  it('honours an explicit type for form submits', () => {
    render(<Button type="submit">Sign in</Button>)
    expect(screen.getByRole('button', { name: 'Sign in' })).toHaveAttribute('type', 'submit')
  })

  it('renders a link when given a destination', () => {
    render(<Button to="/quotations/new">New quotation</Button>, { wrapper })
    expect(screen.getByRole('link', { name: 'New quotation' })).toHaveAttribute('href', '/quotations/new')
  })

  it('disables itself and reports busy state while loading', () => {
    render(<Button loading>Save</Button>)
    const button = screen.getByRole('button')
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
  })
})

describe('EmptyState', () => {
  it('shows the title, guidance and one action', () => {
    render(
      <EmptyState
        icon="fileText"
        title="No quotations yet"
        message="Quotations arrive in Phase 2."
        actionLabel="Start a quotation"
        actionTo="/quotations/new"
      />,
      { wrapper },
    )

    expect(screen.getByRole('heading', { name: 'No quotations yet' })).toBeInTheDocument()
    expect(screen.getByText('Quotations arrive in Phase 2.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Start a quotation/ })).toHaveAttribute('href', '/quotations/new')
  })

  it('omits the action when the next step does not exist yet', () => {
    render(<EmptyState icon="receipt" title="Invoices arrive in Phase 3" />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
