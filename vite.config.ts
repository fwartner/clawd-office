import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { registerAgent, unregisterAgent, dispatchTask, getAllAgentStatuses, startTaskQueue, shutdownAll } from './agent-runtime.mjs'

// __dirname works here because Vite transpiles its config with esbuild
const STATE_FILE = path.resolve(__dirname, 'state/office-snapshot.json')
const LINEAR_BRIDGE = process.env.LINEAR_BRIDGE_PATH || path.resolve(__dirname, 'scripts/create_linear_task_and_dispatch.py')

const MAX_BODY_SIZE = 1_048_576 // 1MB
const MAX_TITLE_LEN = 200
const MAX_BRIEF_LEN = 2000
const MAX_FOCUS_LEN = 500
const MAX_NAME_LEN = 100
const MAX_ROLE_LEN = 200
const VALID_PRESENCE = ['off_hours', 'available', 'active', 'in_meeting', 'paused', 'blocked']
const AGENT_PATCH_FIELDS = ['presence', 'focus', 'roomId', 'criticalTask', 'collaborationMode']
const AGENT_ID_RE = /^[a-z0-9-]+$/

function readBody(req: import('http').IncomingMessage, limit: number = MAX_BODY_SIZE): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    let size = 0
    const timeout = setTimeout(() => reject(new Error('Request timeout')), 10_000)
    req.on('data', (chunk: Buffer | string) => {
      size += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length
      if (size > limit) { reject(new Error('Body too large')); req.destroy(); return }
      body += chunk
    })
    req.on('end', () => { clearTimeout(timeout); resolve(body) })
    req.on('error', (e) => { clearTimeout(timeout); reject(e) })
  })
}

function sanitizePatch(raw: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {}
  for (const key of AGENT_PATCH_FIELDS) {
    if (key in raw) clean[key] = raw[key]
  }
  return clean
}

function runLinearBridge(input: {
  targetAgentId: string
  taskTitle: string
  taskBrief?: string
  priority: string
  origin?: string
}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    execFile('python3', [
      LINEAR_BRIDGE,
      '--agent', String(input.targetAgentId),
      '--title', String(input.taskTitle),
      '--brief', String(input.taskBrief ?? ''),
      '--priority', String(input.priority),
      '--origin', String(input.origin ?? 'office_ui'),
    ], { timeout: 180_000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message))
        return
      }
      try {
        resolve(JSON.parse(stdout || '{}'))
      } catch {
        resolve({ ok: true, raw: stdout })
      }
    })
  })
}

let writeLock = Promise.resolve()
function withLock(fn: () => void) {
  writeLock = writeLock.then(fn, fn)
  return writeLock
}

