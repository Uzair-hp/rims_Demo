import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import Sheet from './Sheet.jsx'

const wrapper = ({ children }) => <MemoryRouter>{children}</MemoryRouter>

describe('Sheet', () => {
  it('renders nothing while closed', () => {
    render(
      <Sheet open={false} onClose={() => {}} title="More">
        <p>Body</p>
      </Sheet>,
      { wrapper },
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('exposes a labelled modal dialog when open', () => {
    render(
      <Sheet open onClose={() => {}} title="More">
        <p>Body</p>
      </Sheet>,
      { wrapper },
    )

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleName('More')
  })

  it('closes on the close button', async () => {
    const onClose = vi.fn()
    render(
      <Sheet open onClose={onClose} title="More">
        <p>Body</p>
      </Sheet>,
      { wrapper },
    )

    await userEvent.click(screen.getByRole('button', { name: 'Close More' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('closes on Escape', async () => {
    const onClose = vi.fn()
    render(
      <Sheet open onClose={onClose} title="Create new">
        <p>Body</p>
      </Sheet>,
      { wrapper },
    )

    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
  })
})
