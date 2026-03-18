/**
 * Shared API route handlers — used by both dev (vite) and prod (server.mjs).
 * Pure functions: (context, input) → response object. No HTTP framework dependency.
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  sanitizePatch, validateObject, findMissing, generateId,
  VALID_PRESENCE, VALID_ROUTING, VALID_PRIORITY, VALID_DECISION_STATUSES,
  ASSIGNMENT_STATUSES, AGENT_ID_RE, WEBHOOK_EVENTS,
  MAX_TITLE_LEN, MAX_BRIEF_LEN, MAX_FOCUS_LEN, MAX_NAME_LEN, MAX_ROLE_LEN,
  MAX_SYSTEM_PROMPT_LEN, MAX_MESSAGE_LEN,
  type AgentPatch,
} from './validation.js'
import { emit } from './events.js'

// ── Types ────────────────────────────────────────────

export interface ApiResponse {
  status: number
  body: Record<string, unknown>
}

export interface SnapshotData {
  agents: unknown[]
  rooms: unknown[]
  agentSeats: Record<string, unknown>
  workdayPolicy: unknown
  activity: unknown[]
  assignments: unknown[]
  decisions: unknown[]
  messages: unknown[]
  webhooks: unknown[]
  webhookLogs: unknown[]
  settings?: unknown
  source: string
  lastUpdatedAt: string
  agentRuntimeStatuses?: unknown[]
}

/**
 * ApiContext abstracts storage operations so route handlers
 * work identically regardless of backend (SQLite, Postgres, JSON file).
 */
export interface ApiContext {
  getSnapshot(): Promise<SnapshotData>
  // Agents
  getAgent(id: string): Promise<Record<string, unknown> | null>
  createAgent(input: Record<string, unknown>): Promise<{ id: string }>
  updateAgent(id: string, input: Record<string, unknown>): Promise<boolean>
  patchAgent(id: string, patch: AgentPatch): Promise<boolean>
  deleteAgent(id: string): Promise<boolean>
  // Assignments
  createAssignment(input: Record<string, unknown>): Promise<{ id: string; status: string }>
  updateAssignment(id: string, status: string, result?: string): Promise<boolean>
  getAssignment(id: string): Promise<Record<string, unknown> | null>
  listAssignments(filters: { status?: string; agent?: string; limit?: number }): Promise<unknown[]>
  saveResult(id: string, filePath: string): Promise<boolean>
  // Activity
  appendActivity(entry: Record<string, unknown>): Promise<void>
  // Decisions
  createDecision(input: Record<string, unknown>): Promise<Record<string, unknown>>
  updateDecision(id: string, input: Record<string, unknown>): Promise<boolean>
  // Messages
  sendMessage(input: Record<string, unknown>): Promise<Record<string, unknown>>
  listMessages(filters: { room?: string; agent?: string }): Promise<unknown[]>
  // Rooms
  createRoom(input: Record<string, unknown>): Promise<{ id: string }>
  updateRoom(id: string, input: Record<string, unknown>): Promise<boolean>
  deleteRoom(id: string): Promise<boolean>
  // Webhooks
  createWebhook(input: Record<string, unknown>): Promise<Record<string, unknown>>
  deleteWebhook(id: string): Promise<boolean>
  logWebhookDelivery(webhookId: string, event: string, statusCode: number): Promise<void>
  // Settings
  updateSettings(input: Record<string, unknown>): Promise<Record<string, unknown>>
  // Runtime hooks
  registerAgentRuntime?(id: string, name: string, role: string, systemPrompt: string): void
  unregisterAgentRuntime?(id: string): void
  dispatchToRuntime?(agentId: string, assignment: Record<string, unknown>): void
  getAgentRuntimeStatuses?(): unknown[]
  // Integration webhook handlers (registered by integration modules)
  integrationWebhooks?: Record<string, (req: { body: string; headers: Record<string, string | undefined> }) => Promise<{ status: number; body: Record<string, unknown> }>>
  // Results dir
  resultsDir: string
}

// ── Helpers ──────────────────────────────────────────

function ok(status: number, body: Record<string, unknown>): ApiResponse {
  return { status, body }
}

function err(status: number, error: string): ApiResponse {
  return { status, body: { error } }
}

// ── Route handlers ───────────────────────────────────

export async function getSnapshot(ctx: ApiContext): Promise<ApiResponse> {
  try {
    const state = await ctx.getSnapshot()
    if (ctx.getAgentRuntimeStatuses) {
      state.agentRuntimeStatuses = ctx.getAgentRuntimeStatuses()
    }
    return ok(200, state as unknown as Record<string, unknown>)
  } catch {
    return err(500, 'Office state unavailable')
  }
}

