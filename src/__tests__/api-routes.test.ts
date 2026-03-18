import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// We test the compiled dist-server modules
// First verify they exist, then dynamic import
const distExists = fs.existsSync(path.resolve('dist-server/server/index.js'))

// Skip tests if dist-server not built
const describeIfBuilt = distExists ? describe : describe.skip

let routeRequest: Function
let createJsonContext: Function
let tmpDir: string
let stateFile: string
let resultsDir: string

describeIfBuilt('API Routes — shared layer', () => {
  beforeEach(async () => {
    const mod = await import('../../dist-server/server/index.js')
    routeRequest = mod.routeRequest
    createJsonContext = mod.createJsonContext

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-office-test-'))
    stateFile = path.join(tmpDir, 'state.json')
    resultsDir = path.join(tmpDir, 'results')

    // Write seed state
    const seed = {
      agents: [],
      rooms: [
        { id: 'commons', name: 'Commons', team: 'Shared', purpose: 'Shared space', agents: [], zone: { x: 0, y: 0, w: 100, h: 100 } },
      ],
      agentSeats: {},
      workdayPolicy: { timezone: 'UTC', days: 'Monday-Friday', hours: '09:00-17:00', pauseRule: '', sharedPlaceRule: '' },
      settings: { officeName: 'Test Office' },
      assignments: [],
      activity: [],
      decisions: [],
      messages: [],
      webhooks: [],
      webhookLogs: [],
      source: 'file',
      lastUpdatedAt: new Date().toISOString(),
    }
    fs.writeFileSync(stateFile, JSON.stringify(seed, null, 2))
  })

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* cleanup */ }
  })

  it('GET /api/office/snapshot returns state', async () => {
    const ctx = createJsonContext(stateFile, resultsDir)
    const result = await routeRequest(ctx, 'GET', '/api/office/snapshot', null, new URLSearchParams())
    expect(result.handled).toBe(true)
    expect(result.response.status).toBe(200)
    expect(result.response.body.rooms).toHaveLength(1)
    expect(result.response.body.agents).toHaveLength(0)
  })

  it('GET /api/health returns ok', async () => {
    const ctx = createJsonContext(stateFile, resultsDir)
    const result = await routeRequest(ctx, 'GET', '/api/health', null, new URLSearchParams(), Date.now())
    expect(result.handled).toBe(true)
    expect(result.response.status).toBe(200)
    expect(result.response.body.status).toBe('ok')
    expect(result.response.body.version).toBe('0.3.0')
  })

  it('POST /api/office/agent creates agent', async () => {
    const ctx = createJsonContext(stateFile, resultsDir)
    const body = { id: 'test-agent', name: 'Test', role: 'Tester', team: 'QA', roomId: 'commons' }
    const result = await routeRequest(ctx, 'POST', '/api/office/agent', body, new URLSearchParams())
    expect(result.handled).toBe(true)
    expect(result.response.status).toBe(201)
    expect(result.response.body.ok).toBe(true)
    expect(result.response.body.id).toBe('test-agent')

    // Verify in state
    const snap = await routeRequest(ctx, 'GET', '/api/office/snapshot', null, new URLSearchParams())
    expect(snap.response.body.agents).toHaveLength(1)
    expect(snap.response.body.agents[0].id).toBe('test-agent')
  })

  it('POST /api/office/agent rejects duplicate id', async () => {
    const ctx = createJsonContext(stateFile, resultsDir)
    const body = { id: 'dup', name: 'Dup', role: 'R', team: 'T', roomId: 'commons' }
    await routeRequest(ctx, 'POST', '/api/office/agent', body, new URLSearchParams())
    const result = await routeRequest(ctx, 'POST', '/api/office/agent', body, new URLSearchParams())
    expect(result.response.status).toBe(409)
  })

  it('POST /api/office/agent rejects invalid id', async () => {
    const ctx = createJsonContext(stateFile, resultsDir)
    const body = { id: 'BAD ID', name: 'X', role: 'R', team: 'T', roomId: 'commons' }
    const result = await routeRequest(ctx, 'POST', '/api/office/agent', body, new URLSearchParams())
    expect(result.response.status).toBe(400)
    expect(result.response.body.error).toContain('lowercase')
  })

  it('POST /api/office/agent rejects missing fields', async () => {
    const ctx = createJsonContext(stateFile, resultsDir)
    const result = await routeRequest(ctx, 'POST', '/api/office/agent', { id: 'x' }, new URLSearchParams())
    expect(result.response.status).toBe(400)
    expect(result.response.body.error).toContain('Missing')
  })

  it('DELETE /api/office/agent/:id removes agent', async () => {
    const ctx = createJsonContext(stateFile, resultsDir)
    await routeRequest(ctx, 'POST', '/api/office/agent', { id: 'del-me', name: 'Del', role: 'R', team: 'T', roomId: 'commons' }, new URLSearchParams())
    const result = await routeRequest(ctx, 'DELETE', '/api/office/agent/del-me', null, new URLSearchParams())
    expect(result.response.status).toBe(200)

    const snap = await routeRequest(ctx, 'GET', '/api/office/snapshot', null, new URLSearchParams())
    expect(snap.response.body.agents).toHaveLength(0)
  })

  it('PATCH /api/office/agent/:id updates presence', async () => {
    const ctx = createJsonContext(stateFile, resultsDir)
    await routeRequest(ctx, 'POST', '/api/office/agent', { id: 'patcher', name: 'P', role: 'R', team: 'T', roomId: 'commons' }, new URLSearchParams())
    const result = await routeRequest(ctx, 'PATCH', '/api/office/agent/patcher', { presence: 'blocked', focus: 'Stuck' }, new URLSearchParams())
    expect(result.response.status).toBe(200)

    const snap = await routeRequest(ctx, 'GET', '/api/office/snapshot', null, new URLSearchParams())
    expect(snap.response.body.agents[0].presence).toBe('blocked')
    expect(snap.response.body.agents[0].focus).toBe('Stuck')
  })

  it('PATCH /api/office/agent/:id rejects invalid presence', async () => {
    const ctx = createJsonContext(stateFile, resultsDir)
    await routeRequest(ctx, 'POST', '/api/office/agent', { id: 'bad-p', name: 'X', role: 'R', team: 'T', roomId: 'commons' }, new URLSearchParams())
    const result = await routeRequest(ctx, 'PATCH', '/api/office/agent/bad-p', { presence: 'INVALID' }, new URLSearchParams())
    expect(result.response.status).toBe(400)
  })

  it('POST /api/office/assign creates assignment', async () => {
    const ctx = createJsonContext(stateFile, resultsDir)
    await routeRequest(ctx, 'POST', '/api/office/agent', { id: 'worker', name: 'W', role: 'R', team: 'T', roomId: 'commons' }, new URLSearchParams())
    const result = await routeRequest(ctx, 'POST', '/api/office/assign', {
      targetAgentId: 'worker', taskTitle: 'Do something', priority: 'high', routingTarget: 'work_tracker'
    }, new URLSearchParams())
    expect(result.response.status).toBe(200)
    expect(result.response.body.ok).toBe(true)
    expect(result.response.body.persisted.status).toBe('queued')
  })

  it('POST /api/office/assign rejects invalid priority', async () => {
    const ctx = createJsonContext(stateFile, resultsDir)
    const result = await routeRequest(ctx, 'POST', '/api/office/assign', {
      targetAgentId: 'x', taskTitle: 'Y', priority: 'EXTREME', routingTarget: 'work_tracker'
    }, new URLSearchParams())
    expect(result.response.status).toBe(400)
    expect(result.response.body.error).toContain('priority')
  })

  it('POST /api/office/decision creates decision', async () => {
    const ctx = createJsonContext(stateFile, resultsDir)
    const result = await routeRequest(ctx, 'POST', '/api/office/decision', { title: 'Test Decision', detail: 'Details here' }, new URLSearchParams())
    expect(result.response.status).toBe(201)
    expect(result.response.body.decision.title).toBe('Test Decision')
    expect(result.response.body.decision.status).toBe('proposed')
  })

  it('POST /api/office/message sends message', async () => {
    const ctx = createJsonContext(stateFile, resultsDir)
    await routeRequest(ctx, 'POST', '/api/office/agent', { id: 'sender', name: 'S', role: 'R', team: 'T', roomId: 'commons' }, new URLSearchParams())
    const result = await routeRequest(ctx, 'POST', '/api/office/message', { fromAgentId: 'sender', message: 'Hello!' }, new URLSearchParams())
    expect(result.response.status).toBe(201)
    expect(result.response.body.message.message).toBe('Hello!')
  })

  it('unhandled routes return handled=false', async () => {
    const ctx = createJsonContext(stateFile, resultsDir)
    const result = await routeRequest(ctx, 'GET', '/not/an/api/route', null, new URLSearchParams())
    expect(result.handled).toBe(false)
  })
})
