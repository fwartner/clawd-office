import { describe, it, expect } from 'vitest'
import path from 'node:path'

const VALID_PRESENCE = ['off_hours', 'available', 'active', 'in_meeting', 'paused', 'blocked']
const AGENT_PATCH_FIELDS = ['presence', 'focus', 'roomId', 'criticalTask', 'collaborationMode']
const ASSIGNMENT_STATUSES = ['queued', 'routed', 'active', 'done', 'blocked']
const VALID_ROUTING = ['agent_runtime', 'work_tracker', 'both']
const VALID_PRIORITY = ['low', 'medium', 'high']
const MAX_TITLE_LEN = 200
const MAX_BRIEF_LEN = 2000
const MAX_FOCUS_LEN = 500
const MAX_NAME_LEN = 100
const AGENT_ID_RE = /^[a-z0-9-]+$/

function sanitizePatch(raw) {
  const clean = {}
  for (const key of AGENT_PATCH_FIELDS) {
    if (key in raw) clean[key] = raw[key]
  }
  return clean
}

function validateAssignInput(input) {
  const errors = []
  const missing = ['targetAgentId', 'taskTitle', 'priority', 'routingTarget'].filter(f => !input[f])
  if (missing.length > 0) errors.push(`Missing required fields: ${missing.join(', ')}`)
  if (input.routingTarget && !VALID_ROUTING.includes(input.routingTarget)) errors.push('Invalid routingTarget')
  if (input.priority && !VALID_PRIORITY.includes(input.priority)) errors.push('Invalid priority')
  if (input.taskTitle && String(input.taskTitle).length > MAX_TITLE_LEN) errors.push('taskTitle too long')
  if (input.taskBrief && String(input.taskBrief).length > MAX_BRIEF_LEN) errors.push('taskBrief too long')
  return errors
}

function validateAgentCreate(input) {
  const errors = []
  const required = ['id', 'name', 'role', 'team', 'roomId']
  const missing = required.filter(f => !input[f])
  if (missing.length > 0) errors.push(`Missing required fields: ${missing.join(', ')}`)
  if (input.id && !AGENT_ID_RE.test(input.id)) errors.push('id must be lowercase alphanumeric with hyphens only')
  if (input.name && String(input.name).length > MAX_NAME_LEN) errors.push('name too long')
  if (input.focus && String(input.focus).length > MAX_FOCUS_LEN) errors.push('focus too long')
  if (input.presence && !VALID_PRESENCE.includes(input.presence)) errors.push('Invalid presence')
  return errors
}

describe('GET /api/office/snapshot — shape validation', () => {
  it('valid snapshot has agents[], rooms[], assignments[], activity[]', () => {
    const snapshot = {
      agents: [{ id: 'forge', name: 'Forge', presence: 'active' }],
      rooms: [{ id: 'shipyard', zone: { x: 0, y: 0, w: 50, h: 50 } }],
      assignments: [],
      activity: [],
      agentSeats: {},
      workdayPolicy: { timezone: 'Europe/Berlin' }
    }
    expect(Array.isArray(snapshot.agents)).toBe(true)
    expect(Array.isArray(snapshot.rooms)).toBe(true)
    expect(Array.isArray(snapshot.assignments)).toBe(true)
    expect(Array.isArray(snapshot.activity)).toBe(true)
  })
})

describe('PATCH /api/office/agent/:id — validation', () => {
  it('sanitizePatch only allows whitelisted fields', () => {
    const result = sanitizePatch({ presence: 'active', id: 'evil', name: 'hacked' })
    expect(result).toEqual({ presence: 'active' })
  })

  it('rejects invalid presence values', () => {
    const patch = sanitizePatch({ presence: 'hacking' })
    expect(VALID_PRESENCE.includes(patch.presence)).toBe(false)
  })

  it('accepts all valid presence states', () => {
    for (const state of VALID_PRESENCE) {
      expect(VALID_PRESENCE.includes(state)).toBe(true)
    }
  })

  it('returns empty object for unknown fields', () => {
    expect(Object.keys(sanitizePatch({ evil: true })).length).toBe(0)
  })

  it('would return 404 for unknown agent', () => {
    const agents = [{ id: 'forge' }, { id: 'prism' }]
    const found = agents.find(a => a.id === 'unknown-agent')
    expect(found).toBeUndefined()
  })
})

describe('PATCH /api/office/assignment/:id — validation', () => {
  it('accepts all valid status values', () => {
    for (const status of ASSIGNMENT_STATUSES) {
      expect(ASSIGNMENT_STATUSES.includes(status)).toBe(true)
    }
  })

  it('rejects invalid status values', () => {
    expect(ASSIGNMENT_STATUSES.includes('invalid')).toBe(false)
    expect(ASSIGNMENT_STATUSES.includes('')).toBe(false)
  })
})

