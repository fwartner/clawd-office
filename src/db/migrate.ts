/**
 * Auto-migration runner — applies schema on startup (idempotent).
 *
 * For SQLite: uses drizzle-kit push approach via raw SQL from schema.
 * For Postgres: uses drizzle-kit push approach via raw SQL from schema.
 *
 * This creates tables if they don't exist (idempotent via IF NOT EXISTS).
 */
import type { DbConnection } from './index.js'

const SQLITE_DDL = `
CREATE TABLE IF NOT EXISTS office_agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  team TEXT NOT NULL,
  internal_staff INTEGER NOT NULL DEFAULT 1,
  office_visible INTEGER NOT NULL DEFAULT 1,
  character_id TEXT,
  sprite_sheet TEXT,
  system_prompt TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS office_rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  team TEXT NOT NULL,
  purpose TEXT,
  zone_x REAL NOT NULL,
  zone_y REAL NOT NULL,
  zone_w REAL NOT NULL,
  zone_h REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS office_presence (
  agent_id TEXT PRIMARY KEY REFERENCES office_agents(id) ON DELETE CASCADE,
  presence_state TEXT NOT NULL DEFAULT 'available',
  effective_presence_state TEXT NOT NULL DEFAULT 'available',
  critical_task INTEGER NOT NULL DEFAULT 0,
  focus TEXT,
  collaboration_mode TEXT,
  office_hours_timezone TEXT NOT NULL DEFAULT 'Europe/Berlin',
  office_hours_days TEXT NOT NULL DEFAULT 'Monday-Friday',
  office_hours_window TEXT NOT NULL DEFAULT '09:00-17:00',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS office_world_entities (
  agent_id TEXT PRIMARY KEY REFERENCES office_agents(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL REFERENCES office_rooms(id) ON DELETE CASCADE,
  anchor_x_pct REAL NOT NULL,
  anchor_y_pct REAL NOT NULL,
  facing TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS office_assignments (
  id TEXT PRIMARY KEY,
  target_agent_id TEXT NOT NULL REFERENCES office_agents(id) ON DELETE CASCADE,
  task_title TEXT NOT NULL,
  task_brief TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'queued',
  routing_target TEXT NOT NULL DEFAULT 'work_tracker',
  source TEXT NOT NULL DEFAULT 'office_ui',
  result TEXT,
  completed_at TEXT,
  duration_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS office_activity_feed (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  agent_id TEXT REFERENCES office_agents(id) ON DELETE SET NULL,
  room_id TEXT REFERENCES office_rooms(id) ON DELETE SET NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS office_decisions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed',
  proposed_by TEXT REFERENCES office_agents(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS office_messages (
  id TEXT PRIMARY KEY,
  from_agent_id TEXT NOT NULL REFERENCES office_agents(id) ON DELETE CASCADE,
  to_agent_id TEXT REFERENCES office_agents(id) ON DELETE CASCADE,
  room_id TEXT REFERENCES office_rooms(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS office_webhooks (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  secret TEXT NOT NULL DEFAULT '',
  events TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS office_webhook_logs (
  id TEXT PRIMARY KEY,
  webhook_id TEXT NOT NULL REFERENCES office_webhooks(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  status_code INTEGER,
  delivered_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS office_activity_feed_created_at_idx ON office_activity_feed (created_at DESC);
CREATE INDEX IF NOT EXISTS office_assignments_target_agent_id_idx ON office_assignments (target_agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS office_world_entities_room_id_idx ON office_world_entities (room_id);
CREATE INDEX IF NOT EXISTS office_messages_room_id_idx ON office_messages (room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS office_messages_to_agent_idx ON office_messages (to_agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS office_webhook_logs_webhook_id_idx ON office_webhook_logs (webhook_id, delivered_at DESC);
`

