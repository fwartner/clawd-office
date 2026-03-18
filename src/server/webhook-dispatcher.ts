/**
 * Webhook dispatcher — delivers events to configured webhook URLs.
 * Supports HMAC-SHA256 signatures, retry on failure, and log recording.
 */
import crypto from 'node:crypto'
import { onAll, type OfficeEvent } from './events.js'
import type { ApiContext } from './api-routes.js'

let _ctx: ApiContext | null = null

export function initWebhookDispatcher(ctx: ApiContext): void {
  _ctx = ctx
  onAll(handleEvent)
}

async function handleEvent(event: OfficeEvent): Promise<void> {
  if (!_ctx) return
  try {
    const snapshot = await _ctx.getSnapshot()
    const webhooks = (snapshot.webhooks || []) as Array<{ id: string; url: string; secret: string; events: string[]; enabled: boolean }>
    for (const wh of webhooks) {
      if (!wh.enabled) continue
      if (wh.events.length > 0 && !wh.events.includes(event.type)) continue
      deliverWebhook(wh, event)
    }
  } catch { /* no webhooks configured */ }
}

async function deliverWebhook(
  wh: { id: string; url: string; secret: string; events: string[] },
  event: OfficeEvent,
): Promise<void> {
  const body = JSON.stringify({ event: event.type, payload: event, timestamp: new Date().toISOString() })
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (wh.secret) {
    headers['X-Webhook-Signature'] = crypto.createHmac('sha256', wh.secret).update(body).digest('hex')
  }

  const attempt = async (): Promise<number> => {
    try {
      const res = await fetch(wh.url, { method: 'POST', headers, body, signal: AbortSignal.timeout(10000) })
      return res.status
    } catch {
      return 0
    }
  }

  let statusCode = await attempt()
  if (statusCode === 0) {
    // Retry once after 5s
    await new Promise(r => setTimeout(r, 5000))
    statusCode = await attempt()
  }

  // Log delivery
  if (_ctx) {
    try {
      await _ctx.logWebhookDelivery(wh.id, event.type, statusCode)
    } catch { /* best effort */ }
  }
}
