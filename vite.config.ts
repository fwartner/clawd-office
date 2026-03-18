import { defineConfig, type Plugin, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { registerAgent, unregisterAgent, dispatchTask, getAllAgentStatuses, startTaskQueue, shutdownAll } from './agent-runtime.mjs'

const STATE_FILE = path.resolve(__dirname, 'state/office-snapshot.json')
const RESULTS_DIR = path.resolve(__dirname, 'state/results')
const MAX_BODY_SIZE = 1_048_576
const startTime = Date.now()

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = ''
    let size = 0
    const timeout = setTimeout(() => { reject(new Error('Request timeout')); req.destroy() }, 10_000)
    req.on('data', (chunk: Buffer | string) => {
      size += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length
      if (size > MAX_BODY_SIZE) { reject(new Error('Body too large')); req.destroy(); return }
      body += chunk
    })
    req.on('end', () => {
      clearTimeout(timeout)
      if (!body) { resolve(null); return }
      try { resolve(JSON.parse(body)) } catch (e) { reject(e) }
    })
    req.on('error', (e) => { clearTimeout(timeout); reject(e) })
  })
}

function officeApiPlugin(): Plugin {
  let apiReady = false
  let routeRequest: Function
  let apiCtx: Record<string, Function>

  return {
    name: 'office-api',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const url = new URL(req.url ?? '/', `http://localhost:4173`)

        if (!url.pathname.startsWith('/api/')) { next(); return }

        // Lazy-init: load compiled shared modules on first API request
        if (!apiReady) {
          try {
            const serverMod = await import('./dist-server/server/index.js')
            routeRequest = serverMod.routeRequest
            apiCtx = serverMod.createJsonContext(STATE_FILE, RESULTS_DIR)

            // Wire agent runtime
            apiCtx.registerAgentRuntime = (id: string, name: string, role: string, sp: string) => registerAgent(id, name, role, sp)
            apiCtx.unregisterAgentRuntime = (id: string) => unregisterAgent(id)
            apiCtx.getAgentRuntimeStatuses = () => getAllAgentStatuses()
            apiCtx.dispatchToRuntime = (agentId: string, assignment: Record<string, unknown>) => {
              dispatchTask(agentId, assignment, createDevStateCallbacks(apiCtx))
            }

            serverMod.initWebhookDispatcher(apiCtx)

            // Register existing agents
            try {
              const snap = await apiCtx.getSnapshot()
              for (const agent of (snap.agents || [])) {
                registerAgent(String(agent.id), String(agent.name || agent.id), String(agent.role || ''), String(agent.systemPrompt || ''))
              }
            } catch { /* empty state */ }

            // Start task queue
            startTaskQueue(5000, () => {
              try {
                const snap = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'))
                return (snap.assignments || []).filter((a: Record<string, string>) =>
                  a.status === 'queued' && ['agent_runtime', 'both'].includes(a.routingTarget)
                )
              } catch { return [] }
            }, (assignment: { targetAgentId: string }) => {
              dispatchTask(assignment.targetAgentId, assignment, createDevStateCallbacks(apiCtx))
            })

            // Start bot if configured
            if (process.env.TELEGRAM_BOT_TOKEN) {
              try {
                const botMod = await import('./dist-server/bot/index.js')
                await botMod.startBot(process.env.TELEGRAM_BOT_TOKEN, apiCtx)
              } catch (err) {
                console.warn('[bot] Failed to start:', (err as Error).message)
              }
            }

            apiReady = true
            console.log('[dev] Shared API layer loaded from dist-server/')
          } catch (err) {
            console.error('[dev] Failed to load dist-server/. Run `npm run build:server` first.', (err as Error).message)
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Server modules not built. Run: npm run build:server' }))
            return
          }
        }

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

        try {
          let body = null
          if (['POST', 'PUT', 'PATCH'].includes(req.method || '')) {
            body = await readBody(req)
          }
          const result = await routeRequest(apiCtx, req.method, url.pathname, body, url.searchParams, startTime)
          if (result.handled && result.response) {
            res.writeHead(result.response.status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
            res.end(JSON.stringify(result.response.body))
            return
          }
        } catch (e) {
          console.error(`Error handling ${req.method} ${url.pathname}:`, e)
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Invalid request' }))
          return
        }

        next()
      })

      server.httpServer?.on('close', () => { shutdownAll() })
    }
  }
}

function createDevStateCallbacks(ctx: Record<string, Function>) {
  return {
    async onStart(assignmentId: string) {
      try {
        const snap = await ctx.getSnapshot()
        const assignment = (snap.assignments || []).find((a: Record<string, string>) => a.id === assignmentId)
        if (!assignment) return
        await ctx.updateAssignment(assignmentId, 'active')
        await ctx.patchAgent(String(assignment.targetAgentId), { presence: 'active', focus: `Working on: ${assignment.taskTitle}` })
        await ctx.appendActivity({ kind: 'assignment', text: `${assignment.targetAgentId} started "${assignment.taskTitle}"`, agentId: assignment.targetAgentId })
      } catch (e) { console.error('[dev] onStart error:', e) }
    },
    async onComplete(assignmentId: string, result: string) {
      try {
        const snap = await ctx.getSnapshot()
        const assignment = (snap.assignments || []).find((a: Record<string, string>) => a.id === assignmentId)
        if (!assignment) return
        await ctx.updateAssignment(assignmentId, 'done', result)
        await ctx.patchAgent(String(assignment.targetAgentId), { presence: 'available', focus: `Completed: ${assignment.taskTitle}` })
        await ctx.appendActivity({ kind: 'assignment', text: `${assignment.targetAgentId} completed "${assignment.taskTitle}"`, agentId: assignment.targetAgentId })
      } catch (e) { console.error('[dev] onComplete error:', e) }
    },
    async onError(assignmentId: string, error: string) {
      try {
        const snap = await ctx.getSnapshot()
        const assignment = (snap.assignments || []).find((a: Record<string, string>) => a.id === assignmentId)
        if (!assignment) return
        await ctx.updateAssignment(assignmentId, 'blocked')
        await ctx.patchAgent(String(assignment.targetAgentId), { presence: 'blocked', focus: `Error: ${error.slice(0, 100)}` })
        await ctx.appendActivity({ kind: 'system', text: `Task "${assignment.taskTitle}" failed: ${error.slice(0, 200)}`, agentId: assignment.targetAgentId })
      } catch (e) { console.error('[dev] onError error:', e) }
    },
  }
}

export default defineConfig({
  plugins: [react(), officeApiPlugin()],
  server: {
    host: '0.0.0.0',
    port: 4173
  }
})
