/**
 * Push notifications — sends Telegram messages when office events occur.
 */
import type { Bot, Context } from 'grammy'
import { onAll, type OfficeEvent } from '../server/events.js'
import { escapeMarkdown, presenceEmoji } from './formatters.js'

let _bot: Bot<Context> | null = null
let _chatId: number | null = null

export function initNotifications(bot: Bot<Context>, chatId: number): void {
  _bot = bot
  _chatId = chatId
  onAll(handleEvent)
}

export function setChatId(chatId: number): void {
  _chatId = chatId
}

async function handleEvent(event: OfficeEvent): Promise<void> {
  if (!_bot || !_chatId) return

  let text: string | null = null

  switch (event.type) {
    case 'agent.created':
      text = `🤖 Agent *${escapeMarkdown(event.name)}* created`
      break
    case 'agent.deleted':
      text = `🗑 Agent *${escapeMarkdown(event.agentId)}* deleted`
      break
    case 'agent.presence_changed':
      text = `${presenceEmoji(event.to)} Agent *${escapeMarkdown(event.agentId)}* changed from ${escapeMarkdown(event.from)} to ${escapeMarkdown(event.to)}`
      break
    case 'task.completed':
      text = `✅ Task *${escapeMarkdown(event.title)}* completed by ${escapeMarkdown(event.agentId)}`
      if (event.result) text += `\n\nResult: ${escapeMarkdown(event.result.slice(0, 200))}`
      break
    case 'task.failed':
      text = `🔴 Task *${escapeMarkdown(event.title)}* failed for ${escapeMarkdown(event.agentId)}\n\nError: ${escapeMarkdown(event.error.slice(0, 200))}`
      break
    case 'decision.created':
      text = `🗳 New decision proposed: *${escapeMarkdown(event.title)}*`
      break
  }

  if (text) {
    try {
      await _bot.api.sendMessage(_chatId, text, { parse_mode: 'MarkdownV2' })
    } catch (e) {
      console.error('[bot] Notification send error:', e)
    }
  }
}
