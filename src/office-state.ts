/** DB-style record types for future Postgres integration.
 *  The React state layer lives in office-provider.tsx. */

export type OfficePresenceState =
  | 'off_hours'
  | 'available'
  | 'active'
  | 'in_meeting'
  | 'paused'
  | 'blocked'

export interface OfficeAgentRecord {
  id: string
  name: string
  role: string
  team: string
  internalStaff: boolean
  officeVisible: boolean
  characterId: string | null
  spriteSheet: string | null
}

export interface OfficeRoomRecord {
  id: string
  name: string
  team: string
  purpose: string | null
  zoneX: number
  zoneY: number
  zoneW: number
  zoneH: number
}

export interface OfficePresenceRecord {
  agentId: string
  presenceState: OfficePresenceState
  effectivePresenceState: OfficePresenceState
  criticalTask: boolean
  focus: string | null
  collaborationMode: string | null
  officeHoursTimezone: string
  officeHoursDays: string
  officeHoursWindow: string
}

export interface OfficeWorldEntityRecord {
  agentId: string
  roomId: string
  anchorXPct: number
  anchorYPct: number
  facing: 'left' | 'right' | 'up' | 'down' | null
}

export interface OfficeAssignmentRecord {
  id: string
  targetAgentId: string
  taskTitle: string
  taskBrief: string
  priority: 'low' | 'medium' | 'high'
  status: 'queued' | 'routed' | 'active' | 'done' | 'blocked'
  routingTarget: 'agent_runtime' | 'work_tracker' | 'both'
  source: string
  createdAt: string
  updatedAt: string
}

export interface OfficeActivityRecord {
  id: string
  kind: 'assignment' | 'presence' | 'decision' | 'system'
  agentId: string | null
  roomId: string | null
  message: string
  createdAt: string
}

export interface OfficeDecisionRecord {
  id: string
  title: string
  detail: string
  createdAt: string
}

export interface AgentRuntimeStatus {
  agentId: string
  registered: boolean
  busy: boolean
  currentAssignmentId: string | null
}

export interface OfficeStateSnapshot {
  agents: OfficeAgentRecord[]
  rooms: OfficeRoomRecord[]
  presence: OfficePresenceRecord[]
  worldEntities: OfficeWorldEntityRecord[]
  assignments: OfficeAssignmentRecord[]
  activityFeed: OfficeActivityRecord[]
  decisions: OfficeDecisionRecord[]
}
