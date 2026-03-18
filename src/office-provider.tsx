import { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback, type ReactNode } from 'react'
import { agents as seedAgents, rooms as seedRooms, agentSeats as seedSeats, workdayPolicy as seedPolicy, type AgentCard, type PresenceState, type Room, type WorkdayPolicy } from './data'
import { characterSprites, worldEntities, type ActivityItem, type AssignmentRecord } from './world'

export interface OfficeAgent extends AgentCard {
  effectivePresence: PresenceState
  characterId: string
}

export interface AgentCreateInput {
  id: string; name: string; role: string; team: string; roomId: string
  presence?: PresenceState; focus?: string; criticalTask?: boolean; collaborationMode?: string
}

export interface AgentUpdateInput {
  name?: string; role?: string; team?: string; roomId?: string
  presence?: PresenceState; focus?: string; criticalTask?: boolean; collaborationMode?: string
}

interface OfficeState {
  agents: OfficeAgent[]
  rooms: Room[]
  agentSeats: Record<string, { xPct: number; yPct: number }>
  workdayPolicy: WorkdayPolicy
  assignments: AssignmentRecord[]
  activity: ActivityItem[]
  selectedAgentId: string | null
  berlinTimeLabel: string
  withinWorkday: boolean
  dataSource: 'seed' | 'live'
  connectionError: string | null
  selectAgent: (agentId: string | null) => void
  assignTask: (input: {
    targetAgentId: string
    taskTitle: string
    taskBrief: string
    priority: 'low' | 'medium' | 'high'
    routingTarget: 'agent_runtime' | 'work_tracker' | 'both'
  }) => void
  createAgent: (input: AgentCreateInput) => Promise<boolean>
  updateAgent: (id: string, input: AgentUpdateInput) => Promise<boolean>
  deleteAgent: (id: string) => Promise<boolean>
}

const OfficeContext = createContext<OfficeState | null>(null)

function getBerlinNow(tz: string) {
  try {
    const f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false
    })
    const parts = f.formatToParts(new Date())
    const weekday = parts.find(p => p.type === 'weekday')?.value ?? 'Mon'
    const hour = Number(parts.find(p => p.type === 'hour')?.value ?? '0')
    const minute = Number(parts.find(p => p.type === 'minute')?.value ?? '0')
    return { weekday, hour, minute, label: f.format(new Date()) }
  } catch {
    // Invalid timezone fallback
    return { weekday: 'Mon', hour: 0, minute: 0, label: 'Unknown' }
  }
}

function isWithinWorkday(tz: string) {
  const { weekday, hour, minute } = getBerlinNow(tz)
  const ok = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(weekday)
  const t = hour * 60 + minute
  return ok && t >= 540 && t < 1020
}

function getEffectivePresence(state: PresenceState, within: boolean): PresenceState {
  if (!within && state !== 'off_hours') return 'off_hours'
  return state
}

const VALID_PRESENCE: Set<string> = new Set(['off_hours', 'available', 'active', 'in_meeting', 'paused', 'blocked'])

function isValidPresence(v: unknown): v is PresenceState {
  return typeof v === 'string' && VALID_PRESENCE.has(v)
}

/** Validate that an API response looks like a valid snapshot */
function validateSnapshot(data: unknown): data is ApiSnapshot {
  if (data == null || typeof data !== 'object') return false
  const d = data as Record<string, unknown>
  if (!Array.isArray(d.agents) || !Array.isArray(d.rooms)) return false
  if (d.agents.length === 0) return false
  // Spot-check first agent
  const first = d.agents[0] as Record<string, unknown>
  if (typeof first.id !== 'string' || typeof first.name !== 'string') return false
  if (!isValidPresence(first.presence)) return false
  // Check rooms
  const firstRoom = d.rooms[0] as Record<string, unknown> | undefined
  if (firstRoom && (typeof firstRoom.id !== 'string' || !firstRoom.zone)) return false
  // Check workdayPolicy
  if (d.workdayPolicy == null || typeof d.workdayPolicy !== 'object') return false
  const wp = d.workdayPolicy as Record<string, unknown>
  if (typeof wp.timezone !== 'string') return false
  return true
}

function buildAgents(source: AgentCard[], within: boolean): OfficeAgent[] {
  return source
    .filter(agent => !agent.external)
    .map(agent => ({
      ...agent,
      effectivePresence: getEffectivePresence(agent.presence, within),
      characterId: worldEntities[agent.id]?.characterId ?? agent.id
    }))
}

const INITIAL_ACTIVITY: ActivityItem[] = [
  { id: 'boot-1', kind: 'system', text: 'Office opened. Seed state loaded.', createdAt: new Date().toISOString() },
]

