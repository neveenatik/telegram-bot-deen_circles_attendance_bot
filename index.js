import 'dotenv/config';
import { Telegraf } from 'telegraf';
import storage from './lib/storage.js';
import { TEXT } from './lib/text.js';
import { isAdmin } from './lib/guards.js';
import { registerCommands } from './lib/handlers/commands/index.js';
import { registerActions } from './lib/handlers/actions/index.js';

const bot = new Telegraf(process.env.BOT_TOKEN);

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
      const types = ['main', 'open', 'registeredSecondary', 'personalRecitation', 'groupRecitation'];

      let activeType = null;
      let session = null;
      for (const type of types) {
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
  } catch (_) {}

  return next();
});

registerCommands(bot, storage);
registerActions(bot, storage);

bot.catch((err, ctx) => {
  console.error('Bot error:', err?.message);
  ctx?.reply(TEXT.genericError).catch(() => {});
});

if (!process.env.VERCEL) {
  bot.launch().then(() => console.log('✅ Bot is running...'));
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

export default bot;