const POSTGRES_DDL = `
CREATE TABLE IF NOT EXISTS office_agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  team TEXT NOT NULL,
  internal_staff BOOLEAN NOT NULL DEFAULT TRUE,
  office_visible BOOLEAN NOT NULL DEFAULT TRUE,
  character_id TEXT,
  sprite_sheet TEXT,
  system_prompt TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS office_rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  team TEXT NOT NULL,
  purpose TEXT,
  zone_x REAL NOT NULL,
  zone_y REAL NOT NULL,
  zone_w REAL NOT NULL,
  zone_h REAL NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS office_presence (
  agent_id TEXT PRIMARY KEY REFERENCES office_agents(id) ON DELETE CASCADE,
  presence_state TEXT NOT NULL DEFAULT 'available',
  effective_presence_state TEXT NOT NULL DEFAULT 'available',
  critical_task BOOLEAN NOT NULL DEFAULT FALSE,
  focus TEXT,
  collaboration_mode TEXT,
  office_hours_timezone TEXT NOT NULL DEFAULT 'Europe/Berlin',
  office_hours_days TEXT NOT NULL DEFAULT 'Monday-Friday',
  office_hours_window TEXT NOT NULL DEFAULT '09:00-17:00',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS office_world_entities (
  agent_id TEXT PRIMARY KEY REFERENCES office_agents(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL REFERENCES office_rooms(id) ON DELETE CASCADE,
  anchor_x_pct REAL NOT NULL,
  anchor_y_pct REAL NOT NULL,
  facing TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS office_assignments (
  id TEXT PRIMARY KEY,
  target_agent_id TEXT NOT NULL REFERENCES office_agents(id) ON DELETE CASCADE,
  task_title TEXT NOT NULL,
  task_brief TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'queued',
  routing_target TEXT NOT NULL DEFAULT 'work_tracker',
  source TEXT NOT NULL DEFAULT 'office_ui',
  result TEXT,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS office_activity_feed (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  agent_id TEXT REFERENCES office_agents(id) ON DELETE SET NULL,
  room_id TEXT REFERENCES office_rooms(id) ON DELETE SET NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS office_decisions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed',
  proposed_by TEXT REFERENCES office_agents(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS office_messages (
  id TEXT PRIMARY KEY,
  from_agent_id TEXT NOT NULL REFERENCES office_agents(id) ON DELETE CASCADE,
  to_agent_id TEXT REFERENCES office_agents(id) ON DELETE CASCADE,
  room_id TEXT REFERENCES office_rooms(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS office_webhooks (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  secret TEXT NOT NULL DEFAULT '',
  events TEXT[] NOT NULL DEFAULT '{}',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS office_webhook_logs (
  id TEXT PRIMARY KEY,
  webhook_id TEXT NOT NULL REFERENCES office_webhooks(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  status_code INTEGER,
  delivered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS office_activity_feed_created_at_idx ON office_activity_feed (created_at DESC);
CREATE INDEX IF NOT EXISTS office_assignments_target_agent_id_idx ON office_assignments (target_agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS office_world_entities_room_id_idx ON office_world_entities (room_id);
CREATE INDEX IF NOT EXISTS office_messages_room_id_idx ON office_messages (room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS office_messages_to_agent_idx ON office_messages (to_agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS office_webhook_logs_webhook_id_idx ON office_webhook_logs (webhook_id, delivered_at DESC);
`

export async function runMigrations(conn: DbConnection): Promise<void> {
  const ddl = conn.dialect === 'postgres' ? POSTGRES_DDL : SQLITE_DDL
  const statements = ddl
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0)

  if (conn.dialect === 'sqlite') {
    // better-sqlite3 driver — access raw sqlite instance
    const rawDb = (conn.db as { session?: unknown })
    // For better-sqlite3 drizzle, we need the underlying database
    // The drizzle instance wraps it — access via internal
    const sqliteDb = (conn as unknown as { _sqliteDb?: unknown })
    // Actually, let's use sql tagged template from drizzle
    const { sql } = await import('drizzle-orm')
    for (const stmt of statements) {
      ;(conn.db as { run: (query: unknown) => void }).run(sql.raw(stmt))
    }
  } else {
    const { sql } = await import('drizzle-orm')
    for (const stmt of statements) {
      await (conn.db as { execute: (query: unknown) => Promise<unknown> }).execute(sql.raw(stmt))
    }
  }

  console.log(`[db] Migrations applied (${conn.dialect})`)
}
