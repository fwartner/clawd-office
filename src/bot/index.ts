/**
 * Telegram bot — conditional activation.
 * Only starts when TELEGRAM_BOT_TOKEN is set.
 */
import { Bot, type Context } from 'grammy'
import { conversations, createConversation, type ConversationFlavor } from '@grammyjs/conversations'
import type { ApiContext } from '../server/api-routes.js'
import { registerCommands } from './commands.js'
import { registerCallbacks } from './callbacks.js'
import { createConversations } from './conversations.js'
import { initNotifications, setChatId } from './notifications.js'

export type BotContext = ConversationFlavor<Context>

let _bot: Bot<BotContext> | null = null

export async function startBot(token: string, ctx: ApiContext): Promise<void> {
  if (!token) {
    console.log('[bot] No TELEGRAM_BOT_TOKEN — bot disabled')
    return
  }

  const bot = new Bot<BotContext>(token)
  _bot = bot

  // Install conversations plugin
  bot.use(conversations())

  // Create conversation handlers
  const convos = createConversations(ctx)
  bot.use(createConversation(convos.createAgent, 'createAgent'))
  bot.use(createConversation(convos.assignTask, 'assignTask'))
  bot.use(createConversation(convos.proposeDecision, 'proposeDecision'))

  // Register commands
  const cmds = registerCommands(ctx)
  bot.command('start', async (tgCtx) => {
    if (tgCtx.chat?.id) setChatId(tgCtx.chat.id)
    await cmds.start(tgCtx)
  })
  bot.command('help', cmds.help)
  bot.command('agents', cmds.agents)
  bot.command('tasks', cmds.tasks)
  bot.command('rooms', cmds.rooms)
  bot.command('status', cmds.status)

  // Conversation triggers
  bot.command('assign', async (tgCtx) => {
    await tgCtx.conversation.enter('assignTask')
  })
  bot.command('decide', async (tgCtx) => {
    await tgCtx.conversation.enter('proposeDecision')
  })

  // Callback queries (inline keyboard buttons)
  const handleCallback = registerCallbacks(ctx)
  bot.on('callback_query:data', async (tgCtx) => {
    const data = tgCtx.callbackQuery.data
    if (data === 'agent:create') {
      await tgCtx.answerCallbackQuery()
      await tgCtx.conversation.enter('createAgent')
      return
    }
    if (data === 'decision:create') {
      await tgCtx.answerCallbackQuery()
      await tgCtx.conversation.enter('proposeDecision')
      return
    }
    if (data.startsWith('assign:')) {
      await tgCtx.answerCallbackQuery()
      await tgCtx.conversation.enter('assignTask')
      return
    }
    await handleCallback(tgCtx)
  })

  // Error handler
  bot.catch((err) => {
    console.error('[bot] Error:', err.message)
  })

  // Initialize notifications
  initNotifications(bot as unknown as Bot<Context>, 0)

  // Set bot commands in Telegram
  await bot.api.setMyCommands([
    { command: 'start', description: 'Main menu' },
    { command: 'help', description: 'Help' },
    { command: 'agents', description: 'List agents' },
    { command: 'tasks', description: 'List tasks' },
    { command: 'rooms', description: 'List rooms' },
    { command: 'status', description: 'Dashboard' },
    { command: 'assign', description: 'Assign a task' },
    { command: 'decide', description: 'Propose a decision' },
  ])

  // Start polling
  bot.start()
  console.log('[bot] Telegram bot started')
}

export function stopBot(): void {
  if (_bot) {
    _bot.stop()
    _bot = null
    console.log('[bot] Telegram bot stopped')
  }
}

export function isBotRunning(): boolean {
  return _bot !== null
}
