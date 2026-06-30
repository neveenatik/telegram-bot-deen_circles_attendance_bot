import 'dotenv/config';
import { Telegraf } from 'telegraf';
import storage from './storage.js';
import { TEXT } from './lib/text.js';
import { registerCommands } from './lib/handlers/commands/index.js';
import { registerActions } from './lib/handlers/actions/index.js';

const bot = new Telegraf(process.env.BOT_TOKEN);

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
