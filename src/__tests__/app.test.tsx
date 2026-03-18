import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { App } from '../App'
import { OfficeProvider } from '../office-provider'

// Mock fetch to prevent actual API calls
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

describe('App', () => {
  it('renders without crashing', () => {
    renderApp()
    expect(screen.getByText('OpenClaw Virtual Office')).toBeInTheDocument()
  })

  it('header shows office status', () => {
    renderApp()
    const statusElements = screen.getAllByText(/^Open$|^Closed$/)
    expect(statusElements.length).toBeGreaterThan(0)
  })

  it('presence summary shows correct heading', () => {
    renderApp()
    expect(screen.getByText('Presence')).toBeInTheDocument()
  })

  it('tab navigation has Agents, Feed, All Tasks', () => {
    renderApp()
    expect(screen.getByRole('tab', { name: 'Agents' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Feed' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /All Tasks/ })).toBeInTheDocument()
  })

  it('tab navigation switches tabs', () => {
    renderApp()
    const feedTab = screen.getByRole('tab', { name: 'Feed' })
    fireEvent.click(feedTab)
    expect(feedTab).toHaveAttribute('aria-selected', 'true')
  })

  it('agent roster renders agents', () => {
    renderApp()
    // Seed data includes Forge — may appear multiple times (sprite + roster + detail)
    const forgeElements = screen.getAllByText('Forge')
    expect(forgeElements.length).toBeGreaterThan(0)
  })

  it('clicking an agent shows detail card', () => {
    renderApp()
    // Forge is pre-selected, detail card with role should be visible
    const roleElements = screen.getAllByText('Full-stack builder')
    expect(roleElements.length).toBeGreaterThan(0)
  })

  it('detail card shows agent fields', () => {
    renderApp()
    // Forge is pre-selected, detail card visible
    expect(screen.getByText('Role')).toBeInTheDocument()
    expect(screen.getByText('Team')).toBeInTheDocument()
    expect(screen.getByText('Room')).toBeInTheDocument()
  })

  it('Escape key deselects agent', () => {
    renderApp()
    // Forge is pre-selected, detail card has Role dt
    expect(screen.getByText('Role')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    // After escape, detail card dt elements should be gone
    expect(screen.queryByText('Role')).not.toBeInTheDocument()
  })

  it('arrow keys navigate agents', () => {
    renderApp()
    // Pre-selected: Forge
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    // Should move to next agent — detail card updates
    const archElements = screen.getAllByText('Technical architecture')
    expect(archElements.length).toBeGreaterThan(0)
  })

  it('assign task button opens form', () => {
    renderApp()
    // Forge is pre-selected
    const assignBtn = screen.getByText('Assign task')
    fireEvent.click(assignBtn)
    expect(screen.getByText('Queue assignment')).toBeInTheDocument()
  })

  it('Add Agent button is present', () => {
    renderApp()
    expect(screen.getByText('+ Add Agent')).toBeInTheDocument()
  })

  it('Edit and Delete buttons are visible in detail card', () => {
    renderApp()
    // Forge is pre-selected
    expect(screen.getByText('Edit')).toBeInTheDocument()
    expect(screen.getByText('Delete')).toBeInTheDocument()
  })

  it('Delete button shows confirmation', () => {
    renderApp()
    const deleteBtn = screen.getByText('Delete')
    fireEvent.click(deleteBtn)
    expect(screen.getByText('Delete?')).toBeInTheDocument()
    expect(screen.getByText('Yes')).toBeInTheDocument()
    expect(screen.getByText('No')).toBeInTheDocument()
  })

  it('Edit button opens agent form', () => {
    renderApp()
    const editBtn = screen.getByText('Edit')
    fireEvent.click(editBtn)
    expect(screen.getByText('Save changes')).toBeInTheDocument()
  })

  it('Add Agent button opens create form', () => {
    renderApp()
    // Deselect agent first
    fireEvent.keyDown(window, { key: 'Escape' })
    const addBtn = screen.getByText('+ Add Agent')
    fireEvent.click(addBtn)
    expect(screen.getByText('Create agent')).toBeInTheDocument()
  })
})