function createStateCallbacks() {
  return {
    onStart(assignmentId: string) {
      withLock(() => {
        const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'))
        if (!state.assignments) state.assignments = []
        const assignment = state.assignments.find((a: { id: string }) => a.id === assignmentId)
        if (!assignment) return
        assignment.status = 'active'
        assignment.updatedAt = new Date().toISOString()
        // Update agent presence
        const agent = state.agents.find((a: { id: string }) => a.id === assignment.targetAgentId)
        if (agent) {
          agent.presence = 'active'
          agent.focus = `Working on: ${assignment.taskTitle}`
        }
        // Add activity
        if (!state.activity) state.activity = []
        state.activity.unshift({
          id: `act-${Date.now()}`,
          kind: 'assignment',
          text: `${agent?.name ?? assignment.targetAgentId} started working on "${assignment.taskTitle}"`,
          agentId: assignment.targetAgentId,
          createdAt: new Date().toISOString()
        })
        state.activity = state.activity.slice(0, 100)
        state.lastUpdatedAt = new Date().toISOString()
        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
      })
    },
    onComplete(assignmentId: string, result: string) {
      withLock(() => {
        const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'))
        if (!state.assignments) state.assignments = []
        const assignment = state.assignments.find((a: { id: string }) => a.id === assignmentId)
        if (!assignment) return
        assignment.status = 'done'
        assignment.result = result
        assignment.resultAction = 'visible'
        assignment.updatedAt = new Date().toISOString()
        // Update agent presence
        const agent = state.agents.find((a: { id: string }) => a.id === assignment.targetAgentId)
        if (agent) {
          agent.presence = 'available'
          agent.focus = `Completed: ${assignment.taskTitle}`
        }
        // Add activity
        if (!state.activity) state.activity = []
        state.activity.unshift({
          id: `act-${Date.now()}`,
          kind: 'assignment',
          text: `${agent?.name ?? assignment.targetAgentId} completed "${assignment.taskTitle}"`,
          agentId: assignment.targetAgentId,
          createdAt: new Date().toISOString()
        })
        state.activity = state.activity.slice(0, 100)
        state.lastUpdatedAt = new Date().toISOString()
        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
      })
    },
    onError(assignmentId: string, error: string) {
      withLock(() => {
        const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'))
        if (!state.assignments) state.assignments = []
        const assignment = state.assignments.find((a: { id: string }) => a.id === assignmentId)
        if (!assignment) return
        assignment.status = 'blocked'
        assignment.updatedAt = new Date().toISOString()
        // Update agent presence
        const agent = state.agents.find((a: { id: string }) => a.id === assignment.targetAgentId)
        if (agent) {
          agent.presence = 'blocked'
          agent.focus = `Error: ${error.slice(0, 100)}`
        }
        // Add activity
        if (!state.activity) state.activity = []
        state.activity.unshift({
          id: `act-${Date.now()}`,
          kind: 'system',
          text: `Task "${assignment.taskTitle}" failed: ${error.slice(0, 200)}`,
          agentId: assignment.targetAgentId,
          createdAt: new Date().toISOString()
        })
        state.activity = state.activity.slice(0, 100)
        state.lastUpdatedAt = new Date().toISOString()
        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
      })
    }
  }
}