export async function patchAgent(ctx: ApiContext, agentId: string, raw: unknown): Promise<ApiResponse> {
  if (!validateObject(raw)) return err(400, 'Body must be a JSON object')
  const patch = sanitizePatch(raw as Record<string, unknown>)
  if (Object.keys(patch).length === 0) return err(400, 'No valid fields to update')
  if ('presence' in patch && !VALID_PRESENCE.includes(patch.presence as typeof VALID_PRESENCE[number])) {
    return err(400, `Invalid presence value. Must be one of: ${VALID_PRESENCE.join(', ')}`)
  }
  const found = await ctx.patchAgent(agentId, patch)
  if (!found) return err(404, 'Not found')
  return ok(200, { ok: true })
}

export async function putAgent(ctx: ApiContext, agentId: string, input: unknown): Promise<ApiResponse> {
  if (!validateObject(input)) return err(400, 'Body must be a JSON object')
  const o = input as Record<string, unknown>
  if (o.name && String(o.name).length > MAX_NAME_LEN) return err(400, 'name too long')
  if (o.role && String(o.role).length > MAX_ROLE_LEN) return err(400, 'role too long')
  if (o.focus && String(o.focus).length > MAX_FOCUS_LEN) return err(400, 'focus too long')
  if (o.presence && !VALID_PRESENCE.includes(o.presence as typeof VALID_PRESENCE[number])) {
    return err(400, `Invalid presence. Must be one of: ${VALID_PRESENCE.join(', ')}`)
  }
  const found = await ctx.updateAgent(agentId, o)
  if (!found) return err(404, 'Agent not found')
  return ok(200, { ok: true })
}

export async function createAgent(ctx: ApiContext, input: unknown): Promise<ApiResponse> {
  if (!validateObject(input)) return err(400, 'Body must be a JSON object')
  const o = input as Record<string, unknown>
  const missing = findMissing(o, ['id', 'name', 'role', 'team', 'roomId'])
  if (missing.length) return err(400, `Missing required fields: ${missing.join(', ')}`)
  if (!AGENT_ID_RE.test(String(o.id))) return err(400, 'id must be lowercase alphanumeric with hyphens only')
  if (String(o.name).length > MAX_NAME_LEN) return err(400, 'name too long')
  if (String(o.role).length > MAX_ROLE_LEN) return err(400, 'role too long')
  if (o.focus && String(o.focus).length > MAX_FOCUS_LEN) return err(400, 'focus too long')
  if (o.presence && !VALID_PRESENCE.includes(o.presence as typeof VALID_PRESENCE[number])) {
    return err(400, `Invalid presence. Must be one of: ${VALID_PRESENCE.join(', ')}`)
  }
  try {
    const result = await ctx.createAgent(o)
    if (ctx.registerAgentRuntime) {
      ctx.registerAgentRuntime(String(o.id), String(o.name), String(o.role), o.systemPrompt ? String(o.systemPrompt).slice(0, MAX_SYSTEM_PROMPT_LEN) : '')
    }
    emit({ type: 'agent.created', agentId: String(o.id), name: String(o.name) })
    return ok(201, { ok: true, id: result.id })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    if (msg.includes('already exists') || msg.includes('UNIQUE')) return err(409, 'Agent with this id already exists')
    throw e
  }
}

export async function deleteAgent(ctx: ApiContext, agentId: string): Promise<ApiResponse> {
  if (ctx.unregisterAgentRuntime) ctx.unregisterAgentRuntime(agentId)
  emit({ type: 'agent.deleted', agentId })
  const found = await ctx.deleteAgent(agentId)
  if (!found) return err(404, 'Agent not found')
  return ok(200, { ok: true })
}

