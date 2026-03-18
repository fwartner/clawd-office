/**
 * Drizzle ORM schema — PostgreSQL dialect.
 */
import { pgTable, text, boolean, real, integer, timestamp } from 'drizzle-orm/pg-core'

export const officeAgents = pgTable('office_agents', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  role: text('role').notNull(),
  team: text('team').notNull(),
  internalStaff: boolean('internal_staff').notNull().default(true),
  officeVisible: boolean('office_visible').notNull().default(true),
  characterId: text('character_id'),
  spriteSheet: text('sprite_sheet'),
  systemPrompt: text('system_prompt'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const officeRooms = pgTable('office_rooms', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  team: text('team').notNull(),
  purpose: text('purpose'),
  zoneX: real('zone_x').notNull(),
  zoneY: real('zone_y').notNull(),
  zoneW: real('zone_w').notNull(),
  zoneH: real('zone_h').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const officePresence = pgTable('office_presence', {
  agentId: text('agent_id').primaryKey().references(() => officeAgents.id, { onDelete: 'cascade' }),
  presenceState: text('presence_state').notNull().default('available'),
  effectivePresenceState: text('effective_presence_state').notNull().default('available'),
  criticalTask: boolean('critical_task').notNull().default(false),
  focus: text('focus'),
  collaborationMode: text('collaboration_mode'),
  officeHoursTimezone: text('office_hours_timezone').notNull().default('Europe/Berlin'),
  officeHoursDays: text('office_hours_days').notNull().default('Monday-Friday'),
  officeHoursWindow: text('office_hours_window').notNull().default('09:00-17:00'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const officeWorldEntities = pgTable('office_world_entities', {
  agentId: text('agent_id').primaryKey().references(() => officeAgents.id, { onDelete: 'cascade' }),
  roomId: text('room_id').notNull().references(() => officeRooms.id, { onDelete: 'cascade' }),
  anchorXPct: real('anchor_x_pct').notNull(),
  anchorYPct: real('anchor_y_pct').notNull(),
  facing: text('facing'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const officeAssignments = pgTable('office_assignments', {
  id: text('id').primaryKey(),
  targetAgentId: text('target_agent_id').notNull().references(() => officeAgents.id, { onDelete: 'cascade' }),
  taskTitle: text('task_title').notNull(),
  taskBrief: text('task_brief').notNull(),
  priority: text('priority').notNull().default('medium'),
  status: text('status').notNull().default('queued'),
  routingTarget: text('routing_target').notNull().default('work_tracker'),
  source: text('source').notNull().default('office_ui'),
  result: text('result'),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  durationMs: integer('duration_ms'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const officeActivityFeed = pgTable('office_activity_feed', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  agentId: text('agent_id').references(() => officeAgents.id, { onDelete: 'set null' }),
  roomId: text('room_id').references(() => officeRooms.id, { onDelete: 'set null' }),
  message: text('message').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const officeDecisions = pgTable('office_decisions', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  detail: text('detail').notNull(),
  status: text('status').notNull().default('proposed'),
  proposedBy: text('proposed_by').references(() => officeAgents.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const officeMessages = pgTable('office_messages', {
  id: text('id').primaryKey(),
  fromAgentId: text('from_agent_id').notNull().references(() => officeAgents.id, { onDelete: 'cascade' }),
  toAgentId: text('to_agent_id').references(() => officeAgents.id, { onDelete: 'cascade' }),
  roomId: text('room_id').references(() => officeRooms.id, { onDelete: 'cascade' }),
  message: text('message').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const officeWebhooks = pgTable('office_webhooks', {
  id: text('id').primaryKey(),
  url: text('url').notNull(),
  secret: text('secret').notNull().default(''),
  events: text('events').array().notNull().default([]),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const officeWebhookLogs = pgTable('office_webhook_logs', {
  id: text('id').primaryKey(),
  webhookId: text('webhook_id').notNull().references(() => officeWebhooks.id, { onDelete: 'cascade' }),
  event: text('event').notNull(),
  statusCode: integer('status_code'),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }).notNull().defaultNow(),
})