function officeApiPlugin(): Plugin {
  return {
    name: 'office-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        // GET /api/office/snapshot — return current state file
        if (req.method === 'GET' && req.url === '/api/office/snapshot') {
          try {
            const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'))
            if (!state.assignments) state.assignments = []
            if (!state.activity) state.activity = []
            state.agentRuntimeStatuses = getAllAgentStatuses()
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(state))
          } catch {
            res.statusCode = 500
            res.end(JSON.stringify({ error: 'State file not found' }))
          }
          return
        }

        // PATCH /api/office/agent/:id — update a single agent's fields
        const agentMatch = req.url?.match(/^\/api\/office\/agent\/([a-z0-9-]+)$/)
        if (req.method === 'PATCH' && agentMatch) {
          try {
            const raw = JSON.parse(await readBody(req))
            if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
              res.statusCode = 400
              res.end(JSON.stringify({ error: 'Body must be a JSON object' }))
              return
            }
            const patch = sanitizePatch(raw)
            if (Object.keys(patch).length === 0) {
              res.statusCode = 400
              res.end(JSON.stringify({ error: 'No valid fields to update' }))
              return
            }
            if ('presence' in patch && !VALID_PRESENCE.includes(patch.presence as string)) {
              res.statusCode = 400
              res.end(JSON.stringify({ error: `Invalid presence value. Must be one of: ${VALID_PRESENCE.join(', ')}` }))
              return
            }
            await withLock(() => {
              const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'))
              const agent = state.agents.find((a: { id: string }) => a.id === agentMatch[1])
              if (!agent) {
                res.statusCode = 404
                res.end(JSON.stringify({ error: 'Agent not found' }))
                return
              }
              for (const [k, v] of Object.entries(patch)) agent[k] = v
              state.lastUpdatedAt = new Date().toISOString()
              fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ ok: true, agent }))
            })
          } catch (err) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: String(err) }))
          }
          return
        }

        // PATCH /api/office/assignment/:id — update assignment status (+ optional result)
        const assignMatch = req.url?.match(/^\/api\/office\/assignment\/([a-z0-9-]+)$/)
        if (req.method === 'PATCH' && assignMatch) {
          try {
            const raw = JSON.parse(await readBody(req))
            if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
              res.statusCode = 400
              res.end(JSON.stringify({ error: 'Body must be a JSON object' }))
              return
            }
            const validStatuses = ['queued', 'routed', 'active', 'done', 'blocked']
            if (!raw.status || !validStatuses.includes(raw.status as string)) {
              res.statusCode = 400
              res.end(JSON.stringify({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` }))
              return
            }
            if (raw.result !== undefined && raw.status !== 'done') {
              res.statusCode = 400
              res.end(JSON.stringify({ error: 'result can only be provided when status is done' }))
              return
            }
            if (raw.result !== undefined && typeof raw.result === 'string' && raw.result.length > MAX_BRIEF_LEN) {
              res.statusCode = 400
              res.end(JSON.stringify({ error: 'result too long (max 2000 chars)' }))
              return
            }
            await withLock(() => {
              const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'))
              if (!state.assignments) state.assignments = []
              const assignment = state.assignments.find((a: { id: string }) => a.id === assignMatch[1])
              if (!assignment) {
                res.statusCode = 404
                res.end(JSON.stringify({ error: 'Assignment not found' }))
                return
              }
              assignment.status = raw.status
              if (typeof raw.result === 'string') {
                assignment.result = raw.result
                assignment.resultAction = 'visible'
              }
              state.lastUpdatedAt = new Date().toISOString()
              // Auto-create activity for completion with result
              if (raw.status === 'done' && raw.result) {
                if (!state.activity) state.activity = []
                state.activity.unshift({
                  id: `act-${Date.now()}`,
                  kind: 'assignment',
                  text: `Task "${assignment.taskTitle}" completed with result`,
                  agentId: assignment.targetAgentId,
                  createdAt: new Date().toISOString()
                })
                state.activity = state.activity.slice(0, 100)
              }
              fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ ok: true, assignment }))
            })
          } catch (err) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: String(err) }))
          }
          return
        }

        // POST /api/office/assign — queue an assignment
        if (req.method === 'POST' && req.url === '/api/office/assign') {
          try {
            const input = JSON.parse(await readBody(req))
            if (typeof input !== 'object' || input === null || Array.isArray(input)) {
              res.statusCode = 400
              res.end(JSON.stringify({ error: 'Body must be a JSON object' }))
              return
            }
            const missing = ['targetAgentId', 'taskTitle', 'priority', 'routingTarget'].filter(f => !input[f])
            if (missing.length > 0) {
              res.statusCode = 400
              res.end(JSON.stringify({ error: `Missing required fields: ${missing.join(', ')}` }))
              return
            }
            const VALID_ROUTING = ['agent_runtime', 'work_tracker', 'both']
            const VALID_PRIORITY = ['low', 'medium', 'high']
            if (!VALID_ROUTING.includes(input.routingTarget)) {
              res.statusCode = 400
              res.end(JSON.stringify({ error: `Invalid routingTarget. Must be: ${VALID_ROUTING.join(', ')}` }))
              return
            }
            if (!VALID_PRIORITY.includes(input.priority)) {
              res.statusCode = 400
              res.end(JSON.stringify({ error: `Invalid priority. Must be: ${VALID_PRIORITY.join(', ')}` }))
              return
            }
            if (String(input.taskTitle).length > MAX_TITLE_LEN) {
              res.statusCode = 400
              res.end(JSON.stringify({ error: 'taskTitle too long' }))
              return
            }
            if (input.taskBrief && String(input.taskBrief).length > MAX_BRIEF_LEN) {
              res.statusCode = 400
              res.end(JSON.stringify({ error: 'taskBrief too long' }))
              return
            }
            const assignment = {
              id: `assignment-${Date.now()}`,
              targetAgentId: String(input.targetAgentId),
              taskTitle: String(input.taskTitle),
              taskBrief: input.taskBrief ? String(input.taskBrief) : '',
              priority: String(input.priority),
              routingTarget: String(input.routingTarget),
              status: 'queued',
              createdAt: new Date().toISOString()
            }
            await withLock(() => {
              const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'))
              if (!state.assignments) state.assignments = []
              state.assignments.push(assignment)
              state.lastUpdatedAt = new Date().toISOString()
              fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
            })

            let bridgeResult: unknown = null
            if (fs.existsSync(LINEAR_BRIDGE)) {
              try {
                bridgeResult = await runLinearBridge({
                  targetAgentId: assignment.targetAgentId,
                  taskTitle: assignment.taskTitle,
                  taskBrief: assignment.taskBrief,
                  priority: assignment.priority,
                  origin: 'office_ui'
                })
              } catch (bridgeErr) {
                console.warn('Linear bridge failed (assignment saved locally):', bridgeErr)
              }
            }

            // Dispatch to agent runtime if routing includes it
            if (['agent_runtime', 'both'].includes(assignment.routingTarget)) {
              dispatchTask(assignment.targetAgentId, assignment, createStateCallbacks())
            }

            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: true, assignment, bridgeResult }))
          } catch (err) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: `Assignment failed: ${String(err)}` }))
          }
          return
        }

        // POST /api/office/agent — create a new agent
        if (req.method === 'POST' && req.url === '/api/office/agent') {
          try {
            const input = JSON.parse(await readBody(req))
            if (typeof input !== 'object' || input === null || Array.isArray(input)) {
              res.statusCode = 400
              res.end(JSON.stringify({ error: 'Body must be a JSON object' }))
              return
            }
            const required = ['id', 'name', 'role', 'team', 'roomId']
            const missing = required.filter(f => !input[f])
            if (missing.length > 0) {
              res.statusCode = 400
              res.end(JSON.stringify({ error: `Missing required fields: ${missing.join(', ')}` }))
              return
            }
            if (!AGENT_ID_RE.test(input.id)) {
              res.statusCode = 400
              res.end(JSON.stringify({ error: 'id must be lowercase alphanumeric with hyphens only' }))
              return
            }
            if (String(input.name).length > MAX_NAME_LEN) {
              res.statusCode = 400
              res.end(JSON.stringify({ error: 'name too long' }))
              return
            }
            if (input.presence && !VALID_PRESENCE.includes(input.presence)) {
              res.statusCode = 400
              res.end(JSON.stringify({ error: `Invalid presence. Must be one of: ${VALID_PRESENCE.join(', ')}` }))
              return
            }
            await withLock(() => {
              const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'))
              if (state.agents.find((a: { id: string }) => a.id === input.id)) {
                res.statusCode = 409
                res.end(JSON.stringify({ error: 'Agent with this id already exists' }))
                return
              }
              state.agents.push({
                id: input.id, name: input.name, role: input.role, team: input.team,
                roomId: input.roomId, presence: input.presence || 'available',
                focus: input.focus || '', criticalTask: input.criticalTask || false,
                collaborationMode: input.collaborationMode || ''
              })
              if (!state.agentSeats) state.agentSeats = {}
              state.agentSeats[input.id] = { xPct: 50, yPct: 50 }
              state.lastUpdatedAt = new Date().toISOString()
              fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
              res.statusCode = 201
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ ok: true, id: input.id }))
              registerAgent(input.id, input.name, input.role)
            })
          } catch (err) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: String(err) }))
          }
          return
        }

        // PUT /api/office/agent/:id — full update of agent properties
        if (req.method === 'PUT' && agentMatch) {
          try {
            const input = JSON.parse(await readBody(req))
            if (typeof input !== 'object' || input === null || Array.isArray(input)) {
              res.statusCode = 400
              res.end(JSON.stringify({ error: 'Body must be a JSON object' }))
              return
            }
            if (input.name && String(input.name).length > MAX_NAME_LEN) {
              res.statusCode = 400
              res.end(JSON.stringify({ error: 'name too long' }))
              return
            }
            if (input.presence && !VALID_PRESENCE.includes(input.presence)) {
              res.statusCode = 400
              res.end(JSON.stringify({ error: `Invalid presence. Must be one of: ${VALID_PRESENCE.join(', ')}` }))
              return
            }
            await withLock(() => {
              const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'))
              const agent = state.agents.find((a: { id: string }) => a.id === agentMatch[1])
              if (!agent) {
                res.statusCode = 404
                res.end(JSON.stringify({ error: 'Agent not found' }))
                return
              }
              if (input.name) agent.name = input.name
              if (input.role) agent.role = input.role
              if (input.team) agent.team = input.team
              if (input.roomId) agent.roomId = input.roomId
              if (input.presence) agent.presence = input.presence
              if (typeof input.focus === 'string') agent.focus = input.focus
              if (typeof input.criticalTask === 'boolean') agent.criticalTask = input.criticalTask
              if (typeof input.collaborationMode === 'string') agent.collaborationMode = input.collaborationMode
              state.lastUpdatedAt = new Date().toISOString()
              fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ ok: true, agent }))
            })
          } catch (err) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: String(err) }))
          }
          return
        }

        // DELETE /api/office/agent/:id — remove an agent
        if (req.method === 'DELETE' && agentMatch) {
          try {
            const agentId = agentMatch[1]
            unregisterAgent(agentId)
            await withLock(() => {
              const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'))
              const idx = state.agents.findIndex((a: { id: string }) => a.id === agentId)
              if (idx === -1) {
                res.statusCode = 404
                res.end(JSON.stringify({ error: 'Agent not found' }))
                return
              }
              state.agents.splice(idx, 1)
              if (state.agentSeats) delete state.agentSeats[agentId]
              if (state.assignments) state.assignments = state.assignments.filter((a: { targetAgentId: string }) => a.targetAgentId !== agentId)
              state.lastUpdatedAt = new Date().toISOString()
              fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ ok: true }))
            })
          } catch (err) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: String(err) }))
          }
          return
        }

        // PATCH /api/office/settings — update office settings
        if (req.method === 'PATCH' && req.url === '/api/office/settings') {
          try {
            const raw = JSON.parse(await readBody(req))
            if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
              res.statusCode = 400
              res.end(JSON.stringify({ error: 'Body must be a JSON object' }))
              return
            }
            await withLock(() => {
              const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'))
              if (!state.settings) state.settings = {}
              if (typeof raw.officeName === 'string') {
                state.settings.officeName = raw.officeName.slice(0, MAX_NAME_LEN)
              }
              if (raw.theme && typeof raw.theme === 'object') {
                if (!state.settings.theme) state.settings.theme = {}
                if (raw.theme.presenceColors && typeof raw.theme.presenceColors === 'object') {
                  if (!state.settings.theme.presenceColors) state.settings.theme.presenceColors = {}
                  for (const key of VALID_PRESENCE) {
                    if (typeof raw.theme.presenceColors[key] === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.theme.presenceColors[key])) {
                      state.settings.theme.presenceColors[key] = raw.theme.presenceColors[key]
                    }
                  }
                }
              }
              if (raw.workdayPolicy && typeof raw.workdayPolicy === 'object') {
                if (!state.workdayPolicy) state.workdayPolicy = {}
                if (typeof raw.workdayPolicy.timezone === 'string') state.workdayPolicy.timezone = raw.workdayPolicy.timezone.slice(0, 100)
                if (typeof raw.workdayPolicy.days === 'string') state.workdayPolicy.days = raw.workdayPolicy.days.slice(0, 100)
                if (typeof raw.workdayPolicy.hours === 'string') state.workdayPolicy.hours = raw.workdayPolicy.hours.slice(0, 100)
                if (typeof raw.workdayPolicy.pauseRule === 'string') state.workdayPolicy.pauseRule = raw.workdayPolicy.pauseRule.slice(0, MAX_BRIEF_LEN)
                if (typeof raw.workdayPolicy.sharedPlaceRule === 'string') state.workdayPolicy.sharedPlaceRule = raw.workdayPolicy.sharedPlaceRule.slice(0, MAX_BRIEF_LEN)
              }
              state.lastUpdatedAt = new Date().toISOString()
              fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ ok: true, settings: state.settings }))
            })
          } catch (err) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: String(err) }))
          }
          return
        }

        // PUT /api/office/room/:id — update room metadata
        const roomMatch = req.url?.match(/^\/api\/office\/room\/([a-z0-9-]+)$/)
        if (req.method === 'PUT' && roomMatch) {
          try {
            const input = JSON.parse(await readBody(req))
            if (typeof input !== 'object' || input === null || Array.isArray(input)) {
              res.statusCode = 400
              res.end(JSON.stringify({ error: 'Body must be a JSON object' }))
              return
            }
            await withLock(() => {
              const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'))
              const room = state.rooms.find((r: { id: string }) => r.id === roomMatch[1])
              if (!room) {
                res.statusCode = 404
                res.end(JSON.stringify({ error: 'Room not found' }))
                return
              }
              if (typeof input.name === 'string') room.name = input.name.slice(0, MAX_NAME_LEN)
              if (typeof input.team === 'string') room.team = input.team.slice(0, MAX_ROLE_LEN)
              if (typeof input.purpose === 'string') room.purpose = input.purpose.slice(0, MAX_BRIEF_LEN)
              state.lastUpdatedAt = new Date().toISOString()
              fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ ok: true, room }))
            })
          } catch (err) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: String(err) }))
          }
          return
        }

        // POST /api/office/activity — push an activity entry
        if (req.method === 'POST' && req.url === '/api/office/activity') {
          try {
            const entry = JSON.parse(await readBody(req))
            if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
              res.statusCode = 400
              res.end(JSON.stringify({ error: 'Body must be a JSON object' }))
              return
            }
            await withLock(() => {
              const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'))
              if (!state.activity) state.activity = []
              state.activity.unshift({
                id: `act-${Date.now()}`,
                kind: String(entry.kind ?? 'system'),
                text: String(entry.text ?? ''),
                agentId: entry.agentId ? String(entry.agentId) : undefined,
                createdAt: new Date().toISOString()
              })
              state.activity = state.activity.slice(0, 100)
              state.lastUpdatedAt = new Date().toISOString()
              fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ ok: true }))
            })
          } catch (err) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: String(err) }))
          }
          return
        }

        // POST /api/office/result/:assignmentId/save — save result to local file
        const resultSaveMatch = req.url?.match(/^\/api\/office\/result\/([a-z0-9-]+)\/save$/)
        if (req.method === 'POST' && resultSaveMatch) {
          try {
            const assignmentId = resultSaveMatch[1]
            const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'))
            if (!state.assignments) state.assignments = []
            const assignment = state.assignments.find((a: { id: string }) => a.id === assignmentId)
            if (!assignment) {
              res.statusCode = 404
              res.end(JSON.stringify({ error: 'Assignment not found' }))
              return
            }
            if (!assignment.result) {
              res.statusCode = 400
              res.end(JSON.stringify({ error: 'No result to save' }))
              return
            }
            const resultsDir = path.resolve(__dirname, 'state/results')
            if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true })
            const filePath = path.join(resultsDir, `${assignmentId}.md`)
            const content = `# ${assignment.taskTitle}\n\n**Agent:** ${assignment.targetAgentId}\n**Completed:** ${new Date().toISOString()}\n**Priority:** ${assignment.priority}\n\n## Result\n\n${assignment.result}\n`
            fs.writeFileSync(filePath, content)
            await withLock(() => {
              const freshState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'))
              const a = freshState.assignments?.find((x: { id: string }) => x.id === assignmentId)
              if (a) {
                a.resultSavedAt = new Date().toISOString()
                a.resultAction = 'saved'
                freshState.lastUpdatedAt = new Date().toISOString()
                fs.writeFileSync(STATE_FILE, JSON.stringify(freshState, null, 2))
              }
            })
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: true, path: filePath }))
          } catch (err) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: String(err) }))
          }
          return
        }

        next()
      })

      // Startup recovery: register existing agents and start queue processor
      try {
        const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'))
        if (state.agents) {
          for (const agent of state.agents) {
            registerAgent(agent.id, agent.name, agent.role)
          }
        }
        // Re-queue any active assignments (process died on restart)
        if (state.assignments) {
          let changed = false
          for (const a of state.assignments) {
            if (a.status === 'active') {
              a.status = 'queued'
              a.updatedAt = new Date().toISOString()
              changed = true
            }
          }
          if (changed) {
            state.lastUpdatedAt = new Date().toISOString()
            fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
          }
        }
      } catch {
        console.warn('[agent-runtime] No state file found for startup recovery')
      }

      // Start task queue processor
      startTaskQueue(5000, () => {
        try {
          const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'))
          return (state.assignments || []).filter((a: { status: string; routingTarget: string }) =>
            a.status === 'queued' && ['agent_runtime', 'both'].includes(a.routingTarget)
          )
        } catch { return [] }
      }, (assignment: { targetAgentId: string }) => {
        dispatchTask(assignment.targetAgentId, assignment, createStateCallbacks())
      })

      // Cleanup on server close
      server.httpServer?.on('close', () => { shutdownAll() })
    }
  }
}

export default defineConfig({
  plugins: [react(), officeApiPlugin()],
  server: {
    host: '0.0.0.0',
    port: 4173
  }
})
