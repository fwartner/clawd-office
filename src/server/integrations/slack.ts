/**
 * Slack integration — outbound only via Incoming Webhook.
 * Sends Block Kit messages for key office events.
 *
 * Env: SLACK_WEBHOOK_URL
 */
import { on, type OfficeEvent } from '../events.js'
import type { ApiContext } from '../api-routes.js'

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL

function post(blocks: unknown[], text: string): void {
  if (!SLACK_WEBHOOK_URL) return
  fetch(SLACK_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, blocks }),
  }).catch((err) => {
    console.error('[slack] webhook delivery failed:', err)
  })
}

function headerBlock(text: string): Record<string, unknown> {
  return { type: 'header', text: { type: 'plain_text', text, emoji: true } }
}

function sectionBlock(markdown: string): Record<string, unknown> {
  return { type: 'section', text: { type: 'mrkdwn', text: markdown } }
}

function handleTaskCompleted(event: OfficeEvent & { type: 'task.completed' }): void {
  post(
    [
      headerBlock('Task Completed'),
      sectionBlock(
        `*${event.title}*\nAgent: \`${event.agentId}\`\nResult: ${event.result.slice(0, 500)}`,
      ),
    ],
    `Task completed: ${event.title}`,
  )
}

function handleTaskFailed(event: OfficeEvent & { type: 'task.failed' }): void {
  post(
    [
      headerBlock('Task Failed'),
      sectionBlock(
        `*${event.title}*\nAgent: \`${event.agentId}\`\nError: ${event.error.slice(0, 500)}`,
      ),
    ],
    `Task failed: ${event.title}`,
  )
}

function handlePresenceChanged(event: OfficeEvent & { type: 'agent.presence_changed' }): void {
  if (event.to !== 'blocked') return
  post(
    [
      headerBlock('Agent Blocked'),
      sectionBlock(`Agent \`${event.agentId}\` changed from *${event.from}* to *blocked*.`),
    ],
    `Agent ${event.agentId} is now blocked`,
  )
}

function handleDecisionCreated(event: OfficeEvent & { type: 'decision.created' }): void {
  post(
    [
      headerBlock('New Decision'),
      sectionBlock(`*${event.title}*\nID: \`${event.decisionId}\``),
    ],
    `Decision created: ${event.title}`,
  )
}

export function init(_ctx: ApiContext): void {
  if (!SLACK_WEBHOOK_URL) {
    console.log('[slack] SLACK_WEBHOOK_URL not set — integration disabled')
    return
  }
  console.log('[slack] integration enabled')

  on('task.completed', (e) => handleTaskCompleted(e as OfficeEvent & { type: 'task.completed' }))
  on('task.failed', (e) => handleTaskFailed(e as OfficeEvent & { type: 'task.failed' }))
  on('agent.presence_changed', (e) =>
    handlePresenceChanged(e as OfficeEvent & { type: 'agent.presence_changed' }),
  )
  on('decision.created', (e) =>
    handleDecisionCreated(e as OfficeEvent & { type: 'decision.created' }),
  )
}
