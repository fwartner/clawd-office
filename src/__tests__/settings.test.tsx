import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { App } from '../App'
import { OfficeProvider } from '../office-provider'

const TEST_SNAPSHOT = {
  agents: [],
  rooms: [
    { id: 'planning-studio', name: 'Planning Studio', team: 'Product + UX', purpose: 'Coordination', agents: [], zone: { x: 25, y: 3, w: 50, h: 27 } },
    { id: 'shipyard', name: 'Shipyard', team: 'Build', purpose: 'Engineering', agents: [], zone: { x: 2, y: 33, w: 58, h: 30 } },
    { id: 'systems-bay', name: 'Systems Bay', team: 'Platform', purpose: 'Architecture', agents: [], zone: { x: 62, y: 33, w: 36, h: 22 } },
    { id: 'commons', name: 'Commons', team: 'Shared Office', purpose: 'Shared space', agents: [], zone: { x: 2, y: 68, w: 58, h: 30 } },
    { id: 'signal-room', name: 'Signal Room', team: 'Ops', purpose: 'Operations', agents: [], zone: { x: 62, y: 60, w: 36, h: 38 } },
  ],
  agentSeats: {},
  workdayPolicy: { timezone: 'Europe/Berlin', days: 'Monday-Friday', hours: '09:00-17:00', pauseRule: 'Pause rule', sharedPlaceRule: 'Shared rule' },
  settings: {
    officeName: 'Test Office',
    theme: {
      presenceColors: {
        off_hours: '#8792a8',
        available: '#95d8ff',
        active: '#78f7b5',
        in_meeting: '#c39bff',
        paused: '#ffd479',
        blocked: '#ff8b8b'
      }
    }
  },
  activity: [],
  assignments: [],
  source: 'file',
  lastUpdatedAt: new Date().toISOString(),
}

function mockFetch() {
  vi.stubGlobal('fetch', vi.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(TEST_SNAPSHOT),
    })
  ))
}

async function renderApp() {
  mockFetch()
  await act(async () => {
    render(<OfficeProvider><App /></OfficeProvider>)
  })
  // Wait for poll
  await act(async () => {
    await new Promise(r => setTimeout(r, 50))
  })
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('Settings Panel', () => {
  it('Settings tab is visible', async () => {
    await renderApp()
    const settingsTab = screen.getByRole('tab', { name: 'Settings' })
    expect(settingsTab).toBeInTheDocument()
  })

  it('clicking Settings tab shows settings panel', async () => {
    await renderApp()
    const settingsTab = screen.getByRole('tab', { name: 'Settings' })
    await act(async () => {
      fireEvent.click(settingsTab)
    })
    // The General section should be visible (open by default)
    expect(screen.getByLabelText('Office name')).toBeInTheDocument()
  })

  it('shows all settings sections', async () => {
    await renderApp()
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: 'Settings' }))
    })
    expect(screen.getByText('General')).toBeInTheDocument()
    expect(screen.getByText('Workday Policy')).toBeInTheDocument()
    expect(screen.getByText('Rooms')).toBeInTheDocument()
    expect(screen.getByText('Theme')).toBeInTheDocument()
    expect(screen.getByText('Danger Zone')).toBeInTheDocument()
  })

  it('office name from settings is shown in header', async () => {
    await renderApp()
    expect(screen.getByText('Test Office')).toBeInTheDocument()
  })

  it('rooms section lists all rooms', async () => {
    await renderApp()
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: 'Settings' }))
    })
    // Open Rooms section
    await act(async () => {
      fireEvent.click(screen.getByText('Rooms'))
    })
    // Room names appear in both map overlays and settings; check at least one exists
    expect(screen.getAllByText('Planning Studio').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('Shipyard').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('Systems Bay').length).toBeGreaterThanOrEqual(2)
  })

  it('danger zone shows reset button', async () => {
    await renderApp()
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: 'Settings' }))
    })
    await act(async () => {
      fireEvent.click(screen.getByText('Danger Zone'))
    })
    expect(screen.getByText('Reset all settings to defaults')).toBeInTheDocument()
  })

  it('reset button shows confirmation', async () => {
    await renderApp()
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: 'Settings' }))
    })
    await act(async () => {
      fireEvent.click(screen.getByText('Danger Zone'))
    })
    await act(async () => {
      fireEvent.click(screen.getByText('Reset all settings to defaults'))
    })
    expect(screen.getByText('Reset all settings?')).toBeInTheDocument()
    expect(screen.getByText('Yes')).toBeInTheDocument()
    expect(screen.getByText('No')).toBeInTheDocument()
  })
})
