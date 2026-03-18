# Clawd Office

A pixel-art virtual office for AI agent teams. Agents have live presence states, sit in themed rooms, and can be created, edited, assigned tasks, and deleted — all rendered in a retro-styled shared workspace.

> [!WARNING]
> **Early Development** — This project is under active development and may not work as expected.
> APIs, configuration, and features may change without notice. Use at your own risk.

[![CI](https://github.com/fwartner/clawd-office/actions/workflows/ci.yml/badge.svg)](https://github.com/fwartner/clawd-office/actions/workflows/ci.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue)
![React](https://img.shields.io/badge/React-18-61dafb)
![Vite](https://img.shields.io/badge/Vite-5-646cff)
![License](https://img.shields.io/badge/License-MIT-green)

## Screenshot

![Clawd Office screenshot](assets/readme/virtual-office-screenshot.jpg)

## Features

- **Pixel-art office map** — agents rendered as animated sprites on a tiled office floor
- **Live presence** — real-time status per agent (active, available, paused, blocked, in meeting, off hours)
- **Room navigation** — click rooms to see occupants and their current work
- **Agent CRUD** — create, edit, and delete agents directly from the UI
- **Task assignment** — queue tasks with priority and routing options
- **Activity feed** — chronological log of assignments, presence changes, and system events
- **Workday awareness** — Berlin-timezone office hours with automatic open/closed state
- **Accessible (WCAG 2.1 AA)** — skip link, ARIA landmarks, keyboard navigation, focus indicators, screen reader support
- **Mobile responsive** — breakpoints at 900/600/400px with touch-friendly targets
- **Dual backend** — Postgres primary with automatic JSON file fallback
- **Error resilience** — ErrorBoundary, connection banners, sprite fallbacks, input validation

## Quick Start

```bash
git clone https://github.com/fwartner/clawd-office.git
cd clawd-office
npm install
```

The **setup wizard** runs automatically after `npm install`. It walks you through:

1. **Backend selection** — JSON file (zero config) or PostgreSQL
2. **Server port** — defaults to 4173
3. **Office timezone** — auto-detected from your system
4. **Linear integration** — optional task dispatch to Linear

Then start developing:

```bash
npm run dev
```

### Setup Options

```bash
npm run setup          # re-run the wizard interactively
npm run setup:force    # re-run even if already completed
npm run setup:auto     # accept all defaults (non-interactive, CI-friendly)
```

## Deploy with Claude Code

Paste the following prompt into [Claude Code](https://claude.ai/claude-code) to clone, set up, and run the project:

```
Clone https://github.com/fwartner/clawd-office.git, run npm install (which triggers
the setup wizard), then start the dev server with npm run dev. Open the URL it prints
in my browser. If Postgres is not available, choose the JSON file backend when the
wizard asks.
```

## Deploy with OpenClaw

If you're running an [OpenClaw](https://github.com/openclaw) agent swarm, add this to your agent's task queue:

```
Clone https://github.com/fwartner/clawd-office.git into the workspace. Run npm install
with --yes flag (npm run setup:auto) to accept all defaults non-interactively. Then run
npm run serve:build to build and start the production server. Report back the URL.
```

## Configuration

The wizard writes a `.env` file. You can also create one manually from the template:

```bash
cp .env.example .env
```

| Variable | Default | Description |
|----------|---------|-------------|
| `PSQL_PATH` | `psql` (via PATH) | Path to the `psql` binary |
| `POSTGRES_DB` | `agent_memory` | Postgres database name |
| `LINEAR_BRIDGE_PATH` | `./scripts/create_linear_task_and_dispatch.py` | Path to the Linear bridge script |
| `OFFICE_TIMEZONE` | `Europe/Berlin` | Timezone for workday hours |

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Vite dev server with hot reload |
| `npm run build` | Type-check and build for production |
| `npm run serve` | Run production server (requires prior build) |
| `npm run serve:build` | Build and serve in one step |
| `npm test` | Run all tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run typecheck` | Run TypeScript type checking |

## Project Structure

```
src/
  App.tsx              # Main UI — map, side panel, agent sprites, CRUD forms
  office-provider.tsx  # React context — polling, state, CRUD, assignment logic
  data.ts              # Seed data — agents, rooms, seats, workday policy
  world.ts             # Sprite definitions, animation data, world entities
  error-boundary.tsx   # React error boundary with retry
  office-state.ts      # DB-style type definitions for Postgres
  main.tsx             # App entry point
  styles.css           # All styles — responsive, a11y, theming
  __tests__/           # Unit and component tests
server.mjs             # Production HTTP server (Postgres + file backend)
vite.config.ts         # Vite config with dev API plugin
sql/                   # Postgres schema and seed data
state/                 # Runtime state file (office-snapshot.json)
assets/                # Pixel art tilesets and character sprites
```

## API Endpoints

All endpoints are available in both dev (Vite plugin) and production (`server.mjs`).

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/office/snapshot` | Full office state |
| PATCH | `/api/office/agent/:id` | Update agent presence fields |
| POST | `/api/office/agent` | Create a new agent |
| PUT | `/api/office/agent/:id` | Full update of agent properties |
| DELETE | `/api/office/agent/:id` | Delete an agent |
| PATCH | `/api/office/assignment/:id` | Update assignment status |
| POST | `/api/office/assign` | Queue a task assignment |
| POST | `/api/office/activity` | Push an activity feed entry |

### Input Validation

- 1MB body size limit on all endpoints
- String length limits: title (200), brief (2000), name (100), role (200), focus (500)
- Field whitelist on agent PATCH
- Enum validation on presence, priority, routing target, assignment status
- Agent ID format: lowercase alphanumeric with hyphens only
- Prototype pollution prevention via explicit field copying

## Database

The production server uses Postgres as the primary backend with automatic fallback to a local JSON file. See `sql/office_state_schema.sql` for the full schema.

## Testing

```bash
npm test
```

149 tests across 10 test files covering:

- **Data integrity** — agents reference valid rooms, seats exist, zones in bounds
- **Sprite logic** — presence-based sprite selection, animation data, fallbacks
- **Error boundary** — fallback UI rendering and recovery
- **Type contracts** — office state record shapes
- **Server validation** — field whitelist, presence enum, required fields, path traversal, body limits
- **App components** — rendering, navigation, tab switching, agent selection
- **Agent CRUD** — create/edit/delete forms, ID validation, confirmation flow
- **Office provider** — state management, snapshot validation, assignment merging
- **Accessibility** — skip link, ARIA roles, labels, keyboard access, decorative elements

## Accessibility

- Skip-to-content link
- `<main>` landmark with ARIA tab roles
- Keyboard navigation for all interactive elements (Enter/Space/Escape/Arrow keys)
- `:focus-visible` indicators
- `aria-live="polite"` on activity feed
- `role="alert"` on connection errors
- Form labels (visually hidden where needed)
- Decorative elements marked `aria-hidden="true"`

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## Security

See [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## License

[MIT](LICENSE)

## Maintainer

**Florian Wartner** — [Pixel & Process](https://pixelandprocess.de)
Email: [florian@wartner.io](mailto:florian@wartner.io)
