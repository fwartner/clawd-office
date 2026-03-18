import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { App } from '../App'
import { OfficeProvider } from '../office-provider'

const TEST_AGENTS = [
  {
    id: 'forge', name: 'Forge', role: 'Full-stack builder', team: 'Build',
    roomId: 'shipyard', presence: 'active', focus: 'Building things',
    criticalTask: true, collaborationMode: 'Collaborative'
  },
]

const TEST_SNAPSHOT = {
  agents: TEST_AGENTS,
  rooms: [
    { id: 'planning-studio', name: 'Planning Studio', team: 'Product + UX', purpose: 'Coordination', agents: [], zone: { x: 25, y: 3, w: 50, h: 27 } },
    { id: 'shipyard', name: 'Shipyard', team: 'Build', purpose: 'Engineering', agents: ['forge'], zone: { x: 2, y: 33, w: 58, h: 30 } },
    { id: 'systems-bay', name: 'Systems Bay', team: 'Platform', purpose: 'Architecture', agents: [], zone: { x: 62, y: 33, w: 36, h: 22 } },
    { id: 'commons', name: 'Commons', team: 'Shared Office', purpose: 'Shared space', agents: [], zone: { x: 2, y: 68, w: 58, h: 30 } },
    { id: 'signal-room', name: 'Signal Room', team: 'Ops', purpose: 'Operations', agents: [], zone: { x: 62, y: 60, w: 36, h: 38 } },
  ],
  agentSeats: { forge: { xPct: 35, yPct: 45 } },
  workdayPolicy: { timezone: 'Europe/Berlin', days: 'Monday-Friday', hours: '09:00-17:00', pauseRule: 'Pause rule', sharedPlaceRule: 'Shared rule' },
  activity: [],
  assignments: [],
  source: 'file',
  lastUpdatedAt: new Date().toISOString(),
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (typeof url === 'string' && url.includes('/api/office/snapshot')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(TEST_SNAPSHOT),
      })
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    })
  }))
})

async function renderApp() {
  let result: ReturnType<typeof render>
  await act(async () => {
    result = render(
      <OfficeProvider>
        <App />
      </OfficeProvider>
    )
  })
  await act(async () => {
    await new Promise(r => setTimeout(r, 50))
  })
  return result!
}

describe('Accessibility', () => {
  it('skip link is present', async () => {
    await renderApp()
    const skipLink = screen.getByText('Skip to main content')
    expect(skipLink).toBeInTheDocument()
    expect(skipLink.tagName).toBe('A')
    expect(skipLink).toHaveAttribute('href', '#main-content')
  })

  it('main content landmark exists with correct id', async () => {
    const { container } = await renderApp()
    const main = container.querySelector('main#main-content')
    expect(main).toBeInTheDocument()
  })

  it('tab navigation has correct ARIA roles', async () => {
    await renderApp()
    const tablist = screen.getByRole('tablist')
    expect(tablist).toBeInTheDocument()

    const tabs = screen.getAllByRole('tab')
    expect(tabs.length).toBe(4)
  })

  it('active tab has aria-selected=true', async () => {
    await renderApp()
    const agentsTab = screen.getByRole('tab', { name: 'Agents' })
    expect(agentsTab).toHaveAttribute('aria-selected', 'true')

    const feedTab = screen.getByRole('tab', { name: 'Feed' })
    expect(feedTab).toHaveAttribute('aria-selected', 'false')
  })

  it('tabpanel is present for active tab', async () => {
    await renderApp()
    const tabpanel = screen.getByRole('tabpanel')
    expect(tabpanel).toBeInTheDocument()
  })

  it('zoom buttons have aria-labels', async () => {
    await renderApp()
    expect(screen.getByLabelText('Zoom in')).toBeInTheDocument()
    expect(screen.getByLabelText('Zoom out')).toBeInTheDocument()
  })

  it('agent sprites have ARIA attributes', async () => {
    const { container } = await renderApp()
    const sprites = container.querySelectorAll('.agent-sprite')
    expect(sprites.length).toBeGreaterThan(0)

    for (const sprite of sprites) {
      expect(sprite).toHaveAttribute('role', 'button')
      expect(sprite).toHaveAttribute('tabindex', '0')
      expect(sprite).toHaveAttribute('aria-label')
    }
  })

  it('room overlays have ARIA attributes', async () => {
    const { container } = await renderApp()
    const rooms = container.querySelectorAll('.room-overlay')
    expect(rooms.length).toBeGreaterThan(0)

    for (const room of rooms) {
      expect(room).toHaveAttribute('role', 'button')
      expect(room).toHaveAttribute('tabindex', '0')
      expect(room).toHaveAttribute('aria-label')
    }
  })

  it('welcome overlay has dialog role and aria-label', async () => {
    // Render with empty agents (failing fetch = seed data with empty agents)
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          ...TEST_SNAPSHOT,
          agents: [],
          agentSeats: {},
        }),
      })
    ))

    await act(async () => {
      render(
        <OfficeProvider>
          <App />
        </OfficeProvider>
      )
    })
    await act(async () => {
      await new Promise(r => setTimeout(r, 50))
    })

    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveAttribute('aria-label', 'Welcome to Clawd Office')
  })

  it('form inputs have associated labels', async () => {
    // Use snapshot with agents so we can test the assignment form
    await renderApp()
    // Select Forge first
    const forgeButtons = screen.getAllByText('Forge')
    const rosterButton = forgeButtons.find(el => el.closest('.roster-card'))
    if (rosterButton) fireEvent.click(rosterButton)

    const assignBtn = screen.getByText('Assign task')
    fireEvent.click(assignBtn)

    const titleInput = screen.getByLabelText('Task title')
    expect(titleInput).toBeInTheDocument()

    const briefInput = screen.getByLabelText('Brief description')
    expect(briefInput).toBeInTheDocument()
  })
})
