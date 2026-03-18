/**
 * Multi-step conversation flows for Telegram bot.
 * Uses grammy conversations plugin for stateful flows.
 */
import type { Context } from 'grammy'
import type { Conversation } from '@grammyjs/conversations'
import type { ApiContext } from '../server/api-routes.js'
import { prioritySelect, routingSelect, roomSelect, teamSelect } from './keyboards.js'
import { VALID_PRESENCE, AGENT_ID_RE } from '../server/validation.js'

type BotContext = Context
type BotConversation = Conversation<BotContext>

export function createConversations(apiCtx: ApiContext) {
  async function createAgent(conversation: BotConversation, ctx: BotContext) {
    await ctx.reply('📝 *Create New Agent*\n\nEnter the agent ID \\(lowercase, hyphens only\\):', { parse_mode: 'MarkdownV2' })
    const idMsg = await conversation.waitFor('message:text')
    const id = idMsg.message?.text?.trim() || ''
    if (!AGENT_ID_RE.test(id)) {
      await ctx.reply('Invalid ID. Must be lowercase alphanumeric with hyphens. Cancelled.')
      return
    }

    await ctx.reply('Enter the display name:')
    const nameMsg = await conversation.waitFor('message:text')
    const name = nameMsg.message?.text?.trim() || ''

    await ctx.reply('Enter the role:')
    const roleMsg = await conversation.waitFor('message:text')
    const role = roleMsg.message?.text?.trim() || ''

    await ctx.reply('Select the team:', { reply_markup: teamSelect('create_agent_team') })
    const teamCb = await conversation.waitForCallbackQuery(/^create_agent_team:/)
    const team = teamCb.callbackQuery?.data?.replace('create_agent_team:', '') || 'Build'
    await teamCb.answerCallbackQuery()

    const snapshot = await apiCtx.getSnapshot()
    const rooms = snapshot.rooms as Record<string, unknown>[]
    await ctx.reply('Select the room:', { reply_markup: roomSelect(rooms, 'create_agent_room') })
    const roomCb = await conversation.waitForCallbackQuery(/^create_agent_room:/)
    const roomId = roomCb.callbackQuery?.data?.replace('create_agent_room:', '') || 'commons'
    await roomCb.answerCallbackQuery()

    try {
      await apiCtx.createAgent({ id, name, role, team, roomId, presence: 'available' })
      await ctx.reply(`✅ Agent *${name}* created successfully\\!`, { parse_mode: 'MarkdownV2' })
    } catch (e) {
      await ctx.reply(`Failed to create agent: ${e instanceof Error ? e.message : 'Unknown error'}`)
    }
  }

  async function assignTask(conversation: BotConversation, ctx: BotContext) {
    const snapshot = await apiCtx.getSnapshot()
    const agents = snapshot.agents as Record<string, unknown>[]
    if (agents.length === 0) {
      await ctx.reply('No agents available. Create an agent first.')
      return
    }

    const { InlineKeyboard } = await import('grammy')
    const agentKb = new InlineKeyboard()
    for (const agent of agents) {
      agentKb.text(String(agent.name), `assign_agent:${agent.id}`).row()
    }
    await ctx.reply('Select the agent to assign the task to:', { reply_markup: agentKb })
    const agentCb = await conversation.waitForCallbackQuery(/^assign_agent:/)
    const targetAgentId = agentCb.callbackQuery?.data?.replace('assign_agent:', '') || ''
    await agentCb.answerCallbackQuery()

    await ctx.reply('Enter the task title:')
    const titleMsg = await conversation.waitFor('message:text')
    const taskTitle = titleMsg.message?.text?.trim() || ''

    await ctx.reply('Enter the task brief \\(or type /skip\\):', { parse_mode: 'MarkdownV2' })
    const briefMsg = await conversation.waitFor('message:text')
    const taskBrief = briefMsg.message?.text === '/skip' ? '' : (briefMsg.message?.text?.trim() || '')

    await ctx.reply('Select priority:', { reply_markup: prioritySelect('assign_priority') })
    const priorityCb = await conversation.waitForCallbackQuery(/^assign_priority:/)
    const priority = priorityCb.callbackQuery?.data?.replace('assign_priority:', '') || 'medium'
    await priorityCb.answerCallbackQuery()

    await ctx.reply('Select routing:', { reply_markup: routingSelect('assign_routing') })
    const routingCb = await conversation.waitForCallbackQuery(/^assign_routing:/)
    const routingTarget = routingCb.callbackQuery?.data?.replace('assign_routing:', '') || 'work_tracker'
    await routingCb.answerCallbackQuery()

    try {
      await apiCtx.createAssignment({ targetAgentId, taskTitle, taskBrief, priority, routingTarget })
      await ctx.reply(`✅ Task assigned to ${targetAgentId}\\!`, { parse_mode: 'MarkdownV2' })
    } catch (e) {
      await ctx.reply(`Failed to assign task: ${e instanceof Error ? e.message : 'Unknown error'}`)
    }
  }

  async function proposeDecision(conversation: BotConversation, ctx: BotContext) {
    await ctx.reply('🗳 *New Decision*\n\nEnter the decision title:', { parse_mode: 'MarkdownV2' })
    const titleMsg = await conversation.waitFor('message:text')
    const title = titleMsg.message?.text?.trim() || ''

    await ctx.reply('Enter the decision detail:')
    const detailMsg = await conversation.waitFor('message:text')
    const detail = detailMsg.message?.text?.trim() || ''

    try {
      await apiCtx.createDecision({ title, detail })
      await ctx.reply(`✅ Decision proposed: "${title}"`)
    } catch (e) {
      await ctx.reply(`Failed to create decision: ${e instanceof Error ? e.message : 'Unknown error'}`)
    }
  }

  return { createAgent, assignTask, proposeDecision }
}
