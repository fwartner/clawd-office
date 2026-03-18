#!/usr/bin/env node
/**
 * Agent Office — First-run setup wizard.
 *
 * Walks through database backend, Telegram bot, integrations, and port.
 * Writes .env file and initialises seed state.
 *
 * Run:  node setup.mjs          (interactive)
 *       node setup.mjs --yes    (accept all defaults, non-interactive)
 */
import fs from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ENV_FILE = path.join(__dirname, '.env')
const STATE_DIR = path.join(__dirname, 'state')
const STATE_FILE = path.join(STATE_DIR, 'office-snapshot.json')
const LOCK_FILE = path.join(__dirname, '.setup-done')

// ── Colours ─────────────────────────────────────────
const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m',
  red: '\x1b[31m', magenta: '\x1b[35m', blue: '\x1b[34m',
}

const SKIP_INTERACTIVE = process.argv.includes('--yes') || process.argv.includes('-y') || !!process.env.CI

// ── Readline helper ─────────────────────────────────
let rl
function initRL() {
  rl = createInterface({ input: process.stdin, output: process.stdout })
}

function ask(question, defaultVal = '') {
  if (SKIP_INTERACTIVE) return Promise.resolve(defaultVal)
  const suffix = defaultVal ? ` ${c.dim}(${defaultVal})${c.reset}` : ''
  return new Promise(resolve => {
    rl.question(`  ${question}${suffix}: `, answer => {
      resolve(answer.trim() || defaultVal)
    })
  })
}

function confirm(question, defaultYes = true) {
  if (SKIP_INTERACTIVE) return Promise.resolve(defaultYes)
  const hint = defaultYes ? 'Y/n' : 'y/N'
  return new Promise(resolve => {
    rl.question(`  ${question} ${c.dim}(${hint})${c.reset}: `, answer => {
      const a = answer.trim().toLowerCase()
      if (a === '') resolve(defaultYes)
      else resolve(a === 'y' || a === 'yes')
    })
  })
}

function select(question, options, defaultIdx = 0) {
  if (SKIP_INTERACTIVE) return Promise.resolve(options[defaultIdx])
  return new Promise(resolve => {
    console.log(`  ${question}`)
    options.forEach((opt, i) => {
      const marker = i === defaultIdx ? `${c.cyan}>${c.reset}` : ' '
      console.log(`  ${marker} ${c.bold}${i + 1}${c.reset}) ${opt.label}${opt.desc ? ` ${c.dim}— ${opt.desc}${c.reset}` : ''}`)
    })
    rl.question(`  ${c.dim}Choice [${defaultIdx + 1}]:${c.reset} `, answer => {
      const idx = parseInt(answer.trim()) - 1
      resolve(options[isNaN(idx) || idx < 0 || idx >= options.length ? defaultIdx : idx])
    })
  })
}

// ── Banner ──────────────────────────────────────────
function banner() {
  console.log()
  console.log(`  ${c.cyan}${c.bold}┌──────────────────────────────────────────┐${c.reset}`)
  console.log(`  ${c.cyan}${c.bold}│                                          │${c.reset}`)
  console.log(`  ${c.cyan}${c.bold}│${c.reset}     ${c.magenta}${c.bold}🏢  Agent Office Setup Wizard${c.reset}       ${c.cyan}${c.bold}│${c.reset}`)
  console.log(`  ${c.cyan}${c.bold}│${c.reset}                                          ${c.cyan}${c.bold}│${c.reset}`)
  console.log(`  ${c.cyan}${c.bold}│${c.reset}  ${c.dim}Pixel-art virtual office for AI agents${c.reset}   ${c.cyan}${c.bold}│${c.reset}`)
  console.log(`  ${c.cyan}${c.bold}│                                          │${c.reset}`)
  console.log(`  ${c.cyan}${c.bold}└──────────────────────────────────────────┘${c.reset}`)
  console.log()
}

