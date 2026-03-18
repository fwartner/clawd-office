import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { App } from '../App'
import { OfficeProvider } from '../office-provider'

// Test agents for mocking fetch responses
const TEST_AGENTS = [
  {
    id: 'forge', name: 'Forge', role: 'Full-stack builder', team: 'Build',
    roomId: 'shipyard', presence: 'active', focus: 'Building things',
    criticalTask: true, collaborationMode: 'Collaborative'
  },
  {
    id: 'northstar', name: 'Northstar', role: 'Technical architecture', team: 'Platform',
    roomId: 'systems-bay', presence: 'available', focus: 'Reviewing architecture',
    criticalTask: false, collaborationMode: 'Advisory'
  },
]

const TEST_SNAPSHOT = {
  agents: TEST_AGENTS,
  rooms: [
    { id: 'planning-studio', name: 'Planning Studio', team: 'Product + UX', purpose: 'Coordination', agents: [], zone: { x: 25, y: 3, w: 50, h: 27 } },
    { id: 'shipyard', name: 'Shipyard', team: 'Build', purpose: 'Engineering', agents: ['forge'], zone: { x: 2, y: 33, w: 58, h: 30 } },
    { id: 'systems-bay', name: 'Systems Bay', team: 'Platform', purpose: 'Architecture', agents: ['northstar'], zone: { x: 62, y: 33, w: 36, h: 22 } },
    { id: 'commons', name: 'Commons', team: 'Shared Office', purpose: 'Shared space', agents: [], zone: { x: 2, y: 68, w: 58, h: 30 } },
    { id: 'signal-room', name: 'Signal Room', team: 'Ops', purpose: 'Operations', agents: [], zone: { x: 62, y: 60, w: 36, h: 38 } },
  ],
  agentSeats: { forge: { xPct: 35, yPct: 45 }, northstar: { xPct: 50, yPct: 50 } },
  workdayPolicy: { timezone: 'Europe/Berlin', days: 'Monday-Friday', hours: '09:00-17:00', pauseRule: 'Pause rule', sharedPlaceRule: 'Shared rule' },
  activity: [],
  assignments: [],
  source: 'file',
  lastUpdatedAt: new Date().toISOString(),
}

function mockFetchWithAgents() {
  vi.stubGlobal('fetch', vi.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(TEST_SNAPSHOT),
    })
  ))
}

function mockFetchFailing() {
  vi.stubGlobal('fetch', vi.fn(() =>
    Promise.resolve({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'test' }),
    })
  ))
}

function renderApp() {
  return render(
    <OfficeProvider>
      <App />
    </OfficeProvider>
  )
}

describe('App — with agents (via API)', () => {
  beforeEach(() => {
    mockFetchWithAgents()
  })

  it('renders without crashing', async () => {
    renderApp()
    expect(screen.getByText('Agent Office')).toBeInTheDocument()
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

  it('tab navigation has Agents, Feed, Tasks', () => {
    renderApp()
    expect(screen.getByRole('tab', { name: 'Agents' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Feed' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Tasks/ })).toBeInTheDocument()
  })

  it('tab navigation switches tabs', () => {
    renderApp()
    const feedTab = screen.getByRole('tab', { name: 'Feed' })
    fireEvent.click(feedTab)
    expect(feedTab).toHaveAttribute('aria-selected', 'true')
  })

  it('Add Agent button is present', () => {
    renderApp()
    expect(screen.getByText('+ Add Agent')).toBeInTheDocument()
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

describe('App — empty office (seed fallback)', () => {
  beforeEach(() => {
    mockFetchFailing()
  })

  it('renders without crashing with empty agents', () => {
    renderApp()
    expect(screen.getByText('Agent Office')).toBeInTheDocument()
  })

  it('shows empty roster message', () => {
    renderApp()
    expect(screen.getByText('No agents yet. Add one to get started.')).toBeInTheDocument()
  })

  it('does not show welcome overlay while on seed data', () => {
    renderApp()
    // The overlay only shows when dataSource is 'live' and agents are empty
    // On seed fallback, overlay should not appear (prevents flash)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
