/**
 * Agent Runtime — Process manager for Claude Code agent spawning.
 * Shared by both vite.config.ts (dev) and server.mjs (prod).
 */
import { spawn } from 'node:child_process'

const CLAUDE_CMD = process.env.CLAUDE_CMD || 'claude'
const MAX_RESULT_LEN = 2000

/** @type {Map<string, { agentId: string, name: string, role: string, currentTask: { assignmentId: string, childProcess: import('child_process').ChildProcess } | null }>} */
const registry = new Map()

/** @type {ReturnType<typeof setInterval> | null} */
let queueTimer = null

/**
 * Register an agent in the runtime registry.
 * @param {string} agentId
 * @param {string} name
 * @param {string} role
 */
export function registerAgent(agentId, name, role) {
  if (registry.has(agentId)) return
  registry.set(agentId, { agentId, name, role, currentTask: null })
  console.log(`[agent-runtime] Registered agent: ${agentId} (${name})`)
}

/**
 * Unregister an agent and kill any in-flight subprocess.
 * @param {string} agentId
 */
export function unregisterAgent(agentId) {
  const entry = registry.get(agentId)
  if (!entry) return
  if (entry.currentTask) {
    try {
      entry.currentTask.childProcess.kill('SIGTERM')
    } catch { /* already dead */ }
    console.log(`[agent-runtime] Killed running task for agent: ${agentId}`)
  }
  registry.delete(agentId)
  console.log(`[agent-runtime] Unregistered agent: ${agentId}`)
}

/**
 * Dispatch a task to an agent via `claude -p`.
 * @param {string} agentId
 * @param {{ id: string, taskTitle: string, taskBrief: string }} assignment
 * @param {{ onStart: (id: string) => void|Promise<void>, onComplete: (id: string, result: string) => void|Promise<void>, onError: (id: string, error: string) => void|Promise<void> }} callbacks
 * @returns {boolean} true if dispatch started, false if agent busy/unregistered
 */
export function dispatchTask(agentId, assignment, callbacks) {
  const entry = registry.get(agentId)
  if (!entry) {
    console.warn(`[agent-runtime] Cannot dispatch — agent ${agentId} not registered`)
    return false
  }
  if (entry.currentTask) {
    console.warn(`[agent-runtime] Cannot dispatch — agent ${agentId} is busy with ${entry.currentTask.assignmentId}`)
    return false
  }

  const prompt = `You are ${entry.name}, a ${entry.role}.\n\nTask: ${assignment.taskTitle}\n\n${assignment.taskBrief || ''}\n\nProvide your response directly.`

  const args = [
    '-p', prompt,
    '--output-format', 'json',
    '--max-turns', '3',
    '--dangerously-skip-permissions',
  ]

  console.log(`[agent-runtime] Dispatching task "${assignment.taskTitle}" to ${agentId}`)

  const child = spawn(CLAUDE_CMD, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 300_000, // 5 minute timeout
  })

  entry.currentTask = { assignmentId: assignment.id, childProcess: child }

  // Notify start
  Promise.resolve(callbacks.onStart(assignment.id)).catch(err =>
    console.error(`[agent-runtime] onStart callback error:`, err)
  )

  let stdout = ''
  let stderr = ''

  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })

  child.on('close', (code) => {
    entry.currentTask = null

    if (code === 0) {
      let resultText = ''
      try {
        const parsed = JSON.parse(stdout)
        resultText = parsed.result || parsed.text || stdout
      } catch {
        resultText = stdout
      }
      // Truncate to max length
      if (typeof resultText === 'string' && resultText.length > MAX_RESULT_LEN) {
        resultText = resultText.slice(0, MAX_RESULT_LEN - 3) + '...'
      }
      console.log(`[agent-runtime] Task "${assignment.taskTitle}" completed by ${agentId}`)
      Promise.resolve(callbacks.onComplete(assignment.id, String(resultText))).catch(err =>
        console.error(`[agent-runtime] onComplete callback error:`, err)
      )
    } else {
      const errorMsg = stderr.trim() || `Process exited with code ${code}`
      console.error(`[agent-runtime] Task "${assignment.taskTitle}" failed for ${agentId}: ${errorMsg}`)
      Promise.resolve(callbacks.onError(assignment.id, errorMsg.slice(0, 500))).catch(err =>
        console.error(`[agent-runtime] onError callback error:`, err)
      )
    }
  })

  child.on('error', (err) => {
    entry.currentTask = null
    console.error(`[agent-runtime] Spawn error for ${agentId}:`, err.message)
    Promise.resolve(callbacks.onError(assignment.id, err.message)).catch(cbErr =>
      console.error(`[agent-runtime] onError callback error:`, cbErr)
    )
  })

  return true
}

/**
 * Get the runtime status of a single agent.
 * @param {string} agentId
 * @returns {'idle' | 'busy' | 'unregistered'}
 */
export function getAgentStatus(agentId) {
  const entry = registry.get(agentId)
  if (!entry) return 'unregistered'
  return entry.currentTask ? 'busy' : 'idle'
}

/**
 * Get runtime statuses for all registered agents.
 * @returns {Array<{ agentId: string, registered: boolean, busy: boolean, currentAssignmentId: string | null }>}
 */
export function getAllAgentStatuses() {
  const statuses = []
  for (const [agentId, entry] of registry) {
    statuses.push({
      agentId,
      registered: true,
      busy: !!entry.currentTask,
      currentAssignmentId: entry.currentTask?.assignmentId ?? null,
    })
  }
  return statuses
}

/**
 * Start the task queue processor.
 * @param {number} intervalMs
 * @param {() => Array<{ id: string, targetAgentId: string, taskTitle: string, taskBrief: string, routingTarget: string }>} getQueuedTasks
 * @param {(assignment: object) => void} dispatchFn
 */
export function startTaskQueue(intervalMs, getQueuedTasks, dispatchFn) {
  if (queueTimer) clearInterval(queueTimer)
  queueTimer = setInterval(() => {
    try {
      const queued = getQueuedTasks()
      for (const assignment of queued) {
        const status = getAgentStatus(assignment.targetAgentId)
        if (status === 'idle') {
          dispatchFn(assignment)
        }
      }
    } catch (err) {
      console.error('[agent-runtime] Queue processor error:', err)
    }
  }, intervalMs)
  console.log(`[agent-runtime] Task queue processor started (${intervalMs}ms interval)`)
}

/**
 * Kill all running subprocesses and stop the queue.
 */
export function shutdownAll() {
  if (queueTimer) {
    clearInterval(queueTimer)
    queueTimer = null
  }
  for (const [agentId, entry] of registry) {
    if (entry.currentTask) {
      try {
        entry.currentTask.childProcess.kill('SIGTERM')
      } catch { /* already dead */ }
      console.log(`[agent-runtime] Killed task for ${agentId} during shutdown`)
    }
  }
  registry.clear()
  console.log('[agent-runtime] Shutdown complete')
}
