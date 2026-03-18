/**
 * JSON file-backed ApiContext — preserves backward compatibility with
 * state/office-snapshot.json while the new DB layer is wired in.
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  MAX_NAME_LEN, MAX_ROLE_LEN, MAX_BRIEF_LEN, MAX_TITLE_LEN,
  MAX_SYSTEM_PROMPT_LEN, MAX_MESSAGE_LEN, VALID_PRESENCE, WEBHOOK_EVENTS,
  type AgentPatch,
} from './validation.js'
import type { ApiContext, SnapshotData } from './api-routes.js'

let writeLock = Promise.resolve()
function withLock<T>(fn: () => T): Promise<T> {
  const p = writeLock.then(fn, fn)
  writeLock = p.then(() => {}, () => {})
  return p
}

export function createJsonContext(stateFile: string, resultsDir: string): ApiContext {
  function read(): Record<string, unknown> {
    return JSON.parse(fs.readFileSync(stateFile, 'utf-8'))
  }
  function write(state: Record<string, unknown>) {
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2))
  }
  function now() { return new Date().toISOString() }

  const ctx: ApiContext = {
    resultsDir,

    async getSnapshot(): Promise<SnapshotData> {
      const s = read()
      return {
        agents: (s.agents as unknown[]) || [],
        rooms: (s.rooms as unknown[]) || [],
        agentSeats: (s.agentSeats as Record<string, unknown>) || {},
        workdayPolicy: s.workdayPolicy || {},
        activity: (s.activity as unknown[]) || [],
        assignments: (s.assignments as unknown[]) || [],
        decisions: (s.decisions as unknown[]) || [],
        messages: (s.messages as unknown[]) || [],
        webhooks: (s.webhooks as unknown[]) || [],
        webhookLogs: (s.webhookLogs as unknown[]) || [],
        settings: s.settings,
        source: (s.source as string) || 'file',
        lastUpdatedAt: (s.lastUpdatedAt as string) || now(),
      }
    },

    async getAgent(id) {
      const s = read()
      const agents = (s.agents as Record<string, unknown>[]) || []
      return agents.find(a => a.id === id) || null
    },

    async createAgent(input) {
      return withLock(() => {
        const s = read()
        const agents = (s.agents as Record<string, unknown>[]) || []
        if (agents.find(a => a.id === input.id)) throw new Error('already exists')
        agents.push({
          id: input.id, name: input.name, role: input.role, team: input.team,
          roomId: input.roomId, presence: input.presence || 'available',
          focus: input.focus || '', criticalTask: input.criticalTask || false,
          collaborationMode: input.collaborationMode || '',
          systemPrompt: input.systemPrompt ? String(input.systemPrompt).slice(0, MAX_SYSTEM_PROMPT_LEN) : '',
        })
        s.agents = agents
        const seats = (s.agentSeats as Record<string, unknown>) || {}
        seats[String(input.id)] = { xPct: 50, yPct: 50 }
        s.agentSeats = seats
        s.lastUpdatedAt = now()
        write(s)
        return { id: String(input.id) }
      })
    },

    async updateAgent(id, input) {
      return withLock(() => {
        const s = read()
        const agents = (s.agents as Record<string, unknown>[]) || []
        const agent = agents.find(a => a.id === id)
        if (!agent) return false
        if (input.name) agent.name = input.name
        if (input.role) agent.role = input.role
        if (input.team) agent.team = input.team
        if (input.roomId) agent.roomId = input.roomId
        if (input.presence) agent.presence = input.presence
        if (typeof input.focus === 'string') agent.focus = input.focus
        if (typeof input.criticalTask === 'boolean') agent.criticalTask = input.criticalTask
        if (typeof input.collaborationMode === 'string') agent.collaborationMode = input.collaborationMode
        s.lastUpdatedAt = now()
        write(s)
        return true
      })
    },

    async patchAgent(id, patch) {
      return withLock(() => {
        const s = read()
        const agents = (s.agents as Record<string, unknown>[]) || []
        const agent = agents.find(a => a.id === id)
        if (!agent) return false
        for (const [k, v] of Object.entries(patch)) agent[k] = v
        s.lastUpdatedAt = now()
        write(s)
        return true
      })
    },

    async deleteAgent(id) {
      return withLock(() => {
        const s = read()
        const agents = (s.agents as Record<string, unknown>[]) || []
        const idx = agents.findIndex(a => a.id === id)
        if (idx === -1) return false
        agents.splice(idx, 1)
        s.agents = agents
        const seats = (s.agentSeats as Record<string, unknown>) || {}
        delete seats[id]
        s.agentSeats = seats
        const assignments = (s.assignments as Record<string, unknown>[]) || []
        s.assignments = assignments.filter(a => a.targetAgentId !== id)
        s.lastUpdatedAt = now()
        write(s)
        return true
      })
    },

    async createAssignment(input) {
      return withLock(() => {
        const s = read()
        const assignments = (s.assignments as Record<string, unknown>[]) || []
        const assignment = {
          id: `assignment-${Date.now()}`,
          targetAgentId: String(input.targetAgentId),
          taskTitle: String(input.taskTitle),
          taskBrief: input.taskBrief ? String(input.taskBrief) : '',
          priority: String(input.priority),
          routingTarget: String(input.routingTarget),
          status: 'queued',
          createdAt: now(),
        }
        assignments.push(assignment)
        s.assignments = assignments
        s.lastUpdatedAt = now()
        write(s)
        return { id: assignment.id, status: 'queued' }
      })
    },

    async updateAssignment(id, status, result) {
      return withLock(() => {
        const s = read()
        const assignments = (s.assignments as Record<string, unknown>[]) || []
        const assignment = assignments.find(a => a.id === id)
        if (!assignment) return false
        assignment.status = status
        if (typeof result === 'string') {
          assignment.result = result
          assignment.resultAction = 'visible'
        }
        if (status === 'done' && result) {
          const activity = (s.activity as Record<string, unknown>[]) || []
          activity.unshift({ id: `act-${Date.now()}`, kind: 'assignment', text: `Task "${assignment.taskTitle}" completed with result`, agentId: assignment.targetAgentId, createdAt: now() })
          s.activity = activity.slice(0, 100)
        }
        s.lastUpdatedAt = now()
        write(s)
        return true
      })
    },

    async getAssignment(id) {
      const s = read()
      const assignments = (s.assignments as Record<string, unknown>[]) || []
      return assignments.find(a => a.id === id) || null
    },

    async listAssignments(filters) {
      const s = read()
      let list = (s.assignments as Record<string, unknown>[]) || []
      if (filters.status) list = list.filter(a => a.status === filters.status)
      if (filters.agent) list = list.filter(a => a.targetAgentId === filters.agent)
      return list.slice(0, filters.limit || 100)
    },

    async saveResult(id) {
      return withLock(() => {
        const s = read()
        const assignments = (s.assignments as Record<string, unknown>[]) || []
        const a = assignments.find(x => x.id === id)
        if (a) {
          a.resultSavedAt = now()
          a.resultAction = 'saved'
          s.lastUpdatedAt = now()
          write(s)
        }
        return true
      })
    },

    async appendActivity(entry) {
      return withLock(() => {
        const s = read()
        const activity = (s.activity as Record<string, unknown>[]) || []
        activity.unshift({
          id: `act-${Date.now()}`,
          kind: String(entry.kind ?? 'system'),
          text: String(entry.text ?? ''),
          agentId: entry.agentId ? String(entry.agentId) : undefined,
          createdAt: now(),
        })
        s.activity = activity.slice(0, 100)
        s.lastUpdatedAt = now()
        write(s)
      }) as unknown as Promise<void>
    },

    async createDecision(input) {
      const decision = {
        id: `decision-${Date.now()}`,
        title: String(input.title).slice(0, MAX_TITLE_LEN),
        detail: String(input.detail).slice(0, MAX_BRIEF_LEN),
        status: 'proposed',
        proposedBy: input.proposedBy ? String(input.proposedBy) : null,
        createdAt: now(),
      }
      await withLock(() => {
        const s = read()
        const decisions = (s.decisions as Record<string, unknown>[]) || []
        decisions.unshift(decision)
        s.decisions = decisions
        const activity = (s.activity as Record<string, unknown>[]) || []
        activity.unshift({ id: `act-${Date.now()}`, kind: 'decision', text: `Decision proposed: "${decision.title}"`, createdAt: now() })
        s.activity = activity.slice(0, 100)
        s.lastUpdatedAt = now()
        write(s)
      })
      return decision
    },

    async updateDecision(id, input) {
      return withLock(() => {
        const s = read()
        const decisions = (s.decisions as Record<string, unknown>[]) || []
        const decision = decisions.find(d => d.id === id)
        if (!decision) return false
        if (input.status) decision.status = input.status
        if (typeof input.title === 'string') decision.title = String(input.title).slice(0, MAX_TITLE_LEN)
        if (typeof input.detail === 'string') decision.detail = String(input.detail).slice(0, MAX_BRIEF_LEN)
        s.lastUpdatedAt = now()
        write(s)
        return true
      })
    },

    async sendMessage(input) {
      const msg = {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        fromAgentId: String(input.fromAgentId),
        toAgentId: input.toAgentId ? String(input.toAgentId) : null,
        roomId: input.roomId ? String(input.roomId) : null,
        message: String(input.message).slice(0, MAX_MESSAGE_LEN),
        createdAt: now(),
      }
      await withLock(() => {
        const s = read()
        const messages = (s.messages as Record<string, unknown>[]) || []
        messages.push(msg)
        s.messages = messages.slice(-200)
        s.lastUpdatedAt = now()
        write(s)
      })
      return msg
    },

    async listMessages(filters) {
      const s = read()
      let msgs = (s.messages as Record<string, unknown>[]) || []
      if (filters.room) msgs = msgs.filter(m => m.roomId === filters.room)
      if (filters.agent) msgs = msgs.filter(m => m.fromAgentId === filters.agent || m.toAgentId === filters.agent)
      return msgs.slice(-50)
    },

    async createRoom(input) {
      return withLock(() => {
        const s = read()
        const rooms = (s.rooms as Record<string, unknown>[]) || []
        if (rooms.find(r => r.id === input.id)) throw new Error('Room exists')
        const zone = input.zone as Record<string, number>
        rooms.push({
          id: input.id,
          name: String(input.name).slice(0, MAX_NAME_LEN),
          team: String(input.team).slice(0, MAX_ROLE_LEN),
          purpose: String(input.purpose).slice(0, MAX_BRIEF_LEN),
          agents: [],
          zone: { x: zone.x, y: zone.y, w: zone.w, h: zone.h },
        })
        s.rooms = rooms
        s.lastUpdatedAt = now()
        write(s)
        return { id: String(input.id) }
      })
    },

    async updateRoom(id, input) {
      return withLock(() => {
        const s = read()
        const rooms = (s.rooms as Record<string, unknown>[]) || []
        const room = rooms.find(r => r.id === id)
        if (!room) return false
        if (typeof input.name === 'string') room.name = input.name.slice(0, MAX_NAME_LEN)
        if (typeof input.team === 'string') room.team = input.team.slice(0, MAX_ROLE_LEN)
        if (typeof input.purpose === 'string') room.purpose = input.purpose.slice(0, MAX_BRIEF_LEN)
        s.lastUpdatedAt = now()
        write(s)
        return true
      })
    },

    async deleteRoom(id) {
      return withLock(() => {
        const s = read()
        const rooms = (s.rooms as Record<string, unknown>[]) || []
        const idx = rooms.findIndex(r => r.id === id)
        if (idx === -1) return false
        rooms.splice(idx, 1)
        s.rooms = rooms
        const agents = (s.agents as Record<string, unknown>[]) || []
        for (const agent of agents) {
          if (agent.roomId === id) agent.roomId = 'commons'
        }
        s.lastUpdatedAt = now()
        write(s)
        return true
      })
    },

    async createWebhook(input) {
      const webhook = {
        id: `webhook-${Date.now()}`,
        url: String(input.url),
        secret: input.secret ? String(input.secret) : '',
        events: Array.isArray(input.events) ? (input.events as string[]).filter(e => WEBHOOK_EVENTS.includes(e as typeof WEBHOOK_EVENTS[number])) : [],
        enabled: true,
        createdAt: now(),
      }
      await withLock(() => {
        const s = read()
        const webhooks = (s.webhooks as Record<string, unknown>[]) || []
        webhooks.push(webhook)
        s.webhooks = webhooks
        s.lastUpdatedAt = now()
        write(s)
      })
      return webhook
    },

    async deleteWebhook(id) {
      return withLock(() => {
        const s = read()
        const webhooks = (s.webhooks as Record<string, unknown>[]) || []
        s.webhooks = webhooks.filter(w => w.id !== id)
        s.lastUpdatedAt = now()
        write(s)
        return true
      })
    },

    async logWebhookDelivery(webhookId, event, statusCode) {
      await withLock(() => {
        const s = read()
        const logs = (s.webhookLogs as Record<string, unknown>[]) || []
        logs.unshift({ id: `whl-${Date.now()}`, webhookId, event, statusCode, deliveredAt: now() })
        s.webhookLogs = logs.slice(0, 20)
        write(s)
      })
    },

    async updateSettings(input) {
      return withLock(() => {
        const s = read()
        const settings = (s.settings as Record<string, unknown>) || {}
        if (typeof input.officeName === 'string') settings.officeName = input.officeName.slice(0, MAX_NAME_LEN)
        if (input.theme && typeof input.theme === 'object') {
          const theme = (settings.theme as Record<string, unknown>) || {}
          const inputTheme = input.theme as Record<string, unknown>
          if (inputTheme.presenceColors && typeof inputTheme.presenceColors === 'object') {
            const colors = (theme.presenceColors as Record<string, string>) || {}
            const inputColors = inputTheme.presenceColors as Record<string, string>
            for (const key of VALID_PRESENCE) {
              if (typeof inputColors[key] === 'string' && /^#[0-9a-fA-F]{6}$/.test(inputColors[key])) {
                colors[key] = inputColors[key]
              }
            }
            theme.presenceColors = colors
          }
          settings.theme = theme
        }
        if (input.workdayPolicy && typeof input.workdayPolicy === 'object') {
          const wp = (s.workdayPolicy as Record<string, unknown>) || {}
          const iwp = input.workdayPolicy as Record<string, string>
          if (typeof iwp.timezone === 'string') wp.timezone = iwp.timezone.slice(0, 100)
          if (typeof iwp.days === 'string') wp.days = iwp.days.slice(0, 100)
          if (typeof iwp.hours === 'string') wp.hours = iwp.hours.slice(0, 100)
          if (typeof iwp.pauseRule === 'string') wp.pauseRule = iwp.pauseRule.slice(0, MAX_BRIEF_LEN)
          if (typeof iwp.sharedPlaceRule === 'string') wp.sharedPlaceRule = iwp.sharedPlaceRule.slice(0, MAX_BRIEF_LEN)
          s.workdayPolicy = wp
        }
        s.settings = settings
        s.lastUpdatedAt = now()
        write(s)
        return settings
      })
    },
  }

  return ctx
}
