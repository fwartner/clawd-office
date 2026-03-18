#!/usr/bin/env node
/**
 * Minimal production server for the OpenClaw Virtual Office.
 * Serves the built static files + office API endpoints.
 *
 * Primary backend: Postgres (`agent_memory`)
 * Fallback backend: local state file
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(__dirname, 'dist')
const STATE_FILE = path.join(__dirname, 'state/office-snapshot.json')
const LINEAR_BRIDGE = process.env.LINEAR_BRIDGE_PATH || path.join(__dirname, 'scripts/create_linear_task_and_dispatch.py')
const PSQL = process.env.PSQL_PATH || 'psql'
const DB_NAME = process.env.POSTGRES_DB || 'agent_memory'
const PORT = Number(process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : 4173)

const MAX_BODY_SIZE = 1_048_576 // 1MB
const MAX_TITLE_LEN = 200
const MAX_BRIEF_LEN = 2000
const MAX_FOCUS_LEN = 500
const MAX_NAME_LEN = 100
const MAX_ROLE_LEN = 200
const VALID_PRESENCE = ['off_hours', 'available', 'active', 'in_meeting', 'paused', 'blocked']
const AGENT_PATCH_FIELDS = ['presence', 'focus', 'roomId', 'criticalTask', 'collaborationMode']
const AGENT_ID_RE = /^[a-z0-9-]+$/
const ASSIGNMENT_STATUSES = ['queued', 'routed', 'active', 'done', 'blocked']

const ALLOWED_ROOTS = [DIST, path.join(__dirname, 'assets')]

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    let size = 0
    const timeout = setTimeout(() => { reject(new Error('Request timeout')); req.destroy() }, 10_000)
    req.on('data', chunk => {
      size += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length
      if (size > MAX_BODY_SIZE) { reject(new Error('Body too large')); req.destroy(); return }
      body += chunk
    })
    req.on('end', () => {
      clearTimeout(timeout)
      try { resolve(JSON.parse(body)) } catch (e) { reject(e) }
    })
    req.on('error', (e) => { clearTimeout(timeout); reject(e) })
  })
}

function sanitizePatch(raw) {
  const clean = {}
  for (const key of AGENT_PATCH_FIELDS) {
    if (key in raw) clean[key] = raw[key]
  }
  return clean
}

function runLinearBridge(input) {
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

function isSafePath(filePath) {
  const resolved = path.resolve(filePath)
  return ALLOWED_ROOTS.some(root => resolved.startsWith(root + path.sep) || resolved === root)
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
  res.end(JSON.stringify(data))
}

function readState() { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) }
function writeState(state) { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)) }

let writeLock = Promise.resolve()
function withLock(fn) {
  writeLock = writeLock.then(fn, fn)
  return writeLock
}

function sqlString(value) {
  if (value == null) return 'NULL'
  return `'${String(value).replace(/'/g, "''")}'`
}

function sqlBool(value) {
  return value ? 'true' : 'false'
}

function runPsql(sql) {
  return new Promise((resolve, reject) => {
    execFile(PSQL, [DB_NAME, '-X', '-t', '-A', '-c', sql], { timeout: 30_000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message))
        return
      }
      resolve(String(stdout).trim())
    })
  })
}

async function postgresAvailable() {
  try {
    await runPsql('select 1;')
    return true
  } catch {
    return false
  }
}

async function getSnapshotFromPostgres() {
  const sql = `
with agents_json as (
  select coalesce(json_agg(json_build_object(
    'id', a.id,
    'name', a.name,
    'role', a.role,
    'team', a.team,
    'roomId', we.room_id,
    'presence', p.presence_state,
    'focus', p.focus,
    'criticalTask', p.critical_task,
    'collaborationMode', p.collaboration_mode,
    'external', not a.internal_staff
  ) order by a.id), '[]'::json) as value
  from office_agents a
  left join office_presence p on p.agent_id = a.id
  left join office_world_entities we on we.agent_id = a.id
  where a.office_visible = true
),
rooms_json as (
  select coalesce(json_agg(json_build_object(
    'id', r.id,
    'name', r.name,
    'team', r.team,
    'purpose', r.purpose,
    'agents', coalesce((select json_agg(we.agent_id order by we.agent_id) from office_world_entities we where we.room_id = r.id), '[]'::json),
    'zone', json_build_object('x', r.zone_x, 'y', r.zone_y, 'w', r.zone_w, 'h', r.zone_h)
  ) order by r.id), '[]'::json) as value
  from office_rooms r
),
seats_json as (
  select coalesce(json_object_agg(agent_id, json_build_object('xPct', anchor_x_pct, 'yPct', anchor_y_pct)), '{}'::json) as value
  from office_world_entities
),
assignments_json as (
  select coalesce(json_agg(json_build_object(
    'id', id,
    'targetAgentId', target_agent_id,
    'taskTitle', task_title,
    'taskBrief', task_brief,
    'priority', priority,
    'status', status,
    'routingTarget', routing_target,
    'createdAt', created_at,
    'source', source
  ) order by created_at desc), '[]'::json) as value
  from office_assignments
),
activity_json as (
  select coalesce(json_agg(json_build_object(
    'id', id,
    'kind', kind,
    'text', message,
    'agentId', agent_id,
    'createdAt', created_at
  ) order by created_at desc), '[]'::json) as value
  from office_activity_feed
),
decisions_json as (
  select coalesce(json_agg(json_build_object(
    'id', id,
    'title', title,
    'detail', detail,
    'createdAt', created_at
  ) order by created_at desc), '[]'::json) as value
  from office_decisions
)
select json_build_object(
  'agents', agents_json.value,
  'rooms', rooms_json.value,
  'agentSeats', seats_json.value,
  'workdayPolicy', json_build_object(
    'timezone', 'Europe/Berlin',
    'days', 'Monday-Friday',
    'hours', '09:00-17:00',
    'pauseRule', 'After non-critical tasks, agents should move to paused to save tokens until the next meaningful task arrives.',
    'sharedPlaceRule', 'The office is the shared place where all agents work together, coordinate by room, and expose their current state.'
  ),
  'activity', activity_json.value,
  'assignments', assignments_json.value,
  'decisions', decisions_json.value,
  'source', 'postgres',
  'lastUpdatedAt', now()
)
from agents_json, rooms_json, seats_json, assignments_json, activity_json, decisions_json;
`
  const raw = await runPsql(sql)
  return JSON.parse(raw)
}

async function patchAgentInPostgres(agentId, patch) {
  const updates = []
  const presenceUpdates = []
  const worldUpdates = []

  if (typeof patch.presence === 'string') {
    presenceUpdates.push(`presence_state = ${sqlString(patch.presence)}`)
    presenceUpdates.push(`effective_presence_state = ${sqlString(patch.presence)}`)
  }
  if (typeof patch.focus === 'string') {
    presenceUpdates.push(`focus = ${sqlString(patch.focus)}`)
  }
  if (typeof patch.criticalTask === 'boolean') {
    presenceUpdates.push(`critical_task = ${sqlBool(patch.criticalTask)}`)
  }
  if (typeof patch.collaborationMode === 'string') {
    presenceUpdates.push(`collaboration_mode = ${sqlString(patch.collaborationMode)}`)
  }
  if (typeof patch.roomId === 'string') {
    worldUpdates.push(`room_id = ${sqlString(patch.roomId)}`)
  }

  if (updates.length) {
    await runPsql(`update office_agents set ${updates.join(', ')}, updated_at = now() where id = ${sqlString(agentId)};`)
  }
  if (presenceUpdates.length) {
    await runPsql(`update office_presence set ${presenceUpdates.join(', ')}, updated_at = now() where agent_id = ${sqlString(agentId)};`)
  }
  if (worldUpdates.length) {
    await runPsql(`update office_world_entities set ${worldUpdates.join(', ')}, updated_at = now() where agent_id = ${sqlString(agentId)};`)
  }

  await appendActivityInPostgres({
    id: `act-${Date.now()}`,
    kind: 'presence',
    text: `Agent ${agentId} updated from office UI`,
    agentId,
  })
}

async function updateAssignmentStatusInPostgres(assignmentId, status) {
  await runPsql(`
    update office_assignments
    set status = ${sqlString(status)}, updated_at = now()
    where id = ${sqlString(assignmentId)};
  `)
}

async function createAssignmentInPostgres(input) {
  const id = `assignment-${Date.now()}`
  await runPsql(`
    insert into office_assignments (
      id, target_agent_id, task_title, task_brief, priority, status, routing_target, source
    ) values (
      ${sqlString(id)},
      ${sqlString(input.targetAgentId)},
      ${sqlString(input.taskTitle)},
      ${sqlString(input.taskBrief ?? '')},
      ${sqlString(input.priority)},
      'queued',
      ${sqlString(input.routingTarget)},
      'office_ui'
    );
  `)
  await appendActivityInPostgres({
    id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    kind: 'assignment',
    text: `Assigned "${input.taskTitle}" to ${input.targetAgentId}`,
    agentId: input.targetAgentId,
  })
  return { id, status: 'queued' }
}

async function appendActivityInPostgres(entry) {
  await runPsql(`
    insert into office_activity_feed (id, kind, agent_id, room_id, message)
    values (
      ${sqlString(entry.id ?? `act-${Date.now()}`)},
      ${sqlString(entry.kind ?? 'system')},
      ${sqlString(entry.agentId ?? null)},
      ${sqlString(entry.roomId ?? null)},
      ${sqlString(entry.text ?? '')}
    );
  `)
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' })
    res.end()
    return
  }

  if (url.pathname === '/api/office/snapshot' && req.method === 'GET') {
    try {
      let state
      if (await postgresAvailable()) {
        state = await getSnapshotFromPostgres()
      } else {
        state = readState()
      }
      if (!state.assignments) state.assignments = []
      if (!state.activity) state.activity = []
      json(res, 200, state)
    } catch {
      try {
        const state = readState()
        if (!state.assignments) state.assignments = []
        if (!state.activity) state.activity = []
        json(res, 200, state)
      } catch { json(res, 500, { error: 'Office state unavailable' }) }
    }
    return
  }

  const agentMatch = url.pathname.match(/^\/api\/office\/agent\/([a-z0-9-]+)$/)
  if (agentMatch && req.method === 'PATCH') {
    try {
      const raw = await readBody(req)
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        json(res, 400, { error: 'Body must be a JSON object' }); return
      }
      const patch = sanitizePatch(raw)
      if (Object.keys(patch).length === 0) {
        json(res, 400, { error: 'No valid fields to update' }); return
      }
      if ('presence' in patch && !VALID_PRESENCE.includes(patch.presence)) {
        json(res, 400, { error: `Invalid presence value. Must be one of: ${VALID_PRESENCE.join(', ')}` }); return
      }
      if (await postgresAvailable()) {
        await patchAgentInPostgres(agentMatch[1], patch)
        json(res, 200, { ok: true, source: 'postgres' })
      } else {
        await withLock(() => {
          const state = readState()
          const agent = state.agents.find(a => a.id === agentMatch[1])
          if (!agent) { json(res, 404, { error: 'Not found' }); return }
          for (const [k, v] of Object.entries(patch)) agent[k] = v
          state.lastUpdatedAt = new Date().toISOString()
          writeState(state)
          json(res, 200, { ok: true, agent, source: 'file' })
        })
      }
    } catch (e) { json(res, 400, { error: String(e) }) }
    return
  }

  const assignPatchMatch = url.pathname.match(/^\/api\/office\/assignment\/([a-z0-9-]+)$/)
  if (assignPatchMatch && req.method === 'PATCH') {
    try {
      const raw = await readBody(req)
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        json(res, 400, { error: 'Body must be a JSON object' }); return
      }
      if (!raw.status || !ASSIGNMENT_STATUSES.includes(raw.status)) {
        json(res, 400, { error: `Invalid status. Must be one of: ${ASSIGNMENT_STATUSES.join(', ')}` }); return
      }
      if (await postgresAvailable()) {
        await updateAssignmentStatusInPostgres(assignPatchMatch[1], raw.status)
        json(res, 200, { ok: true, source: 'postgres' })
      } else {
        await withLock(() => {
          const state = readState()
          if (!state.assignments) state.assignments = []
          const assignment = state.assignments.find(a => a.id === assignPatchMatch[1])
          if (!assignment) { json(res, 404, { error: 'Assignment not found' }); return }
          assignment.status = raw.status
          state.lastUpdatedAt = new Date().toISOString()
          writeState(state)
          json(res, 200, { ok: true, assignment, source: 'file' })
        })
      }
    } catch (e) { json(res, 400, { error: String(e) }) }
    return
  }

  if (url.pathname === '/api/office/assign' && req.method === 'POST') {
    try {
      const input = await readBody(req)
      if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        json(res, 400, { error: 'Body must be a JSON object' }); return
      }
      const missing = ['targetAgentId', 'taskTitle', 'priority', 'routingTarget'].filter(f => !input[f])
      if (missing.length > 0) {
        json(res, 400, { error: `Missing required fields: ${missing.join(', ')}` }); return
      }
      const VALID_ROUTING = ['agent_runtime', 'work_tracker', 'both']
      const VALID_PRIORITY = ['low', 'medium', 'high']
      if (!VALID_ROUTING.includes(input.routingTarget)) {
        json(res, 400, { error: `Invalid routingTarget. Must be: ${VALID_ROUTING.join(', ')}` }); return
      }
      if (!VALID_PRIORITY.includes(input.priority)) {
        json(res, 400, { error: `Invalid priority. Must be: ${VALID_PRIORITY.join(', ')}` }); return
      }
      if (String(input.taskTitle).length > MAX_TITLE_LEN) {
        json(res, 400, { error: 'taskTitle too long' }); return
      }
      if (input.taskBrief && String(input.taskBrief).length > MAX_BRIEF_LEN) {
        json(res, 400, { error: 'taskBrief too long' }); return
      }
      const persisted = await createAssignmentInPostgres(input)
      const result = await runLinearBridge({
        targetAgentId: String(input.targetAgentId),
        taskTitle: String(input.taskTitle),
        taskBrief: input.taskBrief ? String(input.taskBrief) : '',
        priority: String(input.priority),
        origin: 'office_ui'
      })
      json(res, 200, { ok: true, persisted, result, source: 'postgres' })
    } catch (e) { json(res, 400, { error: String(e) }) }
    return
  }

  // POST /api/office/agent — create a new agent
  if (url.pathname === '/api/office/agent' && req.method === 'POST') {
    try {
      const input = await readBody(req)
      if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        json(res, 400, { error: 'Body must be a JSON object' }); return
      }
      const required = ['id', 'name', 'role', 'team', 'roomId']
      const missing = required.filter(f => !input[f])
      if (missing.length > 0) {
        json(res, 400, { error: `Missing required fields: ${missing.join(', ')}` }); return
      }
      if (!AGENT_ID_RE.test(input.id)) {
        json(res, 400, { error: 'id must be lowercase alphanumeric with hyphens only' }); return
      }
      if (String(input.name).length > MAX_NAME_LEN) {
        json(res, 400, { error: 'name too long' }); return
      }
      if (String(input.role).length > MAX_ROLE_LEN) {
        json(res, 400, { error: 'role too long' }); return
      }
      if (input.focus && String(input.focus).length > MAX_FOCUS_LEN) {
        json(res, 400, { error: 'focus too long' }); return
      }
      if (input.presence && !VALID_PRESENCE.includes(input.presence)) {
        json(res, 400, { error: `Invalid presence. Must be one of: ${VALID_PRESENCE.join(', ')}` }); return
      }
      if (await postgresAvailable()) {
        // Check uniqueness
        const exists = await runPsql(`select count(*) from office_agents where id = ${sqlString(input.id)};`)
        if (parseInt(exists) > 0) {
          json(res, 409, { error: 'Agent with this id already exists' }); return
        }
        await runPsql(`insert into office_agents (id, name, role, team, internal_staff, office_visible) values (${sqlString(input.id)}, ${sqlString(input.name)}, ${sqlString(input.role)}, ${sqlString(input.team)}, true, true);`)
        await runPsql(`insert into office_presence (agent_id, presence_state, effective_presence_state, critical_task, focus, collaboration_mode) values (${sqlString(input.id)}, ${sqlString(input.presence || 'available')}, ${sqlString(input.presence || 'available')}, ${sqlBool(input.criticalTask || false)}, ${sqlString(input.focus || '')}, ${sqlString(input.collaborationMode || '')});`)
        await runPsql(`insert into office_world_entities (agent_id, room_id, anchor_x_pct, anchor_y_pct) values (${sqlString(input.id)}, ${sqlString(input.roomId)}, 50, 50);`)
        await appendActivityInPostgres({ id: `act-${Date.now()}`, kind: 'system', text: `Agent ${input.name} created`, agentId: input.id })
        json(res, 201, { ok: true, id: input.id, source: 'postgres' })
      } else {
        await withLock(() => {
          const state = readState()
          if (state.agents.find(a => a.id === input.id)) {
            json(res, 409, { error: 'Agent with this id already exists' }); return
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
          writeState(state)
          json(res, 201, { ok: true, id: input.id, source: 'file' })
        })
      }
    } catch (e) { json(res, 400, { error: String(e) }) }
    return
  }

  // PUT /api/office/agent/:id — full update of agent properties
  if (agentMatch && req.method === 'PUT') {
    try {
      const input = await readBody(req)
      if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        json(res, 400, { error: 'Body must be a JSON object' }); return
      }
      if (input.name && String(input.name).length > MAX_NAME_LEN) {
        json(res, 400, { error: 'name too long' }); return
      }
      if (input.role && String(input.role).length > MAX_ROLE_LEN) {
        json(res, 400, { error: 'role too long' }); return
      }
      if (input.focus && String(input.focus).length > MAX_FOCUS_LEN) {
        json(res, 400, { error: 'focus too long' }); return
      }
      if (input.presence && !VALID_PRESENCE.includes(input.presence)) {
        json(res, 400, { error: `Invalid presence. Must be one of: ${VALID_PRESENCE.join(', ')}` }); return
      }
      const agentId = agentMatch[1]
      if (await postgresAvailable()) {
        const exists = await runPsql(`select count(*) from office_agents where id = ${sqlString(agentId)};`)
        if (parseInt(exists) === 0) {
          json(res, 404, { error: 'Agent not found' }); return
        }
        const agentUpdates = []
        if (input.name) agentUpdates.push(`name = ${sqlString(input.name)}`)
        if (input.role) agentUpdates.push(`role = ${sqlString(input.role)}`)
        if (input.team) agentUpdates.push(`team = ${sqlString(input.team)}`)
        if (agentUpdates.length) {
          await runPsql(`update office_agents set ${agentUpdates.join(', ')}, updated_at = now() where id = ${sqlString(agentId)};`)
        }
        const presenceUpdates = []
        if (input.presence) presenceUpdates.push(`presence_state = ${sqlString(input.presence)}`, `effective_presence_state = ${sqlString(input.presence)}`)
        if (typeof input.focus === 'string') presenceUpdates.push(`focus = ${sqlString(input.focus)}`)
        if (typeof input.criticalTask === 'boolean') presenceUpdates.push(`critical_task = ${sqlBool(input.criticalTask)}`)
        if (typeof input.collaborationMode === 'string') presenceUpdates.push(`collaboration_mode = ${sqlString(input.collaborationMode)}`)
        if (presenceUpdates.length) {
          await runPsql(`update office_presence set ${presenceUpdates.join(', ')}, updated_at = now() where agent_id = ${sqlString(agentId)};`)
        }
        if (input.roomId) {
          await runPsql(`update office_world_entities set room_id = ${sqlString(input.roomId)}, updated_at = now() where agent_id = ${sqlString(agentId)};`)
        }
        await appendActivityInPostgres({ id: `act-${Date.now()}`, kind: 'system', text: `Agent ${agentId} updated`, agentId })
        json(res, 200, { ok: true, source: 'postgres' })
      } else {
        await withLock(() => {
          const state = readState()
          const agent = state.agents.find(a => a.id === agentId)
          if (!agent) { json(res, 404, { error: 'Agent not found' }); return }
          if (input.name) agent.name = input.name
          if (input.role) agent.role = input.role
          if (input.team) agent.team = input.team
          if (input.roomId) agent.roomId = input.roomId
          if (input.presence) agent.presence = input.presence
          if (typeof input.focus === 'string') agent.focus = input.focus
          if (typeof input.criticalTask === 'boolean') agent.criticalTask = input.criticalTask
          if (typeof input.collaborationMode === 'string') agent.collaborationMode = input.collaborationMode
          state.lastUpdatedAt = new Date().toISOString()
          writeState(state)
          json(res, 200, { ok: true, agent, source: 'file' })
        })
      }
    } catch (e) { json(res, 400, { error: String(e) }) }
    return
  }

  // DELETE /api/office/agent/:id — remove an agent
  if (agentMatch && req.method === 'DELETE') {
    try {
      const agentId = agentMatch[1]
      if (await postgresAvailable()) {
        const exists = await runPsql(`select count(*) from office_agents where id = ${sqlString(agentId)};`)
        if (parseInt(exists) === 0) {
          json(res, 404, { error: 'Agent not found' }); return
        }
        await runPsql(`delete from office_assignments where target_agent_id = ${sqlString(agentId)};`)
        await runPsql(`delete from office_world_entities where agent_id = ${sqlString(agentId)};`)
        await runPsql(`delete from office_presence where agent_id = ${sqlString(agentId)};`)
        await runPsql(`delete from office_agents where id = ${sqlString(agentId)};`)
        await appendActivityInPostgres({ id: `act-${Date.now()}`, kind: 'system', text: `Agent ${agentId} deleted` })
        json(res, 200, { ok: true, source: 'postgres' })
      } else {
        await withLock(() => {
          const state = readState()
          const idx = state.agents.findIndex(a => a.id === agentId)
          if (idx === -1) { json(res, 404, { error: 'Agent not found' }); return }
          state.agents.splice(idx, 1)
          if (state.agentSeats) delete state.agentSeats[agentId]
          if (state.assignments) state.assignments = state.assignments.filter(a => a.targetAgentId !== agentId)
          state.lastUpdatedAt = new Date().toISOString()
          writeState(state)
          json(res, 200, { ok: true, source: 'file' })
        })
      }
    } catch (e) { json(res, 400, { error: String(e) }) }
    return
  }

  if (url.pathname === '/api/office/activity' && req.method === 'POST') {
    try {
      const entry = await readBody(req)
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
        json(res, 400, { error: 'Body must be a JSON object' }); return
      }
      if (await postgresAvailable()) {
        await appendActivityInPostgres(entry)
        json(res, 200, { ok: true, source: 'postgres' })
      } else {
        await withLock(() => {
          const state = readState()
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
          writeState(state)
          json(res, 200, { ok: true, source: 'file' })
        })
      }
    } catch (e) { json(res, 400, { error: String(e) }) }
    return
  }

  let filePath = path.join(__dirname, url.pathname)
  if (url.pathname.startsWith('/assets/') && isSafePath(filePath) && fs.existsSync(filePath)) {
    const ext = path.extname(filePath)
    res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream', 'Cache-Control': 'public, max-age=86400', 'Access-Control-Allow-Origin': '*' })
    fs.createReadStream(filePath).pipe(res)
    return
  }

  filePath = path.join(DIST, url.pathname === '/' ? 'index.html' : url.pathname)
  if (isSafePath(filePath) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath)
    res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000', 'Access-Control-Allow-Origin': '*' })
    fs.createReadStream(filePath).pipe(res)
    return
  }

  const index = path.join(DIST, 'index.html')
  if (fs.existsSync(index)) {
    res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' })
    fs.createReadStream(index).pipe(res)
    return
  }

  res.writeHead(404)
  res.end('Not found')
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`OpenClaw Virtual Office server running at http://0.0.0.0:${PORT}`)
  console.log(`Primary backend: Postgres (${DB_NAME})`)
  console.log(`Fallback state file: ${STATE_FILE}`)
})

function shutdown(signal) {
  console.log(`\n${signal} received — shutting down gracefully`)
  server.close(() => {
    console.log('Server closed')
    process.exit(0)
  })
  setTimeout(() => { process.exit(1) }, 5000)
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
