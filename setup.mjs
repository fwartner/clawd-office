#!/usr/bin/env node
/**
 * Clawd Office — First-run setup wizard.
 *
 * Walks through backend selection, database config, port, and
 * Linear integration. Writes .env, initialises state, and
 * optionally applies the Postgres schema.
 *
 * Run:  node setup.mjs          (interactive)
 *       node setup.mjs --yes    (accept all defaults, non-interactive)
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFile, execSync } from 'node:child_process'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ENV_FILE = path.join(__dirname, '.env')
const STATE_DIR = path.join(__dirname, 'state')
const STATE_FILE = path.join(STATE_DIR, 'office-snapshot.json')
const SCHEMA_FILE = path.join(__dirname, 'sql/office_state_schema.sql')
const LOCK_FILE = path.join(__dirname, '.setup-done')
const SEED_DATA = path.join(__dirname, 'src/data.ts')

// ── Colours ─────────────────────────────────────────
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
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
  console.log(`  ${c.cyan}${c.bold}│${c.reset}     ${c.magenta}${c.bold}🏢  Clawd Office Setup Wizard${c.reset}       ${c.cyan}${c.bold}│${c.reset}`)
  console.log(`  ${c.cyan}${c.bold}│${c.reset}                                          ${c.cyan}${c.bold}│${c.reset}`)
  console.log(`  ${c.cyan}${c.bold}│${c.reset}  ${c.dim}Pixel-art virtual office for AI agents${c.reset}   ${c.cyan}${c.bold}│${c.reset}`)
  console.log(`  ${c.cyan}${c.bold}│                                          │${c.reset}`)
  console.log(`  ${c.cyan}${c.bold}└──────────────────────────────────────────┘${c.reset}`)
  console.log()
}

// ── Detect psql ─────────────────────────────────────
function findPsql() {
  try {
    const result = execSync('which psql 2>/dev/null || where psql 2>NUL', { encoding: 'utf-8' }).trim()
    return result.split('\n')[0] || null
  } catch {
    return null
  }
}

function testPsqlConnection(psqlPath, dbName) {
  return new Promise(resolve => {
    execFile(psqlPath, [dbName, '-X', '-t', '-A', '-c', 'SELECT 1;'], { timeout: 5000 }, (error) => {
      resolve(!error)
    })
  })
}

function applySchema(psqlPath, dbName) {
  return new Promise((resolve, reject) => {
    execFile(psqlPath, [dbName, '-X', '-f', SCHEMA_FILE], { timeout: 30000 }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr || error.message))
      else resolve(stdout)
    })
  })
}

// ── Generate seed snapshot ──────────────────────────
function generateSeedSnapshot() {
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
      officeName: 'Clawd Office',
      theme: {
        presenceColors: {
          off_hours: '#8792a8',
          available: '#95d8ff',
          active: '#78f7b5',
          in_meeting: '#c39bff',
          paused: '#ffd479',
          blocked: '#ff8b8b'
        }
      }
    },
    workdayPolicy: {
      timezone: 'Europe/Berlin',
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

  const config = {
    backend: 'file',
    psqlPath: '',
    dbName: 'agent_memory',
    port: 4173,
    linearBridge: '',
    timezone: 'Europe/Berlin',
  }

  // ── Step 1: Backend ─────────────────────────────
  step('Backend selection')

  const psqlPath = findPsql()
  if (psqlPath) {
    console.log(`  ${c.green}✓${c.reset} Found psql at: ${c.dim}${psqlPath}${c.reset}`)
  } else {
    console.log(`  ${c.yellow}!${c.reset} psql not found in PATH`)
  }

  const backendChoice = await select('Choose your data backend:', [
    { value: 'file', label: 'JSON file', desc: 'simple, no database needed' },
    { value: 'postgres', label: 'PostgreSQL', desc: 'full database with persistence' },
  ], psqlPath ? 1 : 0)
  config.backend = backendChoice.value

  if (config.backend === 'postgres') {
    config.psqlPath = await ask('Path to psql binary', psqlPath || 'psql')
    config.dbName = await ask('Database name', 'agent_memory')

    console.log()
    console.log(`  ${c.dim}Testing connection...${c.reset}`)
    const connected = await testPsqlConnection(config.psqlPath, config.dbName)

    if (connected) {
      console.log(`  ${c.green}✓${c.reset} Connected to ${c.bold}${config.dbName}${c.reset}`)

      if (fs.existsSync(SCHEMA_FILE)) {
        const applyIt = await confirm('Apply database schema?', true)
        if (applyIt) {
          try {
            await applySchema(config.psqlPath, config.dbName)
            console.log(`  ${c.green}✓${c.reset} Schema applied successfully`)
          } catch (err) {
            console.log(`  ${c.red}✗${c.reset} Schema error: ${err.message}`)
            console.log(`  ${c.dim}You can apply it manually: psql ${config.dbName} -f sql/office_state_schema.sql${c.reset}`)
          }
        }
      }
    } else {
      console.log(`  ${c.red}✗${c.reset} Could not connect to ${c.bold}${config.dbName}${c.reset}`)
      console.log(`  ${c.yellow}!${c.reset} Make sure the database exists and psql can connect.`)
      const fallback = await confirm('Continue with JSON file backend instead?', true)
      if (fallback) {
        config.backend = 'file'
      } else {
        console.log()
        console.log(`  ${c.dim}Fix the connection and re-run: node setup.mjs --force${c.reset}`)
        rl.close()
        process.exit(1)
      }
    }
  }

  // ── Step 2: Server port ─────────────────────────
  step('Server configuration')

  const portStr = await ask('Server port', '4173')
  config.port = parseInt(portStr) || 4173

  // ── Step 3: Timezone ────────────────────────────
  step('Office timezone')

  const tzGuess = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin'
  console.log(`  ${c.dim}Detected system timezone: ${tzGuess}${c.reset}`)
  config.timezone = await ask('Office timezone', tzGuess)

  // ── Step 4: Linear integration ──────────────────
  step('Linear integration (optional)')

  console.log(`  ${c.dim}The Linear bridge dispatches tasks to Linear when assignments are created.${c.reset}`)
  console.log(`  ${c.dim}Skip this if you don't use Linear.${c.reset}`)
  const useLinear = await confirm('Enable Linear integration?', false)
  if (useLinear) {
    config.linearBridge = await ask('Path to Linear bridge script', '')
    if (config.linearBridge && !fs.existsSync(config.linearBridge)) {
      console.log(`  ${c.yellow}!${c.reset} File not found: ${config.linearBridge}`)
      console.log(`  ${c.dim}You can set LINEAR_BRIDGE_PATH in .env later.${c.reset}`)
    }
  }

  // ── Step 5: Write config & initialise ───────────
  step('Finalising')

  // Write .env
  const envLines = [
    '# Clawd Office configuration',
    `# Generated by setup wizard on ${new Date().toISOString()}`,
    '',
  ]
  if (config.backend === 'postgres') {
    envLines.push(`PSQL_PATH=${config.psqlPath}`)
    envLines.push(`POSTGRES_DB=${config.dbName}`)
  }
  if (config.port !== 4173) {
    envLines.push(`PORT=${config.port}`)
  }
  if (config.linearBridge) {
    envLines.push(`LINEAR_BRIDGE_PATH=${config.linearBridge}`)
  }
  if (config.timezone !== 'Europe/Berlin') {
    envLines.push(`OFFICE_TIMEZONE=${config.timezone}`)
  }
  envLines.push('')

  fs.writeFileSync(ENV_FILE, envLines.join('\n'))
  console.log(`  ${c.green}✓${c.reset} Written ${c.bold}.env${c.reset}`)

  // Ensure state directory exists
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true })
  }

  // Create seed state file if using file backend and none exists
  if (config.backend === 'file' || !fs.existsSync(STATE_FILE)) {
    if (!fs.existsSync(STATE_FILE)) {
      const seed = generateSeedSnapshot()
      seed.workdayPolicy.timezone = config.timezone
      fs.writeFileSync(STATE_FILE, JSON.stringify(seed, null, 2))
      console.log(`  ${c.green}✓${c.reset} Created ${c.bold}state/office-snapshot.json${c.reset} with seed data`)
    } else {
      // Update timezone in existing state
      try {
        const existing = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'))
        if (existing.workdayPolicy && config.timezone !== existing.workdayPolicy.timezone) {
          existing.workdayPolicy.timezone = config.timezone
          fs.writeFileSync(STATE_FILE, JSON.stringify(existing, null, 2))
          console.log(`  ${c.green}✓${c.reset} Updated timezone in existing state file`)
        } else {
          console.log(`  ${c.green}✓${c.reset} State file already exists`)
        }
      } catch {
        console.log(`  ${c.yellow}!${c.reset} Could not update existing state file`)
      }
    }
  }

  // Write lock file
  fs.writeFileSync(LOCK_FILE, JSON.stringify({ completedAt: new Date().toISOString(), config }, null, 2))

  // ── Summary ─────────────────────────────────────
  console.log()
  console.log(`  ${c.cyan}${c.bold}┌──────────────────────────────────────────┐${c.reset}`)
  console.log(`  ${c.cyan}${c.bold}│${c.reset}  ${c.green}${c.bold}✓  Setup complete!${c.reset}                      ${c.cyan}${c.bold}│${c.reset}`)
  console.log(`  ${c.cyan}${c.bold}└──────────────────────────────────────────┘${c.reset}`)
  console.log()
  console.log(`  ${c.bold}Configuration:${c.reset}`)
  console.log(`    Backend:    ${c.cyan}${config.backend === 'postgres' ? 'PostgreSQL' : 'JSON file'}${c.reset}`)
  console.log(`    Port:       ${c.cyan}${config.port}${c.reset}`)
  console.log(`    Timezone:   ${c.cyan}${config.timezone}${c.reset}`)
  if (config.linearBridge) {
    console.log(`    Linear:     ${c.cyan}${config.linearBridge}${c.reset}`)
  }
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
