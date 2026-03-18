/** Linear integration — bidirectional. Env: LINEAR_API_KEY, LINEAR_WEBHOOK_SECRET, LINEAR_TEAM_ID */
import crypto from 'node:crypto'
import { on, type OfficeEvent } from '../events.js'
import type { ApiContext } from '../api-routes.js'

const LINEAR_API_KEY = process.env.LINEAR_API_KEY
const LINEAR_WEBHOOK_SECRET = process.env.LINEAR_WEBHOOK_SECRET
const LINEAR_TEAM_ID = process.env.LINEAR_TEAM_ID

const LINEAR_API = 'https://api.linear.app/graphql'

function gql(query: string, variables: Record<string, unknown> = {}): Promise<Response> {
  return fetch(LINEAR_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: LINEAR_API_KEY ?? '',
    },
    body: JSON.stringify({ query, variables }),
  })
}

function verifySignature(payload: string, signature: string | undefined): boolean {
  if (!LINEAR_WEBHOOK_SECRET || !signature) return false
  const hmac = crypto.createHmac('sha256', LINEAR_WEBHOOK_SECRET)
  hmac.update(payload)
  const expected = hmac.digest('hex')
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  } catch {
    return false
  }
}

/** Create a Linear issue for a new task assignment. */
function createIssue(event: OfficeEvent & { type: 'task.created' }): void {
  if (!LINEAR_API_KEY || !LINEAR_TEAM_ID) return
  const query = `
    mutation CreateIssue($input: IssueCreateInput!) {
      issueCreate(input: $input) { success issue { id identifier url } }
    }
  `
  gql(query, {
    input: {
      teamId: LINEAR_TEAM_ID,
      title: event.title,
      description: `Clawd Office assignment \`${event.assignmentId}\` for agent \`${event.agentId}\`.`,
    },
  }).catch((err) => console.error('[linear] create issue failed:', err))
}

/** Update a Linear issue when a task completes or fails. */
function updateIssueStatus(
  event: (OfficeEvent & { type: 'task.completed' }) | (OfficeEvent & { type: 'task.failed' }),
): void {
  if (!LINEAR_API_KEY) return
  // Search for the issue by title to find the matching identifier
  const searchQuery = `
    query Search($term: String!) {
      issueSearch(query: $term, first: 1) { nodes { id } }
    }
  `
  gql(searchQuery, { term: event.title })
    .then((res) => res.json())
    .then((data: Record<string, unknown>) => {
      const nodes = ((data as Record<string, unknown>).data as Record<string, unknown>)
        ?.issueSearch as Record<string, unknown[]> | undefined
      const issueId = (nodes?.nodes?.[0] as Record<string, string> | undefined)?.id
      if (!issueId) return
      const comment = event.type === 'task.completed'
        ? `Task completed. Result: ${(event as OfficeEvent & { type: 'task.completed' }).result.slice(0, 1000)}`
        : `Task failed. Error: ${(event as OfficeEvent & { type: 'task.failed' }).error.slice(0, 1000)}`
      return gql(
        `mutation($id: String!, $body: String!) { commentCreate(input: { issueId: $id, body: $body }) { success } }`,
        { id: issueId, body: comment },
      )
    })
    .catch((err) => console.error('[linear] update issue failed:', err))
}

/** HTTP handler for Linear webhook events. Attach at POST /webhooks/linear. */
export function webhookHandler(ctx: ApiContext) {
  return async (req: { body: string; headers: Record<string, string | undefined> }) => {
    const sig = req.headers['linear-signature']
    if (!verifySignature(req.body, sig)) {
      return { status: 401, body: { error: 'invalid signature' } }
    }
    const payload = JSON.parse(req.body) as Record<string, unknown>
    const action = payload.action as string | undefined
    const issueData = payload.data as Record<string, unknown> | undefined
    if (payload.type === 'Issue' && issueData) {
      await ctx.appendActivity({
        agentId: 'linear',
        kind: 'system',
        text: `Linear issue ${action}: ${issueData.title ?? issueData.id}`,
      })
    }
    return { status: 200, body: { ok: true } }
  }
}

export function init(_ctx: ApiContext): void {
  if (!LINEAR_API_KEY) {
    console.log('[linear] LINEAR_API_KEY not set — integration disabled')
    return
  }
  console.log('[linear] integration enabled')

  on('task.created', (e) => createIssue(e as OfficeEvent & { type: 'task.created' }))
  on('task.completed', (e) =>
    updateIssueStatus(e as OfficeEvent & { type: 'task.completed' }),
  )
  on('task.failed', (e) =>
    updateIssueStatus(e as OfficeEvent & { type: 'task.failed' }),
  )
}