interface ApiSnapshot {
  agents: AgentCard[]
  rooms: Room[]
  agentSeats: Record<string, { xPct: number; yPct: number }>
  workdayPolicy: WorkdayPolicy
  activity?: ActivityItem[]
  assignments?: AssignmentRecord[]
  source: string
  lastUpdatedAt: string
}

function normalizeAssignment(assignment: AssignmentRecord): AssignmentRecord {
  return {
    ...assignment,
    taskBrief: assignment.taskBrief ?? '',
    source: assignment.source ?? 'system',
  }
}

function mergeAssignments(current: AssignmentRecord[], incoming: AssignmentRecord[]): AssignmentRecord[] {
  const merged = new Map<string, AssignmentRecord>()
  for (const assignment of [...current, ...incoming].map(normalizeAssignment)) {
    merged.set(assignment.id, assignment)
  }
  return Array.from(merged.values())
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

const BASE_POLL_MS = 4000
const MAX_POLL_MS = 30000
const TASK_PICKUP_DELAY_MS  = 3_000   // queued → routed
const TASK_ACTIVE_DELAY_MS  = 8_000   // routed → active
const TASK_PROCESS_INTERVAL = 2_000   // check interval
const MAX_ASSIGNMENTS       = 25
const MAX_ACTIVITY_ITEMS    = 50

export function OfficeProvider({ children }: { children: ReactNode }) {
  const [rawAgents, setRawAgents] = useState<AgentCard[]>(seedAgents)
  const [currentRooms, setCurrentRooms] = useState<Room[]>(seedRooms)
  const [currentSeats, setCurrentSeats] = useState(seedSeats)
  const [currentPolicy, setCurrentPolicy] = useState<WorkdayPolicy>(seedPolicy)
  const [dataSource, setDataSource] = useState<'seed' | 'live'>('seed')
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>('forge')
  const [berlinTimeLabel, setBerlinTimeLabel] = useState(getBerlinNow(seedPolicy.timezone).label)
  const [withinWorkday, setWithinWorkday] = useState(isWithinWorkday(seedPolicy.timezone))
  const [agents, setAgents] = useState<OfficeAgent[]>(() => buildAgents(seedAgents, isWithinWorkday(seedPolicy.timezone)))
  const [assignments, setAssignments] = useState<AssignmentRecord[]>([])
  const [activity, setActivity] = useState<ActivityItem[]>(INITIAL_ACTIVITY)
  const wasLive = useRef(false)
  const consecutiveFailures = useRef(0)

  // Poll for live state from API with exponential backoff
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>

    async function poll() {
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 8000)
        const res = await fetch('/api/office/snapshot', { signal: controller.signal })
        clearTimeout(timeout)

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`)
        }

        const data: unknown = await res.json()
        if (cancelled) return

        if (!validateSnapshot(data)) {
          throw new Error('Invalid snapshot shape from API')
        }

        consecutiveFailures.current = 0
        setConnectionError(null)
        setRawAgents(data.agents)
        setCurrentRooms(data.rooms)
        setCurrentSeats(data.agentSeats)
        setCurrentPolicy(data.workdayPolicy)
        if (data.activity && data.activity.length > 0) {
          setActivity(data.activity)
        }
        if (data.assignments) {
          setAssignments(current => mergeAssignments(current, data.assignments ?? []))
        }
        if (!wasLive.current) {
          wasLive.current = true
          setDataSource('live')
        }
      } catch (err) {
        if (cancelled) return
        consecutiveFailures.current++
        // Only show error after being live then losing connection, or after many failures
        if (wasLive.current) {
          setConnectionError('Connection lost — using last known state')
          setDataSource('seed')
          wasLive.current = false
        } else if (consecutiveFailures.current > 3) {
          setConnectionError('Backend unavailable — running on seed data')
        }
      }

      if (!cancelled) {
        // Exponential backoff: 4s -> 8s -> 16s -> 30s max
        const delay = Math.min(BASE_POLL_MS * Math.pow(2, Math.min(consecutiveFailures.current, 3)), MAX_POLL_MS)
        timer = setTimeout(poll, delay)
      }
    }

    poll()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [])

  // Tick clock and rebuild agents on time change or data change
  useEffect(() => {
    const tick = () => {
      const tz = currentPolicy.timezone
      const nextWithin = isWithinWorkday(tz)
      setBerlinTimeLabel(getBerlinNow(tz).label)
      setWithinWorkday(nextWithin)
      setAgents(buildAgents(rawAgents, nextWithin))
    }
    tick()
    const timer = setInterval(tick, 750)
    return () => clearInterval(timer)
  }, [rawAgents, currentPolicy.timezone])

  // ── Helpers: push activity + patch agent (used by task processor & assignTask) ──
  const processedTransitions = useRef<Set<string>>(new Set())

  function addActivity(entry: { kind: ActivityItem['kind']; text: string; agentId?: string }) {
    const item: ActivityItem = {
      id: `activity-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      kind: entry.kind,
      text: entry.text,
      agentId: entry.agentId,
      createdAt: new Date().toISOString(),
    }
    setActivity(current => [item, ...current].slice(0, MAX_ACTIVITY_ITEMS))
    fetch('/api/office/activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item),
    }).catch(err => { if (import.meta.env.DEV) console.warn('[office]', err) })
  }

  function patchAgent(agentId: string, patch: { presence?: PresenceState; focus?: string }) {
    setRawAgents(current =>
      current.map(a => a.id === agentId ? { ...a, ...patch } : a)
    )
    fetch(`/api/office/agent/${agentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).catch(err => { if (import.meta.env.DEV) console.warn('[office]', err) })
  }

  function patchAssignmentOnServer(assignmentId: string, status: string) {
    fetch('/api/office/assignment/' + assignmentId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    }).catch(err => { if (import.meta.env.DEV) console.warn('[office]', err) })
  }

  // ── Task processing: progress assignments through their lifecycle ──
  // Uses a ref-based dedup set so each transition fires exactly once,
  // even when the poll re-delivers old server state.
  useEffect(() => {
    const timer = setInterval(() => {
      setAssignments(current => {
        let changed = false
        const updated = current.map(a => {
          const age = Date.now() - new Date(a.createdAt).getTime()

          // queued → routed (agent picks up the task, ~3s)
          if (a.status === 'queued' && age > TASK_PICKUP_DELAY_MS) {
            const key = `${a.id}:routed`
            if (!processedTransitions.current.has(key)) {
              processedTransitions.current.add(key)
              const name = rawAgents.find(ag => ag.id === a.targetAgentId)?.name ?? a.targetAgentId
              addActivity({ kind: 'system', text: `${name} picked up "${a.taskTitle}"`, agentId: a.targetAgentId })
              patchAgent(a.targetAgentId, { presence: 'active', focus: `Working on: ${a.taskTitle}` })
              patchAssignmentOnServer(a.id, 'routed')
            }
            changed = true
            return { ...a, status: 'routed' as const }
          }

          // routed → active (agent begins work, ~8s)
          if (a.status === 'routed' && age > TASK_ACTIVE_DELAY_MS) {
            const key = `${a.id}:active`
            if (!processedTransitions.current.has(key)) {
              processedTransitions.current.add(key)
              const name = rawAgents.find(ag => ag.id === a.targetAgentId)?.name ?? a.targetAgentId
              addActivity({ kind: 'assignment', text: `${name} is actively working on "${a.taskTitle}"`, agentId: a.targetAgentId })
              patchAssignmentOnServer(a.id, 'active')
            }
            changed = true
            return { ...a, status: 'active' as const }
          }

          return a
        })
        return changed ? updated : current
      })
    }, TASK_PROCESS_INTERVAL)
    return () => clearInterval(timer)
  }, [rawAgents])

  const assignTask: OfficeState['assignTask'] = useCallback((input) => {
    // Validate input
    const title = input.taskTitle?.trim()
    if (!title) return
    if (!input.targetAgentId) return

    const now = new Date().toISOString()
    const agent = rawAgents.find(a => a.id === input.targetAgentId)

    // Optimistic local update
    const assignment: AssignmentRecord = {
      id: `assignment-${Date.now()}`,
      targetAgentId: input.targetAgentId,
      taskTitle: title,
      taskBrief: input.taskBrief?.trim() ?? '',
      priority: input.priority,
      status: 'queued',
      routingTarget: input.routingTarget,
      createdAt: now,
      source: 'office_ui'
    }
    setAssignments(current => [assignment, ...current].slice(0, MAX_ASSIGNMENTS))

    addActivity({
      kind: 'assignment',
      text: `Assigned "${title}" to ${agent?.name ?? input.targetAgentId}`,
      agentId: input.targetAgentId,
    })

    // POST to server — log failure to activity feed
    fetch('/api/office/assign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetAgentId: input.targetAgentId,
        taskTitle: title,
        taskBrief: input.taskBrief?.trim() ?? '',
        priority: input.priority,
        routingTarget: input.routingTarget,
      })
    }).then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    }).catch(() => {
      addActivity({
        kind: 'system',
        text: `Failed to persist assignment "${title}" — saved locally only`,
      })
    })
  }, [rawAgents])

  const createAgent = useCallback(async (input: AgentCreateInput): Promise<boolean> => {
    // Optimistic local update
    const newAgent: AgentCard = {
      id: input.id, name: input.name, role: input.role, team: input.team,
      roomId: input.roomId, presence: input.presence ?? 'available',
      focus: input.focus ?? '', criticalTask: input.criticalTask ?? false,
      collaborationMode: input.collaborationMode ?? ''
    }
    setRawAgents(current => [...current, newAgent])
    setCurrentSeats(current => ({ ...current, [input.id]: { xPct: 50, yPct: 50 } }))
    addActivity({ kind: 'system', text: `Agent ${input.name} created` })
    try {
      const res = await fetch('/api/office/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }))
        // Revert
        setRawAgents(current => current.filter(a => a.id !== input.id))
        setCurrentSeats(current => { const next = { ...current }; delete next[input.id]; return next })
        addActivity({ kind: 'system', text: `Failed to create agent: ${err.error}` })
        return false
      }
      return true
    } catch {
      setRawAgents(current => current.filter(a => a.id !== input.id))
      setCurrentSeats(current => { const next = { ...current }; delete next[input.id]; return next })
      addActivity({ kind: 'system', text: 'Failed to create agent — network error' })
      return false
    }
  }, [])

  const updateAgent = useCallback(async (id: string, input: AgentUpdateInput): Promise<boolean> => {
    // Save old state for revert
    const oldAgent = rawAgents.find(a => a.id === id)
    if (!oldAgent) return false
    // Optimistic update
    setRawAgents(current =>
      current.map(a => a.id === id ? { ...a, ...input } as AgentCard : a)
    )
    addActivity({ kind: 'system', text: `Agent ${oldAgent.name} updated`, agentId: id })
    try {
      const res = await fetch(`/api/office/agent/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
      })
      if (!res.ok) {
        setRawAgents(current => current.map(a => a.id === id ? oldAgent : a))
        addActivity({ kind: 'system', text: 'Failed to update agent — server error' })
        return false
      }
      return true
    } catch {
      setRawAgents(current => current.map(a => a.id === id ? oldAgent : a))
      addActivity({ kind: 'system', text: 'Failed to update agent — network error' })
      return false
    }
  }, [rawAgents])

  const deleteAgent = useCallback(async (id: string): Promise<boolean> => {
    const oldAgents = rawAgents
    const oldSeats = currentSeats
    const oldAssignments = assignments
    const agent = rawAgents.find(a => a.id === id)
    // Optimistic removal
    setRawAgents(current => current.filter(a => a.id !== id))
    setCurrentSeats(current => { const next = { ...current }; delete next[id]; return next })
    setAssignments(current => current.filter(a => a.targetAgentId !== id))
    setSelectedAgentId(current => current === id ? null : current)
    addActivity({ kind: 'system', text: `Agent ${agent?.name ?? id} deleted` })
    try {
      const res = await fetch(`/api/office/agent/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        setRawAgents(oldAgents)
        setCurrentSeats(oldSeats)
        setAssignments(oldAssignments)
        addActivity({ kind: 'system', text: 'Failed to delete agent — server error' })
        return false
      }
      return true
    } catch {
      setRawAgents(oldAgents)
      setCurrentSeats(oldSeats)
      setAssignments(oldAssignments)
      addActivity({ kind: 'system', text: 'Failed to delete agent — network error' })
      return false
    }
  }, [rawAgents, currentSeats, assignments])

  const value = useMemo<OfficeState>(() => ({
    agents,
    rooms: currentRooms,
    agentSeats: currentSeats,
    workdayPolicy: currentPolicy,
    assignments,
    activity,
    selectedAgentId,
    berlinTimeLabel,
    withinWorkday,
    dataSource,
    connectionError,
    selectAgent: setSelectedAgentId,
    assignTask,
    createAgent,
    updateAgent,
    deleteAgent
  }), [agents, currentRooms, currentSeats, currentPolicy, assignments, activity, selectedAgentId, berlinTimeLabel, withinWorkday, dataSource, connectionError, assignTask, createAgent, updateAgent, deleteAgent])

  return <OfficeContext.Provider value={value}>{children}</OfficeContext.Provider>
}

export function useOffice() {
  const ctx = useContext(OfficeContext)
  if (!ctx) throw new Error('useOffice must be used within OfficeProvider')
  return ctx
}

export { characterSprites, worldEntities }
