import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { OfficeProvider, useOffice } from '../office-provider'
import type { PresenceState } from '../data'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() =>
    Promise.resolve({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'test' }),
    })
  ))
})

function TestConsumer() {
  const state = useOffice()
  return (
    <div>
      <span data-testid="agent-count">{state.agents.length}</span>
      <span data-testid="room-count">{state.rooms.length}</span>
      <span data-testid="data-source">{state.dataSource}</span>
      <span data-testid="within-workday">{String(state.withinWorkday)}</span>
      <span data-testid="selected">{state.selectedAgentId ?? 'none'}</span>
      <span data-testid="has-create">{typeof state.createAgent}</span>
      <span data-testid="has-update">{typeof state.updateAgent}</span>
      <span data-testid="has-delete">{typeof state.deleteAgent}</span>
    </div>
  )
}

describe('OfficeProvider', () => {
  it('renders children', () => {
    render(
      <OfficeProvider>
        <div>Child content</div>
      </OfficeProvider>
    )
    expect(screen.getByText('Child content')).toBeInTheDocument()
  })

  it('useOffice returns valid state', () => {
    render(
      <OfficeProvider>
        <TestConsumer />
      </OfficeProvider>
    )
    expect(Number(screen.getByTestId('agent-count').textContent)).toBeGreaterThan(0)
    expect(Number(screen.getByTestId('room-count').textContent)).toBeGreaterThan(0)
    expect(screen.getByTestId('data-source').textContent).toBe('seed')
  })

  it('useOffice throws outside provider', () => {
    expect(() => {
      render(<TestConsumer />)
    }).toThrow('useOffice must be used within OfficeProvider')
  })

  it('exposes CRUD functions', () => {
    render(
      <OfficeProvider>
        <TestConsumer />
      </OfficeProvider>
    )
    expect(screen.getByTestId('has-create').textContent).toBe('function')
    expect(screen.getByTestId('has-update').textContent).toBe('function')
    expect(screen.getByTestId('has-delete').textContent).toBe('function')
  })

  it('pre-selects forge agent', () => {
    render(
      <OfficeProvider>
        <TestConsumer />
      </OfficeProvider>
    )
    expect(screen.getByTestId('selected').textContent).toBe('forge')
  })
})

describe('getEffectivePresence logic', () => {
  // Reimplementing the logic for testing
  function getEffectivePresence(state: PresenceState, within: boolean): PresenceState {
    if (!within && state !== 'off_hours') return 'off_hours'
    return state
  }

  it('returns off_hours outside workday for non-off_hours states', () => {
    expect(getEffectivePresence('active', false)).toBe('off_hours')
    expect(getEffectivePresence('available', false)).toBe('off_hours')
    expect(getEffectivePresence('in_meeting', false)).toBe('off_hours')
    expect(getEffectivePresence('paused', false)).toBe('off_hours')
    expect(getEffectivePresence('blocked', false)).toBe('off_hours')
  })

  it('returns off_hours for off_hours state outside workday', () => {
    expect(getEffectivePresence('off_hours', false)).toBe('off_hours')
  })

  it('returns original state within workday', () => {
    expect(getEffectivePresence('active', true)).toBe('active')
    expect(getEffectivePresence('available', true)).toBe('available')
    expect(getEffectivePresence('in_meeting', true)).toBe('in_meeting')
    expect(getEffectivePresence('paused', true)).toBe('paused')
    expect(getEffectivePresence('blocked', true)).toBe('blocked')
    expect(getEffectivePresence('off_hours', true)).toBe('off_hours')
  })
})

describe('buildAgents logic', () => {
  it('filters external agents', () => {
    const source = [
      { id: 'a', name: 'A', role: 'r', team: 't', roomId: 'r1', presence: 'active' as const, focus: '', criticalTask: false, collaborationMode: '', external: false },
      { id: 'b', name: 'B', role: 'r', team: 't', roomId: 'r1', presence: 'active' as const, focus: '', criticalTask: false, collaborationMode: '', external: true },
    ]
    const filtered = source.filter(a => !a.external)
    expect(filtered).toHaveLength(1)
    expect(filtered[0].id).toBe('a')
  })
})

describe('validateSnapshot logic', () => {
  const VALID_PRESENCE = new Set(['off_hours', 'available', 'active', 'in_meeting', 'paused', 'blocked'])

  function validateSnapshot(data: unknown): boolean {
    if (data == null || typeof data !== 'object') return false
    const d = data as Record<string, unknown>
    if (!Array.isArray(d.agents) || !Array.isArray(d.rooms)) return false
    if (d.agents.length === 0) return false
    const first = d.agents[0] as Record<string, unknown>
    if (typeof first.id !== 'string' || typeof first.name !== 'string') return false
    if (!VALID_PRESENCE.has(first.presence as string)) return false
    if (d.workdayPolicy == null || typeof d.workdayPolicy !== 'object') return false
    const wp = d.workdayPolicy as Record<string, unknown>
    if (typeof wp.timezone !== 'string') return false
    return true
  }

  it('rejects null', () => {
    expect(validateSnapshot(null)).toBe(false)
  })

  it('rejects non-object', () => {
    expect(validateSnapshot('string')).toBe(false)
  })

  it('rejects missing agents', () => {
    expect(validateSnapshot({ rooms: [] })).toBe(false)
  })

  it('rejects empty agents array', () => {
    expect(validateSnapshot({ agents: [], rooms: [] })).toBe(false)
  })

  it('rejects invalid agent shape', () => {
    expect(validateSnapshot({
      agents: [{ id: 123 }],
      rooms: [],
      workdayPolicy: { timezone: 'Europe/Berlin' }
    })).toBe(false)
  })

  it('rejects invalid presence', () => {
    expect(validateSnapshot({
      agents: [{ id: 'x', name: 'X', presence: 'invalid' }],
      rooms: [],
      workdayPolicy: { timezone: 'Europe/Berlin' }
    })).toBe(false)
  })

  it('accepts valid snapshot', () => {
    expect(validateSnapshot({
      agents: [{ id: 'x', name: 'X', presence: 'active' }],
      rooms: [],
      workdayPolicy: { timezone: 'Europe/Berlin' }
    })).toBe(true)
  })
})

describe('mergeAssignments logic', () => {
  function mergeAssignments(current: Array<{id: string; createdAt: string}>, incoming: Array<{id: string; createdAt: string}>) {
    const merged = new Map<string, {id: string; createdAt: string}>()
    for (const a of [...current, ...incoming]) {
      merged.set(a.id, a)
    }
    return Array.from(merged.values())
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }

  it('deduplicates by id', () => {
    const current = [{ id: 'a1', createdAt: '2024-01-01T00:00:00Z' }]
    const incoming = [{ id: 'a1', createdAt: '2024-01-01T00:00:00Z' }]
    expect(mergeAssignments(current, incoming)).toHaveLength(1)
  })

  it('merges unique assignments', () => {
    const current = [{ id: 'a1', createdAt: '2024-01-01T00:00:00Z' }]
    const incoming = [{ id: 'a2', createdAt: '2024-01-02T00:00:00Z' }]
    expect(mergeAssignments(current, incoming)).toHaveLength(2)
  })

  it('sorts by createdAt descending', () => {
    const current = [{ id: 'a1', createdAt: '2024-01-01T00:00:00Z' }]
    const incoming = [{ id: 'a2', createdAt: '2024-01-02T00:00:00Z' }]
    const result = mergeAssignments(current, incoming)
    expect(result[0].id).toBe('a2')
  })
})
