/**
 * GitHub integration — bidirectional.
 * Inbound: webhook receiver for push/PR/issue events -> activity feed.
 * Outbound: creates GitHub issues when tasks complete.
 *
 * Env: GITHUB_TOKEN, GITHUB_WEBHOOK_SECRET, GITHUB_REPO (owner/repo)
 */
import crypto from 'node:crypto'
import { on, type OfficeEvent } from '../events.js'
import type { ApiContext } from '../api-routes.js'

const GITHUB_TOKEN = process.env.GITHUB_TOKEN
const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET
const GITHUB_REPO = process.env.GITHUB_REPO // e.g. "acme/clawd-office"

const API_BASE = 'https://api.github.com'

function ghFetch(path: string, opts: RequestInit = {}): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.headers as Record<string, string> | undefined),
    },
  })
}

function verifySignature(payload: string, signature: string | undefined): boolean {
  if (!GITHUB_WEBHOOK_SECRET || !signature) return false
  const hmac = crypto.createHmac('sha256', GITHUB_WEBHOOK_SECRET)
  hmac.update(payload)
  const expected = `sha256=${hmac.digest('hex')}`
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
}

/** Maps a GitHub webhook event to an activity feed entry. */
function webhookToActivity(
  event: string,
  body: Record<string, unknown>,
): { agentId: string; message: string } | null {
  if (event === 'push') {
    const commits = (body.commits as unknown[]) ?? []
    return { agentId: 'github', message: `Push: ${commits.length} commit(s) to ${body.ref}` }
  }
  if (event === 'pull_request') {
    const pr = body.pull_request as Record<string, unknown>
    return { agentId: 'github', message: `PR ${body.action}: ${pr?.title ?? 'unknown'}` }
  }
  if (event === 'issues') {
    const issue = body.issue as Record<string, unknown>
    return { agentId: 'github', message: `Issue ${body.action}: ${issue?.title ?? 'unknown'}` }
  }
  return null
}

/** Creates a GitHub issue summarising a completed task. */
function createIssueForTask(event: OfficeEvent & { type: 'task.completed' }): void {
  if (!GITHUB_REPO || !GITHUB_TOKEN) return
  ghFetch(`/repos/${GITHUB_REPO}/issues`, {
    method: 'POST',
    body: JSON.stringify({
      title: `[Clawd] Task completed: ${event.title}`,
      body: `Agent \`${event.agentId}\` completed assignment \`${event.assignmentId}\`.\n\n**Result**\n${event.result.slice(0, 2000)}`,
      labels: ['clawd-office'],
    }),
  }).catch((err) => console.error('[github] create issue failed:', err))
}

/**
 * Returns an HTTP handler for the GitHub webhook receiver.
 * Attach this to your server at POST /webhooks/github.
 */
export function webhookHandler(ctx: ApiContext) {
  return async (req: { body: string; headers: Record<string, string | undefined> }) => {
    const sig = req.headers['x-hub-signature-256']
    if (!verifySignature(req.body, sig)) {
      return { status: 401, body: { error: 'invalid signature' } }
    }
    const event = req.headers['x-github-event'] ?? 'unknown'
    const payload = JSON.parse(req.body) as Record<string, unknown>
    const activity = webhookToActivity(event, payload)
    if (activity) {
      await ctx.appendActivity({
        agentId: activity.agentId,
        kind: 'system',
        text: activity.message,
      })
    }
    return { status: 200, body: { ok: true } }
  }
}

export function init(ctx: ApiContext): void {
  if (!GITHUB_TOKEN && !GITHUB_WEBHOOK_SECRET) {
    console.log('[github] GITHUB_TOKEN / GITHUB_WEBHOOK_SECRET not set — integration disabled')
    return
  }
  console.log('[github] integration enabled')

  on('task.completed', (e) => createIssueForTask(e as OfficeEvent & { type: 'task.completed' }))
}
