export type PresenceState =
  | 'off_hours'
  | 'available'
  | 'active'
  | 'in_meeting'
  | 'paused'
  | 'blocked'

export interface AgentCard {
  id: string
  name: string
  role: string
  team: string
  roomId: string
  presence: PresenceState
  focus: string
  criticalTask: boolean
  collaborationMode: string
  /** Is this agent an external collaborator (not firm office staff)? */
  external?: boolean
}

export interface Room {
  id: string
  name: string
  team: string
  purpose: string
  agents: string[]
  /** Position zone on the Office Level 4 map (percentage-based) */
  zone: { x: number; y: number; w: number; h: number }
}

export interface WorkdayPolicy {
  timezone: string
  days: string
  hours: string
  pauseRule: string
  sharedPlaceRule: string
}

export interface ThemeSettings {
  presenceColors: Record<PresenceState, string>
}

export interface OfficeSettings {
  officeName: string
  theme: ThemeSettings
}

export interface RoomUpdateInput {
  name?: string
  team?: string
  purpose?: string
}

export const defaultPresenceColors: Record<PresenceState, string> = {
  off_hours: '#8792a8',
  available: '#95d8ff',
  active: '#78f7b5',
  in_meeting: '#c39bff',
  paused: '#ffd479',
  blocked: '#ff8b8b'
}

export const defaultSettings: OfficeSettings = {
  officeName: 'Clawd Office',
  theme: {
    presenceColors: { ...defaultPresenceColors }
  }
}

export interface OfficeSnapshot {
  agents: AgentCard[]
  rooms: Room[]
  agentSeats: Record<string, { xPct: number; yPct: number }>
  workdayPolicy: WorkdayPolicy
  settings?: OfficeSettings
  source: 'seed' | 'file' | 'postgres'
  lastUpdatedAt: string
}

export const workdayPolicy: WorkdayPolicy = {
  timezone: 'Europe/Berlin',
  days: 'Monday-Friday',
  hours: '09:00-17:00',
  pauseRule: 'After non-critical tasks, agents should move to paused to save tokens until the next meaningful task arrives.',
  sharedPlaceRule: 'The office is the shared place where all agents work together, coordinate by room, and expose their current state.'
}

export const agents: AgentCard[] = []

export const rooms: Room[] = [
  {
    id: 'planning-studio',
    name: 'Planning Studio',
    team: 'Product + UX',
    purpose: 'Scope, flows, and meeting-driven coordination',
    agents: [],
    zone: { x: 25, y: 3, w: 50, h: 27 }
  },
  {
    id: 'shipyard',
    name: 'Shipyard',
    team: 'Build',
    purpose: 'Implementation room for active engineering work',
    agents: [],
    zone: { x: 2, y: 33, w: 58, h: 30 }
  },
  {
    id: 'systems-bay',
    name: 'Systems Bay',
    team: 'Platform',
    purpose: 'Architecture and systems decisions that support the whole office',
    agents: [],
    zone: { x: 62, y: 33, w: 36, h: 22 }
  },
  {
    id: 'commons',
    name: 'Commons',
    team: 'Shared Office',
    purpose: 'The shared place where all agents gather, coordinate, and expose presence together',
    agents: [],
    zone: { x: 2, y: 68, w: 58, h: 30 }
  },
  {
    id: 'signal-room',
    name: 'Signal Room',
    team: 'Ops',
    purpose: 'Status, reporting, decisions, and operational visibility',
    agents: [],
    zone: { x: 62, y: 60, w: 36, h: 38 }
  }
]

/** Seat positions for agents within their room zones (percentage offsets within the zone) */
export const agentSeats: Record<string, { xPct: number; yPct: number }> = {}

export const seedOfficeSnapshot: OfficeSnapshot = {
  agents,
  rooms,
  agentSeats,
  workdayPolicy,
  source: 'seed',
  lastUpdatedAt: new Date().toISOString()
}