export async function createAssignment(ctx: ApiContext, input: unknown): Promise<ApiResponse> {
  if (!validateObject(input)) return err(400, 'Body must be a JSON object')
  const o = input as Record<string, unknown>
  const missing = findMissing(o, ['targetAgentId', 'taskTitle', 'priority', 'routingTarget'])
  if (missing.length) return err(400, `Missing required fields: ${missing.join(', ')}`)
  if (!VALID_ROUTING.includes(o.routingTarget as typeof VALID_ROUTING[number])) {
    return err(400, `Invalid routingTarget. Must be: ${VALID_ROUTING.join(', ')}`)
  }
  if (!VALID_PRIORITY.includes(o.priority as typeof VALID_PRIORITY[number])) {
    return err(400, `Invalid priority. Must be: ${VALID_PRIORITY.join(', ')}`)
  }
  if (String(o.taskTitle).length > MAX_TITLE_LEN) return err(400, 'taskTitle too long')
  if (o.taskBrief && String(o.taskBrief).length > MAX_BRIEF_LEN) return err(400, 'taskBrief too long')

  const persisted = await ctx.createAssignment(o)
  emit({ type: 'task.created', assignmentId: persisted.id, agentId: String(o.targetAgentId), title: String(o.taskTitle) })

  if (ctx.dispatchToRuntime && ['agent_runtime', 'both'].includes(String(o.routingTarget))) {
    ctx.dispatchToRuntime(String(o.targetAgentId), {
      id: persisted.id,
      taskTitle: String(o.taskTitle),
      taskBrief: o.taskBrief ? String(o.taskBrief) : '',
      targetAgentId: String(o.targetAgentId),
    })
  }

  return ok(200, { ok: true, persisted })
}

export async function patchAssignment(ctx: ApiContext, assignmentId: string, input: unknown): Promise<ApiResponse> {
  if (!validateObject(input)) return err(400, 'Body must be a JSON object')
  const o = input as Record<string, unknown>
  if (!o.status || !ASSIGNMENT_STATUSES.includes(o.status as typeof ASSIGNMENT_STATUSES[number])) {
    return err(400, `Invalid status. Must be one of: ${ASSIGNMENT_STATUSES.join(', ')}`)
  }
  if (o.result !== undefined && o.status !== 'done') return err(400, 'result can only be provided when status is done')
  if (o.result !== undefined && typeof o.result === 'string' && o.result.length > MAX_BRIEF_LEN) return err(400, 'result too long (max 2000 chars)')
  const found = await ctx.updateAssignment(assignmentId, String(o.status), typeof o.result === 'string' ? o.result : undefined)
  if (!found) return err(404, 'Assignment not found')
  return ok(200, { ok: true })
}

export async function saveResult(ctx: ApiContext, assignmentId: string): Promise<ApiResponse> {
  const assignment = await ctx.getAssignment(assignmentId)
  if (!assignment) return err(404, 'Assignment not found')
  if (!assignment.result) return err(400, 'No result to save')
  if (!fs.existsSync(ctx.resultsDir)) fs.mkdirSync(ctx.resultsDir, { recursive: true })
  const filePath = path.join(ctx.resultsDir, `${assignmentId}.md`)
  const content = `# ${assignment.taskTitle}\n\n**Agent:** ${assignment.targetAgentId}\n**Completed:** ${new Date().toISOString()}\n**Priority:** ${assignment.priority}\n\n## Result\n\n${assignment.result}\n`
  fs.writeFileSync(filePath, content)
  await ctx.saveResult(assignmentId, filePath)
  return ok(200, { ok: true, path: filePath })
}

export async function listAssignments(ctx: ApiContext, filters: { status?: string; agent?: string; limit?: number }): Promise<ApiResponse> {
  const assignments = await ctx.listAssignments(filters)
  return ok(200, { assignments })
}

export async function postActivity(ctx: ApiContext, input: unknown): Promise<ApiResponse> {
  if (!validateObject(input)) return err(400, 'Body must be a JSON object')
  await ctx.appendActivity(input as Record<string, unknown>)
  return ok(200, { ok: true })
}

export async function createDecision(ctx: ApiContext, input: unknown): Promise<ApiResponse> {
  if (!validateObject(input)) return err(400, 'Invalid body')
  const o = input as Record<string, unknown>
  if (!o.title || !o.detail) return err(400, 'title and detail required')
  const decision = await ctx.createDecision(o)
  emit({ type: 'decision.created', decisionId: String(decision.id), title: String(decision.title) })
  return ok(201, { ok: true, decision })
}

export async function patchDecision(ctx: ApiContext, decisionId: string, input: unknown): Promise<ApiResponse> {
  if (!validateObject(input)) return err(400, 'Body must be a JSON object')
  const o = input as Record<string, unknown>
  if (o.status && !VALID_DECISION_STATUSES.includes(o.status as typeof VALID_DECISION_STATUSES[number])) {
    return err(400, `Invalid status. Must be: ${VALID_DECISION_STATUSES.join(', ')}`)
  }
  const found = await ctx.updateDecision(decisionId, o)
  if (!found) return err(404, 'Decision not found')
  return ok(200, { ok: true })
}

