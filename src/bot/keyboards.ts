/**
 * Inline keyboard builders for Telegram bot.
 */
import { InlineKeyboard } from 'grammy'

export function mainMenu(): InlineKeyboard {
  return new InlineKeyboard()
    .text('📋 Agents', 'menu:agents').text('📝 Tasks', 'menu:tasks').row()
    .text('🏠 Rooms', 'menu:rooms').text('📊 Status', 'menu:status').row()
    .text('🗳 Decisions', 'menu:decisions').text('⚙️ Settings', 'menu:settings')
}

export function agentList(agents: Array<Record<string, unknown>>): InlineKeyboard {
  const kb = new InlineKeyboard()
  for (const agent of agents) {
    kb.text(`${agent.name}`, `agent:${agent.id}`).row()
  }
  kb.text('➕ Create Agent', 'agent:create').row()
  kb.text('◀️ Back', 'menu:main')
  return kb
}

export function agentDetail(agentId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('📝 Assign Task', `assign:${agentId}`)
    .text('✏️ Edit', `edit_agent:${agentId}`)
    .text('🗑 Delete', `delete_agent:${agentId}`).row()
    .text('◀️ Back to Agents', 'menu:agents')
}

export function agentDeleteConfirm(agentId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ Yes, delete', `confirm_delete_agent:${agentId}`)
    .text('❌ Cancel', `agent:${agentId}`)
}

export function taskList(tasks: Array<Record<string, unknown>>): InlineKeyboard {
  const kb = new InlineKeyboard()
  const recent = tasks.slice(0, 10)
  for (const task of recent) {
    const statusIcon = task.status === 'done' ? '✅' : task.status === 'active' ? '🔵' : task.status === 'blocked' ? '🔴' : '⏳'
    kb.text(`${statusIcon} ${String(task.taskTitle).slice(0, 30)}`, `task:${task.id}`).row()
  }
  kb.text('◀️ Back', 'menu:main')
  return kb
}

export function taskDetail(taskId: string, status: string): InlineKeyboard {
  const kb = new InlineKeyboard()
  if (status !== 'done') {
    kb.text('✅ Complete', `complete_task:${taskId}`)
    kb.text('🔴 Block', `block_task:${taskId}`)
  }
  kb.row().text('◀️ Back to Tasks', 'menu:tasks')
  return kb
}

export function roomList(rooms: Array<Record<string, unknown>>): InlineKeyboard {
  const kb = new InlineKeyboard()
  for (const room of rooms) {
    kb.text(`${room.name}`, `room:${room.id}`).row()
  }
  kb.text('◀️ Back', 'menu:main')
  return kb
}

export function decisionList(decisions: Array<Record<string, unknown>>): InlineKeyboard {
  const kb = new InlineKeyboard()
  const recent = decisions.slice(0, 10)
  for (const d of recent) {
    const icon = d.status === 'accepted' ? '✅' : d.status === 'rejected' ? '❌' : '🗳'
    kb.text(`${icon} ${String(d.title).slice(0, 30)}`, `decision:${d.id}`).row()
  }
  kb.text('➕ New Decision', 'decision:create').row()
  kb.text('◀️ Back', 'menu:main')
  return kb
}

export function decisionDetail(decisionId: string, status: string): InlineKeyboard {
  const kb = new InlineKeyboard()
  if (status === 'proposed') {
    kb.text('✅ Accept', `accept_decision:${decisionId}`)
    kb.text('❌ Reject', `reject_decision:${decisionId}`)
    kb.row()
  }
  kb.text('◀️ Back to Decisions', 'menu:decisions')
  return kb
}

export function prioritySelect(prefix: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('🟢 Low', `${prefix}:low`)
    .text('🟡 Medium', `${prefix}:medium`)
    .text('🔴 High', `${prefix}:high`)
}

export function routingSelect(prefix: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('🤖 Agent Runtime', `${prefix}:agent_runtime`)
    .text('📋 Work Tracker', `${prefix}:work_tracker`)
    .text('Both', `${prefix}:both`)
}

export function roomSelect(rooms: Array<Record<string, unknown>>, prefix: string): InlineKeyboard {
  const kb = new InlineKeyboard()
  for (const room of rooms) {
    kb.text(String(room.name), `${prefix}:${room.id}`).row()
  }
  return kb
}

export function teamSelect(prefix: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('Build', `${prefix}:Build`)
    .text('Ops', `${prefix}:Ops`).row()
    .text('Product', `${prefix}:Product`)
    .text('Platform', `${prefix}:Platform`).row()
    .text('Experience', `${prefix}:Experience`)
    .text('Research', `${prefix}:Research`)
}

export function backButton(callback: string, label = '◀️ Back'): InlineKeyboard {
  return new InlineKeyboard().text(label, callback)
}
