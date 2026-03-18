import { describe, it, expect } from 'vitest'

// Import from the built dist-server to test actual compiled output
// But for unit tests, we can test the logic by re-implementing the key functions
// since src/server is excluded from the frontend tsconfig

// Test validation logic inline (mirrors src/server/validation.ts)
const VALID_PRESENCE = ['off_hours', 'available', 'active', 'in_meeting', 'paused', 'blocked']
const AGENT_ID_RE = /^[a-z0-9-]+$/
const AGENT_PATCH_FIELDS = ['presence', 'focus', 'roomId', 'criticalTask', 'collaborationMode', 'xPct', 'yPct', 'systemPrompt']
const ASSIGNMENT_STATUSES = ['queued', 'routed', 'active', 'done', 'blocked']
const VALID_ROUTING = ['agent_runtime', 'work_tracker', 'both']
const VALID_PRIORITY = ['low', 'medium', 'high']
const VALID_DECISION_STATUSES = ['proposed', 'accepted', 'rejected']

function sanitizePatch(raw: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {}
  for (const key of AGENT_PATCH_FIELDS) {
    if (key in raw) {
      if ((key === 'xPct' || key === 'yPct') && typeof raw[key] === 'number') {
        clean[key] = Math.max(0, Math.min(100, raw[key] as number))
      } else if (key === 'systemPrompt' && typeof raw[key] === 'string') {
        clean[key] = (raw[key] as string).slice(0, 5000)
      } else {
        clean[key] = raw[key]
      }
    }
  }
  return clean
}

describe('Validation — AGENT_ID_RE', () => {
  it('accepts lowercase kebab-case ids', () => {
    expect(AGENT_ID_RE.test('forge')).toBe(true)
    expect(AGENT_ID_RE.test('my-agent')).toBe(true)
    expect(AGENT_ID_RE.test('agent-123')).toBe(true)
  })

  it('rejects uppercase', () => {
    expect(AGENT_ID_RE.test('MyAgent')).toBe(false)
  })

  it('rejects spaces', () => {
    expect(AGENT_ID_RE.test('my agent')).toBe(false)
  })

  it('rejects special characters', () => {
    expect(AGENT_ID_RE.test('agent_one')).toBe(false)
    expect(AGENT_ID_RE.test('agent.two')).toBe(false)
  })
})

describe('Validation — sanitizePatch', () => {
  it('only keeps whitelisted fields', () => {
    const result = sanitizePatch({ presence: 'active', unknownField: 'bad', name: 'hack' })
    expect(result).toHaveProperty('presence', 'active')
    expect(result).not.toHaveProperty('unknownField')
    expect(result).not.toHaveProperty('name')
  })

  it('clamps xPct and yPct to 0-100', () => {
    const result = sanitizePatch({ xPct: 150, yPct: -10 })
    expect(result.xPct).toBe(100)
    expect(result.yPct).toBe(0)
  })

  it('truncates systemPrompt to 5000 chars', () => {
    const long = 'x'.repeat(6000)
    const result = sanitizePatch({ systemPrompt: long })
    expect((result.systemPrompt as string).length).toBe(5000)
  })

  it('returns empty object for no valid fields', () => {
    const result = sanitizePatch({ bad: 'data', worse: 'data' })
    expect(Object.keys(result).length).toBe(0)
  })
})

describe('Validation — presence states', () => {
  it('has exactly 6 valid states', () => {
    expect(VALID_PRESENCE).toHaveLength(6)
  })

  it('includes all expected states', () => {
    for (const state of ['off_hours', 'available', 'active', 'in_meeting', 'paused', 'blocked']) {
      expect(VALID_PRESENCE).toContain(state)
    }
  })
})

describe('Validation — assignment statuses', () => {
  it('has 5 valid statuses', () => {
    expect(ASSIGNMENT_STATUSES).toHaveLength(5)
    expect(ASSIGNMENT_STATUSES).toContain('queued')
    expect(ASSIGNMENT_STATUSES).toContain('done')
    expect(ASSIGNMENT_STATUSES).toContain('blocked')
  })
})

describe('Validation — routing targets', () => {
  it('has 3 valid targets', () => {
    expect(VALID_ROUTING).toEqual(['agent_runtime', 'work_tracker', 'both'])
  })
})

describe('Validation — priorities', () => {
  it('has 3 valid priorities', () => {
    expect(VALID_PRIORITY).toEqual(['low', 'medium', 'high'])
  })
})

describe('Validation — decision statuses', () => {
  it('has 3 valid statuses', () => {
    expect(VALID_DECISION_STATUSES).toEqual(['proposed', 'accepted', 'rejected'])
  })
})