// ── Generate seed snapshot ──────────────────────────
function generateSeedSnapshot(timezone) {
  return {
    agents: [],
    rooms: [
      { id: 'planning-studio', name: 'Planning Studio', team: 'Product + UX', purpose: 'Scope, flows, and meeting-driven coordination', agents: [], zone: { x: 25, y: 3, w: 50, h: 27 } },
      { id: 'shipyard', name: 'Shipyard', team: 'Build', purpose: 'Implementation room for active engineering work', agents: [], zone: { x: 2, y: 33, w: 58, h: 30 } },
      { id: 'systems-bay', name: 'Systems Bay', team: 'Platform', purpose: 'Architecture and systems decisions', agents: [], zone: { x: 62, y: 33, w: 36, h: 22 } },
      { id: 'commons', name: 'Commons', team: 'Shared Office', purpose: 'Shared coordination space', agents: [], zone: { x: 2, y: 68, w: 58, h: 30 } },
      { id: 'signal-room', name: 'Signal Room', team: 'Ops', purpose: 'Status, reporting, and operational visibility', agents: [], zone: { x: 62, y: 60, w: 36, h: 38 } }
    ],
    agentSeats: {},
    settings: {
      officeName: 'Agent Office',
      theme: {
        presenceColors: {
          off_hours: '#8792a8', available: '#95d8ff', active: '#78f7b5',
          in_meeting: '#c39bff', paused: '#ffd479', blocked: '#ff8b8b'
        }
      }
    },
    workdayPolicy: {
      timezone: timezone || 'Europe/Berlin',
      days: 'Monday-Friday',
      hours: '09:00-17:00',
      pauseRule: 'After non-critical tasks, agents should move to paused to save tokens until the next meaningful task arrives.',
      sharedPlaceRule: 'The office is the shared place where all agents work together, coordinate by room, and expose their current state.'
    },
    assignments: [],
    activity: [
      { id: 'setup-1', kind: 'system', text: 'Office initialised via setup wizard.', createdAt: new Date().toISOString() }
    ],
    source: 'file',
    lastUpdatedAt: new Date().toISOString()
  }
}

// ── Step indicators ─────────────────────────────────
let stepNum = 0
const totalSteps = 5

function step(title) {
  stepNum++
  console.log()
  console.log(`  ${c.blue}${c.bold}[${stepNum}/${totalSteps}]${c.reset} ${c.bold}${title}${c.reset}`)
  console.log(`  ${c.dim}${'─'.repeat(40)}${c.reset}`)
}