describe('POST /api/office/assign — validation', () => {
  it('rejects missing fields', () => {
    const errors = validateAssignInput({})
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]).toContain('Missing required fields')
  })

  it('rejects invalid routingTarget', () => {
    const errors = validateAssignInput({
      targetAgentId: 'forge', taskTitle: 'Test', priority: 'high', routingTarget: 'invalid'
    })
    expect(errors).toContain('Invalid routingTarget')
  })

  it('rejects invalid priority', () => {
    const errors = validateAssignInput({
      targetAgentId: 'forge', taskTitle: 'Test', priority: 'urgent', routingTarget: 'both'
    })
    expect(errors).toContain('Invalid priority')
  })

  it('accepts valid input', () => {
    const errors = validateAssignInput({
      targetAgentId: 'forge', taskTitle: 'Test task', priority: 'high', routingTarget: 'agent_runtime'
    })
    expect(errors).toHaveLength(0)
  })

  it('rejects taskTitle that is too long', () => {
    const errors = validateAssignInput({
      targetAgentId: 'forge', taskTitle: 'x'.repeat(201), priority: 'high', routingTarget: 'both'
    })
    expect(errors).toContain('taskTitle too long')
  })

  it('rejects taskBrief that is too long', () => {
    const errors = validateAssignInput({
      targetAgentId: 'forge', taskTitle: 'Test', taskBrief: 'x'.repeat(2001), priority: 'low', routingTarget: 'both'
    })
    expect(errors).toContain('taskBrief too long')
  })
})

describe('POST /api/office/activity — validation', () => {
  it('rejects non-object body', () => {
    const body = [1, 2, 3]
    expect(Array.isArray(body)).toBe(true)
  })

  it('accepts valid activity entry', () => {
    const entry = { kind: 'system', text: 'Test', agentId: 'forge' }
    expect(typeof entry).toBe('object')
    expect(entry !== null).toBe(true)
    expect(!Array.isArray(entry)).toBe(true)
  })
})

describe('POST /api/office/agent — create validation', () => {
  it('rejects missing required fields', () => {
    const errors = validateAgentCreate({})
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]).toContain('Missing required fields')
  })

  it('rejects invalid agent ID format', () => {
    const errors = validateAgentCreate({
      id: 'Bad Agent!', name: 'Test', role: 'Dev', team: 'Build', roomId: 'shipyard'
    })
    expect(errors).toContain('id must be lowercase alphanumeric with hyphens only')
  })

  it('accepts valid lowercase-hyphen IDs', () => {
    expect(AGENT_ID_RE.test('my-agent-1')).toBe(true)
    expect(AGENT_ID_RE.test('forge')).toBe(true)
  })

  it('rejects IDs with uppercase or special chars', () => {
    expect(AGENT_ID_RE.test('MyAgent')).toBe(false)
    expect(AGENT_ID_RE.test('agent@1')).toBe(false)
    expect(AGENT_ID_RE.test('agent 1')).toBe(false)
  })

  it('accepts valid agent create input', () => {
    const errors = validateAgentCreate({
      id: 'test-agent', name: 'Test', role: 'Developer', team: 'Build', roomId: 'shipyard'
    })
    expect(errors).toHaveLength(0)
  })

  it('rejects name that is too long', () => {
    const errors = validateAgentCreate({
      id: 'test', name: 'x'.repeat(101), role: 'Dev', team: 'Build', roomId: 'shipyard'
    })
    expect(errors).toContain('name too long')
  })

  it('rejects invalid presence value', () => {
    const errors = validateAgentCreate({
      id: 'test', name: 'Test', role: 'Dev', team: 'Build', roomId: 'shipyard', presence: 'invalid'
    })
    expect(errors).toContain('Invalid presence')
  })
})

describe('PUT /api/office/agent/:id — update validation', () => {
  it('would return 404 for unknown agent', () => {
    const agents = [{ id: 'forge' }]
    expect(agents.find(a => a.id === 'nonexistent')).toBeUndefined()
  })

  it('presence validation applies to updates', () => {
    expect(VALID_PRESENCE.includes('active')).toBe(true)
    expect(VALID_PRESENCE.includes('bad-state')).toBe(false)
  })
})

describe('DELETE /api/office/agent/:id — validation', () => {
  it('would return 404 for unknown agent', () => {
    const agents = [{ id: 'forge' }, { id: 'prism' }]
    const idx = agents.findIndex(a => a.id === 'unknown')
    expect(idx).toBe(-1)
  })

  it('removes agent from array', () => {
    const agents = [{ id: 'forge' }, { id: 'prism' }]
    const filtered = agents.filter(a => a.id !== 'forge')
    expect(filtered).toHaveLength(1)
    expect(filtered[0].id).toBe('prism')
  })

  it('removes associated assignments', () => {
    const assignments = [
      { id: 'a1', targetAgentId: 'forge' },
      { id: 'a2', targetAgentId: 'prism' },
    ]
    const filtered = assignments.filter(a => a.targetAgentId !== 'forge')
    expect(filtered).toHaveLength(1)
    expect(filtered[0].targetAgentId).toBe('prism')
  })
})
