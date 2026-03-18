/**
 * Telegram bot command handlers.
 */
import type { Context } from 'grammy'
import type { ApiContext } from '../server/api-routes.js'
import { mainMenu, agentList, taskList, roomList, decisionList } from './keyboards.js'
import { agentCard, taskCard, dashboardSummary, escapeMarkdown } from './formatters.js'

export function registerCommands(ctx: ApiContext) {
  return {
    async start(tgCtx: Context) {
      await tgCtx.reply(
        '🏢 *Welcome to Agent Office\\!*\n\nManage your AI agent team from Telegram\\.',
        { parse_mode: 'MarkdownV2', reply_markup: mainMenu() }
      )
    },

    async help(tgCtx: Context) {
      await tgCtx.reply(
        `*Available Commands:*

/start — Main menu
/help — This help message
/agents — List all agents
/tasks — List active tasks
/rooms — List rooms
/status — Dashboard summary
/assign — Assign a task
/decide — Propose a decision`,
        { parse_mode: 'MarkdownV2' }
      )
    },

    async agents(tgCtx: Context) {
      try {
        const snapshot = await ctx.getSnapshot()
        const agents = snapshot.agents as Record<string, unknown>[]
        if (agents.length === 0) {
          await tgCtx.reply('No agents yet\\. Use the button below to create one\\.', {
            parse_mode: 'MarkdownV2',
            reply_markup: agentList([]),
          })
          return
        }
        const lines = agents.map(a => agentCard(a)).join('\n\n')
        await tgCtx.reply(lines, {
          parse_mode: 'MarkdownV2',
          reply_markup: agentList(agents),
        })
      } catch {
        await tgCtx.reply('Failed to fetch agents.')
      }
    },

    async tasks(tgCtx: Context) {
      try {
        const snapshot = await ctx.getSnapshot()
        const tasks = snapshot.assignments as Record<string, unknown>[]
        if (tasks.length === 0) {
          await tgCtx.reply('No tasks yet.')
          return
        }
        const active = tasks.filter(t => t.status !== 'done').slice(0, 10)
        const lines = active.map(t => taskCard(t)).join('\n\n')
        await tgCtx.reply(lines || 'No active tasks\\.', {
          parse_mode: 'MarkdownV2',
          reply_markup: taskList(tasks),
        })
      } catch {
        await tgCtx.reply('Failed to fetch tasks.')
      }
    },

    async rooms(tgCtx: Context) {
      try {
        const snapshot = await ctx.getSnapshot()
        const rooms = snapshot.rooms as Record<string, unknown>[]
        const lines = rooms.map(r => {
          const agents = (r.agents as string[]) || []
          return `🏠 *${escapeMarkdown(String(r.name))}* — ${escapeMarkdown(String(r.team))}\n  ${agents.length} agents`
        }).join('\n\n')
        await tgCtx.reply(lines || 'No rooms\\.', {
          parse_mode: 'MarkdownV2',
          reply_markup: roomList(rooms),
        })
      } catch {
        await tgCtx.reply('Failed to fetch rooms.')
      }
    },

    async status(tgCtx: Context) {
      try {
        const snapshot = await ctx.getSnapshot()
        await tgCtx.reply(dashboardSummary(snapshot as unknown as Record<string, unknown>), {
          parse_mode: 'MarkdownV2',
          reply_markup: mainMenu(),
        })
      } catch {
        await tgCtx.reply('Failed to fetch status.')
      }
    },
  }
}