export async function sendMessage(ctx: ApiContext, input: unknown): Promise<ApiResponse> {
  if (!validateObject(input)) return err(400, 'Invalid body')
  const o = input as Record<string, unknown>
  if (!o.fromAgentId || !o.message) return err(400, 'fromAgentId and message required')
  const msg = await ctx.sendMessage(o)
  emit({ type: 'message.sent', messageId: String(msg.id), fromAgentId: String(o.fromAgentId), roomId: o.roomId ? String(o.roomId) : null })
  return ok(201, { ok: true, message: msg })
}

export async function listMessages(ctx: ApiContext, filters: { room?: string; agent?: string }): Promise<ApiResponse> {
  const messages = await ctx.listMessages(filters)
  return ok(200, { messages })
}

export async function createRoom(ctx: ApiContext, input: unknown): Promise<ApiResponse> {
  if (!validateObject(input)) return err(400, 'Body must be a JSON object')
  const o = input as Record<string, unknown>
  const missing = findMissing(o, ['id', 'name', 'team', 'purpose'])
  if (missing.length) return err(400, `Missing: ${missing.join(', ')}`)
  if (!AGENT_ID_RE.test(String(o.id))) return err(400, 'id must be kebab-case')
  if (!o.zone || typeof (o.zone as Record<string, unknown>).x !== 'number') return err(400, 'zone with x,y,w,h required')
  try {
    const result = await ctx.createRoom(o)
    return ok(201, { ok: true, id: result.id })
  } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    if (msg.includes('exists') || msg.includes('UNIQUE')) return err(409, 'Room exists')
    throw e
  }
}

export async function putRoom(ctx: ApiContext, roomId: string, input: unknown): Promise<ApiResponse> {
  if (!validateObject(input)) return err(400, 'Body must be a JSON object')
  const found = await ctx.updateRoom(roomId, input as Record<string, unknown>)
  if (!found) return err(404, 'Room not found')
  return ok(200, { ok: true })
}

export async function deleteRoom(ctx: ApiContext, roomId: string): Promise<ApiResponse> {
  if (roomId === 'commons') return err(400, 'Cannot delete Commons')
  const found = await ctx.deleteRoom(roomId)
  if (!found) return err(404, 'Room not found')
  return ok(200, { ok: true })
}

export async function createWebhook(ctx: ApiContext, input: unknown): Promise<ApiResponse> {
  if (!validateObject(input)) return err(400, 'Invalid body')
  const o = input as Record<string, unknown>
  if (!o.url) return err(400, 'url required')
  const webhook = await ctx.createWebhook(o)
  return ok(201, { ok: true, webhook })
}

export async function deleteWebhook(ctx: ApiContext, webhookId: string): Promise<ApiResponse> {
  await ctx.deleteWebhook(webhookId)
  return ok(200, { ok: true })
}

export async function updateSettings(ctx: ApiContext, input: unknown): Promise<ApiResponse> {
  if (!validateObject(input)) return err(400, 'Body must be a JSON object')
  const settings = await ctx.updateSettings(input as Record<string, unknown>)
  return ok(200, { ok: true, settings })
}

export async function getHealth(ctx: ApiContext, startTime: number): Promise<ApiResponse> {
  let dbType = 'sqlite'
  try {
    const snap = await ctx.getSnapshot()
    if (snap.source === 'postgres') dbType = 'postgres'
  } catch { /* default to sqlite */ }
  return ok(200, {
    status: 'ok',
    version: '0.3.0',
    database: dbType,
    telegram: process.env.TELEGRAM_BOT_TOKEN ? 'enabled' : 'disabled',
    uptime: Math.floor((Date.now() - startTime) / 1000),
  })
}

// ── Router helper ────────────────────────────────────

export interface RouteResult {
  handled: boolean
  response?: ApiResponse
}

const AGENT_RE = /^\/api\/office\/agent\/([a-z0-9-]+)$/
const ASSIGNMENT_RE = /^\/api\/office\/assignment\/([a-z0-9-]+)$/
const RESULT_SAVE_RE = /^\/api\/office\/result\/([a-z0-9-]+)\/save$/
const DECISION_RE = /^\/api\/office\/decision\/([a-z0-9-]+)$/
const ROOM_RE = /^\/api\/office\/room\/([a-z0-9-]+)$/
const WEBHOOK_RE = /^\/api\/office\/webhook\/([a-z0-9-]+)$/

