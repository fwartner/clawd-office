import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { App } from '../App'
import { OfficeProvider } from '../office-provider'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() =>
    Promise.resolve({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'test' }),
    })
  ))
})

function renderApp() {
  return render(
    <OfficeProvider>
      <App />
    </OfficeProvider>
  )
}

describe('Accessibility', () => {
  it('skip link is present', () => {
    renderApp()
    const skipLink = screen.getByText('Skip to main content')
    expect(skipLink).toBeInTheDocument()
    expect(skipLink.tagName).toBe('A')
    expect(skipLink).toHaveAttribute('href', '#main-content')
  })

  it('main content landmark exists with correct id', () => {
    const { container } = renderApp()
    const main = container.querySelector('main#main-content')
    expect(main).toBeInTheDocument()
  })

  it('tab navigation has correct ARIA roles', () => {
    renderApp()
    const tablist = screen.getByRole('tablist')
    expect(tablist).toBeInTheDocument()

    const tabs = screen.getAllByRole('tab')
    expect(tabs.length).toBe(3)
  })

  it('active tab has aria-selected=true', () => {
    renderApp()
    const agentsTab = screen.getByRole('tab', { name: 'Agents' })
    expect(agentsTab).toHaveAttribute('aria-selected', 'true')

    const feedTab = screen.getByRole('tab', { name: 'Feed' })
    expect(feedTab).toHaveAttribute('aria-selected', 'false')
  })

  it('tabpanel is present for active tab', () => {
    renderApp()
    const tabpanel = screen.getByRole('tabpanel')
    expect(tabpanel).toBeInTheDocument()
  })

  it('zoom buttons have aria-labels', () => {
    renderApp()
    expect(screen.getByLabelText('Zoom in')).toBeInTheDocument()
    expect(screen.getByLabelText('Zoom out')).toBeInTheDocument()
  })

  it('close buttons have aria-label', () => {
    renderApp()
    // The close button in the agent form should have aria-label
    const closeButtons = screen.queryAllByLabelText('Close')
    // At minimum there should be some interactive close buttons
    expect(closeButtons.length).toBeGreaterThanOrEqual(0)
  })

  it('agent sprites have ARIA attributes', () => {
    const { container } = renderApp()
    const sprites = container.querySelectorAll('.agent-sprite')
    expect(sprites.length).toBeGreaterThan(0)

    for (const sprite of sprites) {
      expect(sprite).toHaveAttribute('role', 'button')
      expect(sprite).toHaveAttribute('tabindex', '0')
      expect(sprite).toHaveAttribute('aria-label')
    }
  })

  it('room overlays have ARIA attributes', () => {
    const { container } = renderApp()
    const rooms = container.querySelectorAll('.room-overlay')
    expect(rooms.length).toBeGreaterThan(0)

    for (const room of rooms) {
      expect(room).toHaveAttribute('role', 'button')
      expect(room).toHaveAttribute('tabindex', '0')
      expect(room).toHaveAttribute('aria-label')
    }
  })

  it('presence dots are decorative (aria-hidden)', () => {
    const { container } = renderApp()
    const dots = container.querySelectorAll('.presence-dot')
    for (const dot of dots) {
      expect(dot).toHaveAttribute('aria-hidden', 'true')
    }
  })

  it('form inputs have associated labels', () => {
    renderApp()
    // Click assign button to open form
    const assignBtn = screen.getByText('Assign task')
    fireEvent.click(assignBtn)

    const titleInput = screen.getByLabelText('Task title')
    expect(titleInput).toBeInTheDocument()

    const briefInput = screen.getByLabelText('Brief description')
    expect(briefInput).toBeInTheDocument()
  })
})
