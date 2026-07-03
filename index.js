import 'dotenv/config';
import { Telegraf } from 'telegraf';
import storage from './lib/storage.js';
import { ACTIVE_SESSION_TYPES } from './lib/sessionTypes.js';
import { TEXT } from './lib/text.js';
import { isAdmin } from './lib/guards.js';
import { getErrorDescription, replyEphemeral } from './lib/helpers.js';
import { registerCommands } from './lib/handlers/commands/index.js';
import { registerActions } from './lib/handlers/actions/index.js';

const bot = new Telegraf(process.env.BOT_TOKEN);
const ERROR_NOTICE_COOLDOWN_MS = 30000;
const lastErrorNoticeByChat = new Map();

function extractCommand(ctx) {
  const message = ctx.message;
  if (!message?.text || !Array.isArray(message.entities)) return null;
  const first = message.entities.find((e) => e?.type === 'bot_command' && e.offset === 0);
  if (!first) return null;
  const raw = String(message.text).slice(0, first.length);
  if (!raw.startsWith('/')) return null;
  return raw.slice(1).split('@')[0].trim().toLowerCase() || null;
}

bot.use(async (ctx, next) => {
  const cmd = extractCommand(ctx);
  if (cmd) {
    console.log(JSON.stringify({
      level: 'info',
      event: 'command',
      command: cmd,
      chatId: ctx.chat?.id ? String(ctx.chat.id) : null,
      chatType: ctx.chat?.type || null,
      userId: ctx.from?.id ? String(ctx.from.id) : null,
      at: new Date().toISOString(),
    }));
  }
  return next();
});

bot.use(async (ctx, next) => {
  try {
    const chatType = ctx.chat?.type;
    if (ctx.chat?.id && (chatType === 'group' || chatType === 'supergroup')) {
      await storage.touchGroupActivity(String(ctx.chat.id));
    }

    const messageId = ctx.message?.message_id;
    const from = ctx.from;

    if (
      messageId
      && from
      && !from.is_bot
      && chatType
      && chatType !== 'private'
    ) {
      const groupId = String(ctx.chat.id);

      let activeType = null;
      let session = null;
      for (const type of ACTIVE_SESSION_TYPES) {
        const candidate = await storage.getSession(groupId, type);
        if (candidate && candidate.active) {
          activeType = type;
          session = candidate;
          break;
        }
      }

      if (activeType && session && await isAdmin(ctx)) {
        if (!Array.isArray(session.actionMessageIds)) session.actionMessageIds = [];
        if (!session.actionMessageIds.includes(messageId)) {
          session.actionMessageIds.push(messageId);
          await storage.saveSession(groupId, activeType, session);
        }
      }
    }
  } catch (err) {
    console.warn(JSON.stringify({
      level: 'warn',
      event: 'middleware_activity_tracking_failed',
      message: getErrorDescription(err),
      chatId: ctx?.chat?.id ? String(ctx.chat.id) : null,
      userId: ctx?.from?.id ? String(ctx.from.id) : null,
      at: new Date().toISOString(),
    }));
  }

  return next();
});

registerCommands(bot, storage);
registerActions(bot, storage);

bot.catch((err, ctx) => {
  console.error(JSON.stringify({
    level: 'error',
    event: 'bot_error',
    message: getErrorDescription(err),
    updateType: ctx?.updateType || null,
    command: extractCommand(ctx),
    chatId: ctx?.chat?.id ? String(ctx.chat.id) : null,
    userId: ctx?.from?.id ? String(ctx.from.id) : null,
    at: new Date().toISOString(),
  }));

  const replyFailedLog = (replyErr, event = 'bot_error_reply_failed') => {
    console.warn(JSON.stringify({
      level: 'warn',
      event,
      message: getErrorDescription(replyErr),
      chatId: ctx?.chat?.id ? String(ctx.chat.id) : null,
      userId: ctx?.from?.id ? String(ctx.from.id) : null,
      at: new Date().toISOString(),
    }));
  };

  if (ctx?.callbackQuery) {
    ctx.answerCbQuery(TEXT.genericError, { show_alert: true }).catch((replyErr) => {
      replyFailedLog(replyErr, 'bot_error_callback_alert_failed');
    });
    return;
  }

  const chatId = ctx?.chat?.id ? String(ctx.chat.id) : null;
  const chatType = ctx?.chat?.type || null;
  if (chatId && (chatType === 'group' || chatType === 'supergroup')) {
    const now = Date.now();
    const lastSentAt = lastErrorNoticeByChat.get(chatId) || 0;
    if (now - lastSentAt < ERROR_NOTICE_COOLDOWN_MS) return;
    lastErrorNoticeByChat.set(chatId, now);

    replyEphemeral(ctx, TEXT.genericError).catch((replyErr) => {
      replyFailedLog(replyErr);
    });
    return;
  }

  ctx?.reply(TEXT.genericError).catch((replyErr) => {
    replyFailedLog(replyErr);
  });
});

if (!process.env.VERCEL) {
  bot.launch().then(() => console.log('✅ Bot is running...'));
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

export default bot;
