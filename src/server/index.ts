/**
 * Server module entry point.
 * Re-exports everything needed by server.mjs and vite.config.ts.
 */
export { routeRequest, type ApiContext, type ApiResponse, type RouteResult, type SnapshotData } from './api-routes.js'
export { createJsonContext } from './json-context.js'
export { emit, on, onAll, off, eventBus } from './events.js'
export { initWebhookDispatcher } from './webhook-dispatcher.js'
export { init as initSlack } from './integrations/slack.js'
export { init as initGitHub, webhookHandler as githubWebhookHandler } from './integrations/github.js'
export { init as initLinear, webhookHandler as linearWebhookHandler } from './integrations/linear.js'
export {
  sanitizePatch, validateObject, findMissing, generateId,
  VALID_PRESENCE, VALID_ROUTING, VALID_PRIORITY, VALID_DECISION_STATUSES,
  ASSIGNMENT_STATUSES, AGENT_ID_RE, WEBHOOK_EVENTS,
  MAX_BODY_SIZE, MAX_TITLE_LEN, MAX_BRIEF_LEN, MAX_FOCUS_LEN,
  MAX_NAME_LEN, MAX_ROLE_LEN, MAX_SYSTEM_PROMPT_LEN, MAX_MESSAGE_LEN,
} from './validation.js'
