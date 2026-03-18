/**
 * Event bus — simple EventEmitter-based pub/sub for office events.
 * Adapters (webhook, Telegram, Slack, etc.) subscribe to events.
 */
import { EventEmitter } from 'node:events'

export type OfficeEvent =
  | { type: 'agent.created'; agentId: string; name: string }
  | { type: 'agent.deleted'; agentId: string }
  | { type: 'agent.presence_changed'; agentId: string; from: string; to: string }
  | { type: 'task.created'; assignmentId: string; agentId: string; title: string }
  | { type: 'task.completed'; assignmentId: string; agentId: string; title: string; result: string }
  | { type: 'task.failed'; assignmentId: string; agentId: string; title: string; error: string }
  | { type: 'decision.created'; decisionId: string; title: string }
  | { type: 'decision.updated'; decisionId: string; title: string; status: string }
  | { type: 'message.sent'; messageId: string; fromAgentId: string; roomId: string | null }

const bus = new EventEmitter()
bus.setMaxListeners(20)

export function emit(event: OfficeEvent): void {
  bus.emit('office_event', event)
  bus.emit(event.type, event)
}

export function on(eventType: string, handler: (event: OfficeEvent) => void): void {
  bus.on(eventType, handler)
}

export function onAll(handler: (event: OfficeEvent) => void): void {
  bus.on('office_event', handler)
}

export function off(eventType: string, handler: (event: OfficeEvent) => void): void {
  bus.off(eventType, handler)
}

export const eventBus = bus
