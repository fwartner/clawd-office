/**
 * Telegram bot callback query handlers (inline keyboard button presses).
 */
import type { Context } from 'grammy'
import type { ApiContext } from '../server/api-routes.js'
import * as kb from './keyboards.js'
import { agentCard, taskCard, dashboardSummary, escapeMarkdown, presenceEmoji } from './formatters.js'

export function registerCallbacks(apiCtx: ApiContext) {
  return async function handleCallback(tgCtx: Context) {
    const data = tgCtx.callbackQuery?.data
    if (!data) return

    try {
      // Main menu navigation
      if (data === 'menu:main') {
        await tgCtx.editMessageText('🏢 *Agent Office*', {
          parse_mode: 'MarkdownV2',
          reply_markup: kb.mainMenu(),
        })
      }

      // Agents list
      else if (data === 'menu:agents') {
        const snap = await apiCtx.getSnapshot()
        const agents = snap.agents as Record<string, unknown>[]
        const lines = agents.map(a => agentCard(a)).join('\n\n')
        await tgCtx.editMessageText(lines || 'No agents yet\\.', {
          parse_mode: 'MarkdownV2',
          reply_markup: kb.agentList(agents),
        })
      }

      // Agent detail
      else if (data.startsWith('agent:') && data !== 'agent:create') {
        const agentId = data.split(':')[1]
        const snap = await apiCtx.getSnapshot()
        const agent = (snap.agents as Record<string, unknown>[]).find(a => a.id === agentId)
        if (!agent) {
          await tgCtx.answerCallbackQuery({ text: 'Agent not found' })
          return
        }
        await tgCtx.editMessageText(agentCard(agent), {
          parse_mode: 'MarkdownV2',
          reply_markup: kb.agentDetail(agentId),
        })
      }

      // Delete agent confirmation
      else if (data.startsWith('delete_agent:')) {
        const agentId = data.replace('delete_agent:', '')
        await tgCtx.editMessageText(`Are you sure you want to delete agent *${escapeMarkdown(agentId)}*?`, {
          parse_mode: 'MarkdownV2',
          reply_markup: kb.agentDeleteConfirm(agentId),
        })
      }

      // Confirm delete agent
      else if (data.startsWith('confirm_delete_agent:')) {
        const agentId = data.replace('confirm_delete_agent:', '')
        await apiCtx.deleteAgent(agentId)
        await tgCtx.editMessageText(`✅ Agent *${escapeMarkdown(agentId)}* deleted\\.`, {
          parse_mode: 'MarkdownV2',
          reply_markup: kb.backButton('menu:agents', '◀️ Back to Agents'),
        })
      }

      // Tasks list
      else if (data === 'menu:tasks') {
        const snap = await apiCtx.getSnapshot()
        const tasks = snap.assignments as Record<string, unknown>[]
        const active = tasks.filter(t => t.status !== 'done').slice(0, 10)
        const lines = active.map(t => taskCard(t)).join('\n\n')
        await tgCtx.editMessageText(lines || 'No active tasks\\.', {
          parse_mode: 'MarkdownV2',
          reply_markup: kb.taskList(tasks),
        })
      }

      // Task detail
      else if (data.startsWith('task:')) {
        const taskId = data.replace('task:', '')
        const snap = await apiCtx.getSnapshot()
        const task = (snap.assignments as Record<string, unknown>[]).find(t => t.id === taskId)
        if (!task) {
          await tgCtx.answerCallbackQuery({ text: 'Task not found' })
          return
        }
        let text = taskCard(task)
        if (task.taskBrief) text += `\n\n${escapeMarkdown(String(task.taskBrief).slice(0, 200))}`
        if (task.result) text += `\n\n*Result:* ${escapeMarkdown(String(task.result).slice(0, 300))}`
        await tgCtx.editMessageText(text, {
          parse_mode: 'MarkdownV2',
          reply_markup: kb.taskDetail(taskId, String(task.status)),
        })
      }

      // Complete task
      else if (data.startsWith('complete_task:')) {
        const taskId = data.replace('complete_task:', '')
        await apiCtx.updateAssignment(taskId, 'done')
        await tgCtx.editMessageText(`✅ Task marked as done\\.`, {
          parse_mode: 'MarkdownV2',
          reply_markup: kb.backButton('menu:tasks', '◀️ Back to Tasks'),
        })
      }

      // Block task
      else if (data.startsWith('block_task:')) {
        const taskId = data.replace('block_task:', '')
        await apiCtx.updateAssignment(taskId, 'blocked')
        await tgCtx.editMessageText(`🔴 Task marked as blocked\\.`, {
          parse_mode: 'MarkdownV2',
          reply_markup: kb.backButton('menu:tasks', '◀️ Back to Tasks'),
        })
      }

      // Rooms list
      else if (data === 'menu:rooms') {
        const snap = await apiCtx.getSnapshot()
        const rooms = snap.rooms as Record<string, unknown>[]
        const lines = rooms.map(r => {
          const agents = (r.agents as string[]) || []
          return `🏠 *${escapeMarkdown(String(r.name))}* — ${agents.length} agents`
        }).join('\n')
        await tgCtx.editMessageText(lines || 'No rooms\\.', {
          parse_mode: 'MarkdownV2',
          reply_markup: kb.roomList(rooms),
        })
      }

      // Status
      else if (data === 'menu:status') {
        const snap = await apiCtx.getSnapshot()
        await tgCtx.editMessageText(dashboardSummary(snap as unknown as Record<string, unknown>), {
          parse_mode: 'MarkdownV2',
          reply_markup: kb.mainMenu(),
        })
      }

      // Decisions list
      else if (data === 'menu:decisions') {
        const snap = await apiCtx.getSnapshot()
        const decisions = snap.decisions as Record<string, unknown>[]
        if (decisions.length === 0) {
          await tgCtx.editMessageText('No decisions yet\\.', {
            parse_mode: 'MarkdownV2',
            reply_markup: kb.decisionList([]),
          })
          return
        }
        const lines = decisions.slice(0, 5).map(d => {
          const icon = d.status === 'accepted' ? '✅' : d.status === 'rejected' ? '❌' : '🗳'
          return `${icon} *${escapeMarkdown(String(d.title))}* — ${escapeMarkdown(String(d.status))}`
        }).join('\n')
        await tgCtx.editMessageText(lines, {
          parse_mode: 'MarkdownV2',
          reply_markup: kb.decisionList(decisions),
        })
      }

      // Decision detail
      else if (data.startsWith('decision:') && data !== 'decision:create') {
        const decisionId = data.replace('decision:', '')
        const snap = await apiCtx.getSnapshot()
        const decision = (snap.decisions as Record<string, unknown>[]).find(d => d.id === decisionId)
        if (!decision) {
          await tgCtx.answerCallbackQuery({ text: 'Decision not found' })
          return
        }
        const text = `🗳 *${escapeMarkdown(String(decision.title))}*\n\n${escapeMarkdown(String(decision.detail))}\n\nStatus: ${escapeMarkdown(String(decision.status))}`
        await tgCtx.editMessageText(text, {
          parse_mode: 'MarkdownV2',
          reply_markup: kb.decisionDetail(decisionId, String(decision.status)),
        })
      }

      // Accept/reject decision
      else if (data.startsWith('accept_decision:') || data.startsWith('reject_decision:')) {
        const isAccept = data.startsWith('accept_')
        const decisionId = data.replace(/^(accept|reject)_decision:/, '')
        await apiCtx.updateDecision(decisionId, { status: isAccept ? 'accepted' : 'rejected' })
        await tgCtx.editMessageText(isAccept ? '✅ Decision accepted\\.' : '❌ Decision rejected\\.', {
          parse_mode: 'MarkdownV2',
          reply_markup: kb.backButton('menu:decisions', '◀️ Back to Decisions'),
        })
      }

      // Settings
      else if (data === 'menu:settings') {
        await tgCtx.editMessageText('⚙️ *Settings*\n\nUse the web UI to manage settings\\.', {
          parse_mode: 'MarkdownV2',
          reply_markup: kb.backButton('menu:main'),
        })
      }

      await tgCtx.answerCallbackQuery()
    } catch (e) {
      console.error('[bot] Callback error:', e)
      await tgCtx.answerCallbackQuery({ text: 'An error occurred' })
    }
  }
}
