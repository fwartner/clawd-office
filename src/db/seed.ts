/**
 * Seed data — populates empty database with default rooms.
 * Only inserts if tables are empty (idempotent).
 */
import { eq, sql } from 'drizzle-orm'
import type { DbConnection } from './index.js'

const SEED_ROOMS = [
  { id: 'planning-studio', name: 'Planning Studio', team: 'Product + UX', purpose: 'Scope, flows, and meeting-driven coordination', zoneX: 25, zoneY: 3, zoneW: 50, zoneH: 27 },
  { id: 'shipyard', name: 'Shipyard', team: 'Build', purpose: 'Implementation room for active engineering work', zoneX: 2, zoneY: 33, zoneW: 58, zoneH: 30 },
  { id: 'systems-bay', name: 'Systems Bay', team: 'Platform', purpose: 'Architecture and systems decisions that support the whole office', zoneX: 62, zoneY: 33, zoneW: 36, zoneH: 22 },
  { id: 'commons', name: 'Commons', team: 'Shared Office', purpose: 'The shared place where all agents gather, coordinate, and expose presence together', zoneX: 2, zoneY: 68, zoneW: 58, zoneH: 30 },
  { id: 'signal-room', name: 'Signal Room', team: 'Ops', purpose: 'Status, reporting, decisions, and operational visibility', zoneX: 62, zoneY: 60, zoneW: 36, zoneH: 38 },
]

export async function seedDatabase(conn: DbConnection): Promise<void> {
  const { schema } = conn
  const db = conn.db as { select: Function; insert: Function }

  // Check if rooms exist
  const existingRooms = await db.select({ id: schema.officeRooms.id }).from(schema.officeRooms).limit(1)
  if (existingRooms.length > 0) {
    console.log('[db] Seed skipped — data already exists')
    return
  }

  // Insert rooms
  for (const room of SEED_ROOMS) {
    await db.insert(schema.officeRooms).values(room).onConflictDoNothing()
  }

  console.log('[db] Seed data applied (5 rooms)')
}
