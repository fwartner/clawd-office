# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Agent Office is a pixel-art virtual office for AI agent teams. Agents have live presence states, sit in themed rooms, and can be managed through a retro-styled UI or Telegram bot. Early development — APIs and features may change without notice.

## Commands

```bash
npm run dev           # Start Vite dev server (http://localhost:4173)
npm run build         # Build server + frontend (tsup + tsc + vite)
npm run build:server  # Build server modules only (tsup → dist-server/)
npm test              # Run all tests (vitest run)
npm run test:watch    # Tests in watch mode
npm run typecheck     # Type check frontend + server
npm run serve:build   # Build + start production server
npm run setup:force   # Re-run interactive setup wizard
npm run setup:auto    # Non-interactive setup (CI-friendly)
npm run db:generate   # Generate Drizzle migrations
npm run db:push       # Push schema to database
```

Run a single test file: `npx vitest run src/__tests__/app.test.tsx`

## Architecture

**Frontend:** React 18 + TypeScript 5.6 + Vite 5. Single-page app with pixel-art map, animated sprites, room navigation, agent CRUD forms, task assignment, and activity feed.

**Backend:** Node.js server (`server.mjs` for production, Vite plugin in `vite.config.ts` for dev). Shared API layer in `src/server/`. Default storage: SQLite via Drizzle ORM (zero-config). Optional: PostgreSQL via `DATABASE_URL` env var. Legacy JSON file fallback (`state/office-snapshot.json`) still supported.

**Telegram Bot:** Optional grammy-based bot activated by `TELEGRAM_BOT_TOKEN`. Full agent management via inline keyboards and conversation flows.

**Data flow:** `OfficeProvider` (React context) polls `GET /api/office/snapshot` every 2-3 seconds. Mutations go through provider methods → POST/PATCH/DELETE endpoints → DB or state file → next poll picks up changes.

**Event system:** `src/server/events.ts` — EventEmitter-based pub/sub. API routes emit events, adapters (webhook, Telegram, Slack, GitHub, Linear) subscribe.

### Key Files

| File | Role |
|------|------|
| `src/App.tsx` | Main UI — map canvas, room overlays, agent sprites, sidebar panels, forms |
| `src/office-provider.tsx` | React context — polling, state management, CRUD wrappers, validation |
| `src/data.ts` | Seed data — agents, rooms, seats, workday policy |
| `src/world.ts` | Sprite definitions, animation metadata, character sets |
| `src/office-state.ts` | TypeScript type definitions |
| `src/server/api-routes.ts` | Shared API route handlers (pure functions) |
| `src/server/validation.ts` | Shared validation constants and helpers |
| `src/server/events.ts` | Event bus for office events |
| `src/server/json-context.ts` | JSON file-backed ApiContext adapter |
| `src/server/webhook-dispatcher.ts` | Webhook delivery with HMAC + retry |
| `src/server/integrations/` | Slack, GitHub, Linear adapters |
| `src/db/schema.ts` | Drizzle ORM schema (SQLite) |
| `src/db/schema-pg.ts` | Drizzle ORM schema (PostgreSQL) |
| `src/db/index.ts` | DB connection factory |
| `src/db/migrate.ts` | Auto-migration runner |
| `src/db/seed.ts` | Seed data for empty databases |
| `src/bot/index.ts` | Telegram bot init, start/stop |
| `src/bot/commands.ts` | Bot command handlers |
| `src/bot/keyboards.ts` | Inline keyboard builders |
| `src/bot/callbacks.ts` | Button press handlers |
| `src/bot/conversations.ts` | Multi-step flows (create agent, assign task) |
| `src/bot/notifications.ts` | Push notifications to Telegram |
| `vite.config.ts` | Vite config + dev API plugin |
| `server.mjs` | Production HTTP server |
| `Dockerfile` | Multi-stage Docker build |
| `docker-compose.yml` | Full stack compose |

### API Endpoints

Shared route handlers in `src/server/api-routes.ts`, used by both dev and prod:

- `GET /api/health` — health check (status, version, DB type, uptime)
- `GET /api/office/snapshot` — full state
- `POST /api/office/agent` — create agent
- `PUT /api/office/agent/:id` — full update
- `PATCH /api/office/agent/:id` — partial update (whitelisted fields only)
- `DELETE /api/office/agent/:id` — remove agent + cascade
- `POST /api/office/assign` — queue task
- `PATCH /api/office/assignment/:id` — update assignment status
- `GET /api/office/assignments` — query assignments with filters
- `POST /api/office/activity` — log activity
- `POST /api/office/decision` — create decision
- `PATCH /api/office/decision/:id` — update decision
- `POST /api/office/message` — send message
- `GET /api/office/messages` — query messages
- `POST /api/office/room` — create room
- `PUT /api/office/room/:id` — update room
- `DELETE /api/office/room/:id` — delete room
- `POST /api/office/webhook` — create webhook
- `DELETE /api/office/webhook/:id` — delete webhook
- `PATCH /api/office/settings` — update settings

### Validation Constants (in src/server/validation.ts)

- Agent IDs: `/^[a-z0-9-]+$/` (kebab-case)
- Presence enum: `off_hours, available, active, in_meeting, paused, blocked`
- PATCH whitelist: `presence, focus, roomId, criticalTask, collaborationMode, xPct, yPct, systemPrompt`
- String limits: name (100), role (200), title (200), brief (2000), focus (500), systemPrompt (5000), message (2000)
- Body limit: 1MB

### TypeScript Configuration

- `tsconfig.json` — Frontend (React/Vite), excludes src/db, src/server, src/bot
- `tsconfig.server.json` — Server modules (Node.js), includes src/db, src/server, src/bot

## Testing

Tests live in `src/__tests__/` (component/unit) and `tests/` (API integration). 167+ tests covering data integrity, sprites, error boundary, provider logic, UI rendering, agent CRUD, accessibility, and API validation.

## Code Conventions

- TypeScript strict mode — no `any` types
- Functional React with hooks only (except ErrorBoundary)
- All CSS in `src/styles.css` — no CSS-in-JS, uses CSS custom properties
- Pixel-art aesthetic with Press Start 2P font — keep retro theme consistent
- WCAG 2.1 AA accessibility: ARIA landmarks, keyboard navigation, focus indicators
- Commit messages: conventional style (`fix:`, `feat:`, `test:`, etc.)
- No separate linter configured — TypeScript strict mode is the quality gate
