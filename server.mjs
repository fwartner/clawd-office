#!/usr/bin/env node
/**
 * Production server for Agent Office.
 * Thin HTTP wrapper that delegates to the shared API layer.
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerAgent, unregisterAgent, dispatchTask, getAllAgentStatuses, startTaskQueue, shutdownAll } from './agent-runtime.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(__dirname, 'dist')
const STATE_FILE = path.join(__dirname, 'state/office-snapshot.json')
const RESULTS_DIR = path.join(__dirname, 'state/results')
const PORT = Number(process.env.PORT || (process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : 4173))
const MAX_BODY_SIZE = 1_048_576 // 1MB
const startTime = Date.now()

const ALLOWED_ROOTS = [DIST, path.join(__dirname, 'assets')]
const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
}

// ── Import shared API layer ─────────────────────────
const {
  routeRequest, createJsonContext, initWebhookDispatcher,
  initSlack, initGitHub, githubWebhookHandler,
  initLinear, linearWebhookHandler,
} = await import('./dist-server/server/index.js')
const { startBot, stopBot } = await import('./dist-server/bot/index.js')

// ── Build ApiContext ─────────────────────────────────
const apiCtx = createJsonContext(STATE_FILE, RESULTS_DIR)

// Wire agent runtime hooks
apiCtx.registerAgentRuntime = (id, name, role, systemPrompt) => registerAgent(id, name, role, systemPrompt)
apiCtx.unregisterAgentRuntime = (id) => unregisterAgent(id)
apiCtx.getAgentRuntimeStatuses = () => getAllAgentStatuses()

function createStateCallbacks() {
  return {
    async onStart(assignmentId) {
      const snap = await apiCtx.getSnapshot()
      const assignment = snap.assignments.find(a => a.id === assignmentId)
      if (!assignment) return
      await apiCtx.updateAssignment(assignmentId, 'active')
      await apiCtx.patchAgent(String(assignment.targetAgentId), { presence: 'active', focus: `Working on: ${assignment.taskTitle}` })
      await apiCtx.appendActivity({ kind: 'assignment', text: `${assignment.targetAgentId} started working on "${assignment.taskTitle}"`, agentId: assignment.targetAgentId })
    },
    async onComplete(assignmentId, result) {
      const snap = await apiCtx.getSnapshot()
      const assignment = snap.assignments.find(a => a.id === assignmentId)
      if (!assignment) return
      await apiCtx.updateAssignment(assignmentId, 'done', result)
      await apiCtx.patchAgent(String(assignment.targetAgentId), { presence: 'available', focus: `Completed: ${assignment.taskTitle}` })
      await apiCtx.appendActivity({ kind: 'assignment', text: `${assignment.targetAgentId} completed "${assignment.taskTitle}"`, agentId: assignment.targetAgentId })
    },
    async onError(assignmentId, error) {
      const snap = await apiCtx.getSnapshot()
      const assignment = snap.assignments.find(a => a.id === assignmentId)
      if (!assignment) return
      await apiCtx.updateAssignment(assignmentId, 'blocked')
      await apiCtx.patchAgent(String(assignment.targetAgentId), { presence: 'blocked', focus: `Error: ${error.slice(0, 100)}` })
      await apiCtx.appendActivity({ kind: 'system', text: `Task "${assignment.taskTitle}" failed: ${error.slice(0, 200)}`, agentId: assignment.targetAgentId })
    },
  }
}

apiCtx.dispatchToRuntime = (agentId, assignment) => {
  dispatchTask(agentId, assignment, createStateCallbacks())
}

// Init webhook dispatcher
initWebhookDispatcher(apiCtx)

// Init integrations (subscribe to events)
initSlack(apiCtx)
initGitHub(apiCtx)
initLinear(apiCtx)

// Register inbound webhook handlers
apiCtx.integrationWebhooks = {
  github: githubWebhookHandler(apiCtx),
  linear: linearWebhookHandler(apiCtx),
}

// ── HTTP helpers ─────────────────────────────────────
/** Returns { parsed, raw } — parsed is the JSON object, raw is the string for signature verification */
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
      if (!body) { resolve({ parsed: null, raw: '' }); return }
      try { resolve({ parsed: JSON.parse(body), raw: body }) } catch (e) { reject(e) }
    })
    req.on('error', (e) => { clearTimeout(timeout); reject(e) })
  })
}

