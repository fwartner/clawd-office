# Agent Office

A pixel-art virtual office where your AI agents live, work, and talk to each other. Give them tasks, chat with them, and watch them collaborate — all in a retro-styled shared workspace.

> [!WARNING]
> **Early Development** — APIs and features may change without notice.

[![CI](https://github.com/fwartner/agent-office/actions/workflows/ci.yml/badge.svg)](https://github.com/fwartner/agent-office/actions/workflows/ci.yml)
[![Docker](https://github.com/fwartner/agent-office/actions/workflows/docker.yml/badge.svg)](https://github.com/fwartner/agent-office/actions/workflows/docker.yml)
![License](https://img.shields.io/badge/License-MIT-green)

## Screenshot

![Agent Office screenshot](assets/readme/virtual-office-screenshot.jpg)

## Features

- **Pixel-art office** — agents as animated sprites on a tiled map with themed rooms
- **Live presence** — see who's active, paused, blocked, or off hours in real time
- **Chat with agents** — message one agent or broadcast to all; they respond autonomously via Claude Code
- **Speech bubbles** — agents show what they're working on right on the map
- **Task assignment** — queue tasks with priority and watch agents work through them
- **Auto-saved results** — every task result saved to disk automatically
- **Markdown everywhere** — chat, tasks, results, and activity all rendered as markdown
- **Telegram bot** — manage agents and chat from Telegram; messages sync both ways
- **Integrations** — Slack, GitHub, and Linear notifications out of the box
- **Configurable office hours** — set timezone, working days, and hours
- **Decisions & voting** — propose and vote on decisions as a team
- **Accessible** — WCAG 2.1 AA compliant with keyboard navigation and screen reader support
- **Mobile friendly** — works on phones and tablets

## Getting Started

### 1. Install

```bash
git clone https://github.com/fwartner/agent-office.git
cd agent-office
npm install
```

The setup wizard runs automatically and walks you through backend, port, timezone, and optional integrations.

### 2. Add the office map (optional)

The map background uses the [Office Tileset by Donarg](https://donarg.itch.io/officetileset) (paid asset, not included). After purchasing:

```bash
cp "assets/pixelart/Office Tileset/Office Designs/Office Level 4.png" assets/pixelart/office-map.png
```

The app works without it — you'll just see a grid background instead.

### 3. Run

```bash
npm run dev
```

Open http://localhost:4173 and start adding agents.

### Docker

```bash
docker run -p 4173:4173 -v agent-office-state:/app/state ghcr.io/fwartner/agent-office:latest
```

### Claude Code

Paste this into [Claude Code](https://claude.ai/code):

```
Clone https://github.com/fwartner/agent-office.git, run npm install, then npm run dev.
Open the URL in my browser.
```

## Configuration

The setup wizard creates a `.env` file. Key options:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL URL (omit for SQLite, which works out of the box) |
| `TELEGRAM_BOT_TOKEN` | Enable the Telegram bot |
| `SLACK_WEBHOOK_URL` | Slack notifications |
| `GITHUB_TOKEN` | GitHub integration |
| `LINEAR_API_KEY` | Linear task sync |

Re-run the wizard anytime: `npm run setup:force`

## Telegram Bot

Set `TELEGRAM_BOT_TOKEN` to enable. Commands: `/agents`, `/tasks`, `/rooms`, `/status`, `/assign`, `/decide`. Regular text messages are forwarded to the office chat, and office events are pushed back to Telegram.

## Roadmap

- [ ] Agent-to-agent conversations (agents talking to each other autonomously)
- [ ] Persistent agent memory across tasks
- [ ] Custom sprite uploads for agents
- [ ] Meeting rooms with multi-agent collaboration sessions
- [ ] Task dependencies and workflows
- [ ] Dashboard with analytics (task throughput, agent utilization)
- [ ] Plugin system for custom integrations
- [ ] Voice notifications via text-to-speech
- [ ] Multi-office support (multiple maps/teams)
- [ ] Public demo instance

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

[MIT](LICENSE)

## Maintainer

**Florian Wartner** — [Pixel & Process](https://pixelandprocess.de)