export async function routeRequest(
  ctx: ApiContext,
  method: string,
  pathname: string,
  body: unknown,
  searchParams?: URLSearchParams,
  startTime?: number,
  rawBody?: string,
  headers?: Record<string, string | undefined>,
): Promise<RouteResult> {
  // Health
  if (pathname === '/api/health' && method === 'GET') {
    return { handled: true, response: await getHealth(ctx, startTime ?? Date.now()) }
  }
  // Snapshot
  if (pathname === '/api/office/snapshot' && method === 'GET') {
    return { handled: true, response: await getSnapshot(ctx) }
  }
  // Agent routes
  const agentMatch = pathname.match(AGENT_RE)
  if (agentMatch) {
    if (method === 'PATCH') return { handled: true, response: await patchAgent(ctx, agentMatch[1], body) }
    if (method === 'PUT') return { handled: true, response: await putAgent(ctx, agentMatch[1], body) }
    if (method === 'DELETE') return { handled: true, response: await deleteAgent(ctx, agentMatch[1]) }
  }
  if (pathname === '/api/office/agent' && method === 'POST') {
    return { handled: true, response: await createAgent(ctx, body) }
  }
  // Assignment routes
  const assignMatch = pathname.match(ASSIGNMENT_RE)
  if (assignMatch && method === 'PATCH') {
    return { handled: true, response: await patchAssignment(ctx, assignMatch[1], body) }
  }
  if (pathname === '/api/office/assign' && method === 'POST') {
    return { handled: true, response: await createAssignment(ctx, body) }
  }
  if (pathname.startsWith('/api/office/assignments') && method === 'GET') {
    return { handled: true, response: await listAssignments(ctx, {
      status: searchParams?.get('status') ?? undefined,
      agent: searchParams?.get('agent') ?? undefined,
      limit: Math.min(Number(searchParams?.get('limit') || 100), 500),
    })}
  }
  // Result save
  const resultMatch = pathname.match(RESULT_SAVE_RE)
  if (resultMatch && method === 'POST') {
    return { handled: true, response: await saveResult(ctx, resultMatch[1]) }
  }
  // Activity
  if (pathname === '/api/office/activity' && method === 'POST') {
    return { handled: true, response: await postActivity(ctx, body) }
  }
  // Decision routes
  const decisionMatch = pathname.match(DECISION_RE)
  if (decisionMatch && method === 'PATCH') {
    return { handled: true, response: await patchDecision(ctx, decisionMatch[1], body) }
  }
  if (pathname === '/api/office/decision' && method === 'POST') {
    return { handled: true, response: await createDecision(ctx, body) }
  }
  // Message routes
  if (pathname === '/api/office/message' && method === 'POST') {
    return { handled: true, response: await sendMessage(ctx, body) }
  }
  if (pathname.startsWith('/api/office/messages') && method === 'GET') {
    return { handled: true, response: await listMessages(ctx, {
      room: searchParams?.get('room') ?? undefined,
      agent: searchParams?.get('agent') ?? undefined,
    })}
  }
  // Room routes
  const roomMatch = pathname.match(ROOM_RE)
  if (roomMatch) {
    if (method === 'PUT') return { handled: true, response: await putRoom(ctx, roomMatch[1], body) }
    if (method === 'DELETE') return { handled: true, response: await deleteRoom(ctx, roomMatch[1]) }
  }
  if (pathname === '/api/office/room' && method === 'POST') {
    return { handled: true, response: await createRoom(ctx, body) }
  }
  // Webhook routes
  const webhookMatch = pathname.match(WEBHOOK_RE)
  if (webhookMatch && method === 'DELETE') {
    return { handled: true, response: await deleteWebhook(ctx, webhookMatch[1]) }
  }
  if (pathname === '/api/office/webhook' && method === 'POST') {
    return { handled: true, response: await createWebhook(ctx, body) }
  }
  // Settings
  if (pathname === '/api/office/settings' && method === 'PATCH') {
    return { handled: true, response: await updateSettings(ctx, body) }
  }
  // Integration inbound webhooks
  if (pathname.startsWith('/api/integrations/') && method === 'POST' && ctx.integrationWebhooks) {
    const name = pathname.replace('/api/integrations/', '')
    const handler = ctx.integrationWebhooks[name]
    if (handler && rawBody !== undefined && headers) {
      try {
        const result = await handler({ body: rawBody, headers })
        return { handled: true, response: { status: result.status, body: result.body } }
      } catch (e) {
        return { handled: true, response: err(500, 'Integration webhook error') }
      }
    }
  }

  return { handled: false }
}
