/**
 * Telegram message formatting helpers.
 */

const PRESENCE_EMOJI: Record<string, string> = {
  active: '🟢',
  available: '🔵',
  in_meeting: '🟣',
  paused: '🟡',
  blocked: '🔴',
  off_hours: '⚫',
}

export function presenceEmoji(state: string): string {
  return PRESENCE_EMOJI[state] || '⚪'
}

export function escapeMarkdown(text: string): string {
  return text.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1')
}

export function agentCard(agent: Record<string, unknown>): string {
  const name = escapeMarkdown(String(agent.name || agent.id))
  const role = escapeMarkdown(String(agent.role || ''))
  const team = escapeMarkdown(String(agent.team || ''))
  const presence = String(agent.presence || 'off_hours')
  const focus = agent.focus ? `\nFocus: ${escapeMarkdown(String(agent.focus))}` : ''
  return `${presenceEmoji(presence)} *${name}* — ${role}\nTeam: ${team} \\| Status: ${escapeMarkdown(presence)}${focus}`
}

export function taskCard(task: Record<string, unknown>): string {
  const title = escapeMarkdown(String(task.taskTitle || task.title || ''))
  const agent = escapeMarkdown(String(task.targetAgentId || ''))
  const priority = escapeMarkdown(String(task.priority || 'medium'))
  const status = String(task.status || 'queued')
  const statusEmoji = status === 'done' ? '✅' : status === 'active' ? '🔵' : status === 'blocked' ? '🔴' : '⏳'
  return `${statusEmoji} *${title}*\nAgent: ${agent} \\| Priority: ${priority} \\| Status: ${escapeMarkdown(status)}`
}

export function dashboardSummary(snapshot: Record<string, unknown>): string {
  const agents = (snapshot.agents as Record<string, unknown>[]) || []
  const assignments = (snapshot.assignments as Record<string, unknown>[]) || []
  const active = agents.filter(a => a.presence === 'active').length
  const available = agents.filter(a => a.presence === 'available').length
  const blocked = agents.filter(a => a.presence === 'blocked').length
  const tasksActive = assignments.filter(a => a.status === 'active' || a.status === 'queued').length
  const tasksDone = assignments.filter(a => a.status === 'done').length

  return `📊 *Agent Office Dashboard*

👥 *Agents:* ${agents.length} total
  ${presenceEmoji('active')} Active: ${active}
  ${presenceEmoji('available')} Available: ${available}
  ${presenceEmoji('blocked')} Blocked: ${blocked}

📝 *Tasks:* ${assignments.length} total
  ⏳ In progress: ${tasksActive}
  ✅ Completed: ${tasksDone}`
}