function jsonResponse(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
  res.end(JSON.stringify(data))
}

function isSafePath(filePath) {
  const resolved = path.resolve(filePath)
  return ALLOWED_ROOTS.some(root => resolved.startsWith(root + path.sep) || resolved === root)
}

// ── HTTP Server ──────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    })
    res.end()
    return
  }

  // API routes — delegate to shared layer
  if (url.pathname.startsWith('/api/')) {
    try {
      let parsed = null
      let rawBody = ''
      if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
        const { parsed: p, raw } = await readBody(req)
        parsed = p
        rawBody = raw
      }
      const reqHeaders = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]))
      const result = await routeRequest(apiCtx, req.method, url.pathname, parsed, url.searchParams, startTime, rawBody, reqHeaders)
      if (result.handled && result.response) {
        jsonResponse(res, result.response.status, result.response.body)
        return
      }
    } catch (e) {
      console.error(`Error handling ${req.method} ${url.pathname}:`, e)
      jsonResponse(res, 400, { error: 'Invalid request' })
      return
    }
  }

  // Static files — assets
  let filePath = path.join(__dirname, url.pathname)
  if (url.pathname.startsWith('/assets/') && isSafePath(filePath) && fs.existsSync(filePath)) {
    const ext = path.extname(filePath)
    res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream', 'Cache-Control': 'public, max-age=86400', 'Access-Control-Allow-Origin': '*' })
    fs.createReadStream(filePath).pipe(res)
    return
  }

  // Static files — dist
  filePath = path.join(DIST, url.pathname === '/' ? 'index.html' : url.pathname)
  if (isSafePath(filePath) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath)
    res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000', 'Access-Control-Allow-Origin': '*' })
    fs.createReadStream(filePath).pipe(res)
    return
  }

  // SPA fallback
  const index = path.join(DIST, 'index.html')
  if (fs.existsSync(index)) {
    res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' })
    fs.createReadStream(index).pipe(res)
    return
  }

  res.writeHead(404)
  res.end('Not found')
})

// ── Startup ──────────────────────────────────────────
server.listen(PORT, '0.0.0.0', async () => {
  console.log(`Agent Office server running at http://0.0.0.0:${PORT}`)
  console.log(`State file: ${STATE_FILE}`)

  // Register existing agents with runtime
  try {
    const state = await apiCtx.getSnapshot()
    const agents = state.agents || []
    for (const agent of agents) {
      registerAgent(String(agent.id), String(agent.name || agent.id), String(agent.role || ''), String(agent.systemPrompt || ''))
    }
    // Re-queue stuck active assignments
    const assignments = state.assignments || []
    let changed = false
    for (const a of assignments) {
      if (a.status === 'active') {
        await apiCtx.updateAssignment(String(a.id), 'queued')
        changed = true
      }
    }
    if (changed) console.log('[agent-runtime] Re-queued stuck active assignments')
  } catch (err) {
    console.warn('[agent-runtime] Startup recovery error:', err.message)
  }

  // Start task queue processor
  startTaskQueue(5000, () => {
    try {
      // Synchronous read for queue check (JSON context uses fs.readFileSync internally)
      const snap = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'))
      return (snap.assignments || []).filter(a =>
        a.status === 'queued' && ['agent_runtime', 'both'].includes(a.routingTarget)
      )
    } catch { return [] }
  }, (assignment) => {
    dispatchTask(assignment.targetAgentId, assignment, createStateCallbacks())
  })

  // Start Telegram bot (if configured)
  if (process.env.TELEGRAM_BOT_TOKEN) {
    try {
      await startBot(process.env.TELEGRAM_BOT_TOKEN, apiCtx)
    } catch (err) {
      console.warn('[bot] Failed to start Telegram bot:', err.message)
    }
  }

  // Init integrations
  try {
    const slackMod = await import('./dist-server/server/index.js')
    // Integrations subscribe to events automatically via their init()
    // They're loaded as part of the server index bundle
  } catch { /* optional */ }
})

// ── Graceful shutdown ────────────────────────────────
function shutdown(signal) {
  console.log(`\n${signal} received — shutting down gracefully`)
  shutdownAll()
  stopBot()
  server.close(() => {
    console.log('Server closed')
    process.exit(0)
  })
  setTimeout(() => { process.exit(1) }, 5000)
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
