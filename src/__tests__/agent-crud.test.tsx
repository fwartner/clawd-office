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

describe('Agent CRUD — Create', () => {
  it('create form renders with all fields', () => {
    renderApp()
    // Deselect agent, then open create form
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(screen.getByText('+ Add Agent'))

    expect(screen.getByPlaceholderText('Agent ID (lowercase, hyphens)')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Name')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Role')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Team')).toBeInTheDocument()
    expect(screen.getByText('Create agent')).toBeInTheDocument()
  })

  it('create form has required fields', () => {
    renderApp()
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(screen.getByText('+ Add Agent'))

    const idInput = screen.getByPlaceholderText('Agent ID (lowercase, hyphens)')
    expect(idInput).toHaveAttribute('required')
    expect(idInput).toHaveAttribute('aria-required', 'true')

    const nameInput = screen.getByPlaceholderText('Name')
    expect(nameInput).toHaveAttribute('required')
  })

  it('agent ID input has pattern for lowercase+hyphens', () => {
    renderApp()
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(screen.getByText('+ Add Agent'))

    const idInput = screen.getByPlaceholderText('Agent ID (lowercase, hyphens)')
    expect(idInput).toHaveAttribute('pattern', '[a-z0-9-]+')
  })
})

describe('Agent CRUD — Edit', () => {
  it('edit form pre-fills agent data', () => {
    renderApp()
    // Forge is pre-selected
    fireEvent.click(screen.getByText('Edit'))

    // Should show "Edit Forge"
    expect(screen.getByText('Edit Forge')).toBeInTheDocument()
    expect(screen.getByText('Save changes')).toBeInTheDocument()

    // Name field should be pre-filled
    const nameInput = screen.getByPlaceholderText('Name') as HTMLInputElement
    expect(nameInput.value).toBe('Forge')

    // Role field should be pre-filled
    const roleInput = screen.getByPlaceholderText('Role') as HTMLInputElement
    expect(roleInput.value).toBe('Full-stack builder')
  })

  it('edit form does not show ID field', () => {
    renderApp()
    fireEvent.click(screen.getByText('Edit'))

    expect(screen.queryByPlaceholderText('Agent ID (lowercase, hyphens)')).not.toBeInTheDocument()
  })

  it('edit form close button returns to detail card', () => {
    renderApp()
    fireEvent.click(screen.getByText('Edit'))
    expect(screen.getByText('Save changes')).toBeInTheDocument()

    // Close the form
    const closeButtons = screen.getAllByLabelText('Close')
    fireEvent.click(closeButtons[closeButtons.length - 1])

    // Should be back to detail card with Edit button
    expect(screen.getByText('Edit')).toBeInTheDocument()
  })
})

describe('Agent CRUD — Delete', () => {
  it('delete shows confirmation prompt', () => {
    renderApp()
    fireEvent.click(screen.getByText('Delete'))

    expect(screen.getByText('Delete?')).toBeInTheDocument()
    expect(screen.getByText('Yes')).toBeInTheDocument()
    expect(screen.getByText('No')).toBeInTheDocument()
  })

  it('No button cancels deletion', () => {
    renderApp()
    fireEvent.click(screen.getByText('Delete'))
    fireEvent.click(screen.getByText('No'))

    // Confirmation should be gone, Delete button should be back
    expect(screen.queryByText('Delete?')).not.toBeInTheDocument()
    expect(screen.getByText('Delete')).toBeInTheDocument()
  })
})

describe('Agent ID validation', () => {
  const AGENT_ID_RE = /^[a-z0-9-]+$/

  it('accepts lowercase alphanumeric with hyphens', () => {
    expect(AGENT_ID_RE.test('my-agent')).toBe(true)
    expect(AGENT_ID_RE.test('agent1')).toBe(true)
    expect(AGENT_ID_RE.test('a-b-c-123')).toBe(true)
  })

  it('rejects uppercase', () => {
    expect(AGENT_ID_RE.test('MyAgent')).toBe(false)
  })

  it('rejects spaces', () => {
    expect(AGENT_ID_RE.test('my agent')).toBe(false)
  })

  it('rejects special characters', () => {
    expect(AGENT_ID_RE.test('agent@1')).toBe(false)
    expect(AGENT_ID_RE.test('agent_1')).toBe(false)
    expect(AGENT_ID_RE.test('agent.1')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(AGENT_ID_RE.test('')).toBe(false)
  })
})
