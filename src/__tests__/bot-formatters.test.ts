import { describe, it, expect } from 'vitest'

// Test bot formatters logic inline (mirrors src/bot/formatters.ts)
const PRESENCE_EMOJI: Record<string, string> = {
  active: '🟢', available: '🔵', in_meeting: '🟣',
  paused: '🟡', blocked: '🔴', off_hours: '⚫',
}

function presenceEmoji(state: string): string {
  return PRESENCE_EMOJI[state] || '⚪'
}

function escapeMarkdown(text: string): string {
  return text.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1')
}

function agentCard(agent: Record<string, unknown>): string {
  const name = escapeMarkdown(String(agent.name || agent.id))
  const role = escapeMarkdown(String(agent.role || ''))
  const team = escapeMarkdown(String(agent.team || ''))
  const presence = String(agent.presence || 'off_hours')
  const focus = agent.focus ? `\nFocus: ${escapeMarkdown(String(agent.focus))}` : ''
  return `${presenceEmoji(presence)} *${name}* — ${role}\nTeam: ${team} \\| Status: ${escapeMarkdown(presence)}${focus}`
}

describe('Bot formatters — presenceEmoji', () => {
  it('returns correct emoji for each state', () => {
    expect(presenceEmoji('active')).toBe('🟢')
    expect(presenceEmoji('available')).toBe('🔵')
    expect(presenceEmoji('blocked')).toBe('🔴')
    expect(presenceEmoji('paused')).toBe('🟡')
    expect(presenceEmoji('in_meeting')).toBe('🟣')
    expect(presenceEmoji('off_hours')).toBe('⚫')
  })

  it('returns default for unknown state', () => {
    expect(presenceEmoji('unknown')).toBe('⚪')
  })
})

describe('Bot formatters — escapeMarkdown', () => {
  it('escapes special characters', () => {
    expect(escapeMarkdown('hello_world')).toBe('hello\\_world')
    expect(escapeMarkdown('*bold*')).toBe('\\*bold\\*')
    expect(escapeMarkdown('test[0]')).toBe('test\\[0\\]')
  })

  it('does not escape regular text', () => {
    expect(escapeMarkdown('hello world')).toBe('hello world')
    expect(escapeMarkdown('abc123')).toBe('abc123')
  })
})

describe('Bot formatters — agentCard', () => {
  it('formats agent with all fields', () => {
    const card = agentCard({
      id: 'forge', name: 'Forge', role: 'Builder', team: 'Build',
      presence: 'active', focus: 'Working on API'
    })
    expect(card).toContain('🟢')
    expect(card).toContain('*Forge*')
    expect(card).toContain('Builder')
    expect(card).toContain('Build')
    expect(card).toContain('Focus: Working on API')
  })

  it('omits focus when empty', () => {
    const card = agentCard({
      id: 'test', name: 'Test', role: 'Tester', team: 'QA',
      presence: 'available'
    })
    expect(card).not.toContain('Focus:')
    expect(card).toContain('🔵')
  })

  it('defaults to off_hours emoji when no presence', () => {
    const card = agentCard({ id: 'x', name: 'X', role: 'R', team: 'T' })
    expect(card).toContain('⚫')
  })
})