// ── Main wizard ─────────────────────────────────────
async function main() {
  banner()

  if (fs.existsSync(LOCK_FILE) && !process.argv.includes('--force')) {
    console.log(`  ${c.green}✓${c.reset} Setup already completed. Use ${c.bold}--force${c.reset} to re-run.`)
    console.log()
    process.exit(0)
  }

  if (SKIP_INTERACTIVE) {
    console.log(`  ${c.yellow}▸${c.reset} Running with ${c.bold}--yes${c.reset}: accepting all defaults.`)
  }

  initRL()

  const envVars = {}

  // ── Step 1: Database backend ──────────────────────
  step('Database backend')

  console.log(`  ${c.dim}SQLite requires zero configuration. PostgreSQL needs a connection URL.${c.reset}`)

  const dbChoice = await select('Choose your database:', [
    { value: 'sqlite', label: 'SQLite', desc: 'zero-config, single file (recommended)' },
    { value: 'postgres', label: 'PostgreSQL', desc: 'for multi-instance or existing Postgres' },
  ], 0)

  if (dbChoice.value === 'postgres') {
    const dbUrl = await ask('PostgreSQL connection URL', 'postgres://localhost:5432/agent_office')
    envVars.DATABASE_URL = dbUrl
    console.log(`  ${c.green}✓${c.reset} Will use PostgreSQL: ${c.dim}${dbUrl}${c.reset}`)
  } else {
    console.log(`  ${c.green}✓${c.reset} Using SQLite (state/agent-office.db)`)
  }

  // ── Step 2: Telegram bot ──────────────────────────
  step('Telegram bot (optional)')

  console.log(`  ${c.dim}Get a bot token from @BotFather on Telegram.${c.reset}`)
  console.log(`  ${c.dim}Skip if you don't want Telegram integration.${c.reset}`)

  const useTelegram = await confirm('Enable Telegram bot?', false)
  if (useTelegram) {
    const token = await ask('Bot token from @BotFather', '')
    if (token) {
      envVars.TELEGRAM_BOT_TOKEN = token
      console.log(`  ${c.green}✓${c.reset} Telegram bot configured`)
    } else {
      console.log(`  ${c.yellow}!${c.reset} No token provided — bot disabled`)
    }
  }

  // ── Step 3: Integrations ──────────────────────────
  step('Integrations (optional)')

  console.log(`  ${c.dim}Connect to external services. All optional — skip to use later.${c.reset}`)

  const useSlack = await confirm('Enable Slack notifications?', false)
  if (useSlack) {
    const url = await ask('Slack Incoming Webhook URL', '')
    if (url) envVars.SLACK_WEBHOOK_URL = url
  }

  const useGitHub = await confirm('Enable GitHub integration?', false)
  if (useGitHub) {
    const token = await ask('GitHub token (for outbound API calls)', '')
    if (token) envVars.GITHUB_TOKEN = token
  }

  const useLinear = await confirm('Enable Linear integration?', false)
  if (useLinear) {
    const key = await ask('Linear API key', '')
    if (key) envVars.LINEAR_API_KEY = key
    const teamId = await ask('Linear team ID', '')
    if (teamId) envVars.LINEAR_TEAM_ID = teamId
  }

  // ── Step 4: Server config ─────────────────────────
  step('Server configuration')

  const portStr = await ask('Server port', '4173')
  const port = parseInt(portStr) || 4173
  if (port !== 4173) envVars.PORT = String(port)

  const tzGuess = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin'
  console.log(`  ${c.dim}Detected system timezone: ${tzGuess}${c.reset}`)
  const timezone = await ask('Office timezone', tzGuess)

  // ── Step 5: Write config & initialise ─────────────
  step('Finalising')

  // Write .env
  const envLines = [
    '# Agent Office configuration',
    `# Generated by setup wizard on ${new Date().toISOString()}`,
    '',
  ]
  for (const [key, value] of Object.entries(envVars)) {
    envLines.push(`${key}=${value}`)
  }
  envLines.push('')

  fs.writeFileSync(ENV_FILE, envLines.join('\n'))
  console.log(`  ${c.green}✓${c.reset} Written ${c.bold}.env${c.reset} (${Object.keys(envVars).length} variables)`)

  // Ensure state directory exists
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true })
  }

  // Create seed state file if none exists
  if (!fs.existsSync(STATE_FILE)) {
    const seed = generateSeedSnapshot(timezone)
    fs.writeFileSync(STATE_FILE, JSON.stringify(seed, null, 2))
    console.log(`  ${c.green}✓${c.reset} Created ${c.bold}state/office-snapshot.json${c.reset} with seed data`)
  } else {
    // Update timezone in existing state
    try {
      const existing = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'))
      if (existing.workdayPolicy && timezone !== existing.workdayPolicy.timezone) {
        existing.workdayPolicy.timezone = timezone
        fs.writeFileSync(STATE_FILE, JSON.stringify(existing, null, 2))
        console.log(`  ${c.green}✓${c.reset} Updated timezone in existing state file`)
      } else {
        console.log(`  ${c.green}✓${c.reset} State file already exists`)
      }
    } catch {
      console.log(`  ${c.yellow}!${c.reset} Could not update existing state file`)
    }
  }

  // Write lock file
  fs.writeFileSync(LOCK_FILE, JSON.stringify({ completedAt: new Date().toISOString(), envVars: Object.keys(envVars) }, null, 2))

  // ── Summary ─────────────────────────────────────
  console.log()
  console.log(`  ${c.cyan}${c.bold}┌──────────────────────────────────────────┐${c.reset}`)
  console.log(`  ${c.cyan}${c.bold}│${c.reset}  ${c.green}${c.bold}✓  Setup complete!${c.reset}                      ${c.cyan}${c.bold}│${c.reset}`)
  console.log(`  ${c.cyan}${c.bold}└──────────────────────────────────────────┘${c.reset}`)
  console.log()
  console.log(`  ${c.bold}Configuration:${c.reset}`)
  console.log(`    Database:   ${c.cyan}${envVars.DATABASE_URL ? 'PostgreSQL' : 'SQLite'}${c.reset}`)
  console.log(`    Port:       ${c.cyan}${port}${c.reset}`)
  console.log(`    Timezone:   ${c.cyan}${timezone}${c.reset}`)
  console.log(`    Telegram:   ${c.cyan}${envVars.TELEGRAM_BOT_TOKEN ? 'enabled' : 'disabled'}${c.reset}`)
  if (envVars.SLACK_WEBHOOK_URL) console.log(`    Slack:      ${c.cyan}enabled${c.reset}`)
  if (envVars.GITHUB_TOKEN) console.log(`    GitHub:     ${c.cyan}enabled${c.reset}`)
  if (envVars.LINEAR_API_KEY) console.log(`    Linear:     ${c.cyan}enabled${c.reset}`)
  console.log()
  console.log(`  ${c.bold}Next steps:${c.reset}`)
  console.log()
  console.log(`    ${c.green}npm run dev${c.reset}         ${c.dim}Start dev server with hot reload${c.reset}`)
  console.log(`    ${c.green}npm run build${c.reset}       ${c.dim}Build for production${c.reset}`)
  console.log(`    ${c.green}npm run serve${c.reset}       ${c.dim}Run production server${c.reset}`)
  console.log(`    ${c.green}npm test${c.reset}            ${c.dim}Run test suite${c.reset}`)
  console.log()
  console.log(`  ${c.dim}Re-run setup anytime: node setup.mjs --force${c.reset}`)
  console.log()

  rl.close()
}

main().catch(err => {
  console.error(`\n  ${c.red}${c.bold}Error:${c.reset} ${err.message}`)
  process.exit(1)
})
