import { isAdmin } from '../../guards.js';
import { TEXT } from '../../text.js';

export function register(bot) {
  bot.start(async (ctx) => {
    if (!await isAdmin(ctx)) return ctx.reply(TEXT.adminOnly);
    return ctx.replyWithMarkdown(TEXT.help(true));
  });

  bot.help(async (ctx) => ctx.replyWithMarkdown(TEXT.help(await isAdmin(ctx))));

  bot.command('myid', (ctx) => {
    const displayName = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ')
      || ctx.from.username || TEXT.noNameFallback;
    ctx.reply(TEXT.myIdInfo(displayName, ctx.from.id));
  });

  bot.command('registerinfo', async (ctx) => {
    if (!await isAdmin(ctx)) return ctx.reply(TEXT.adminOnly);
    ctx.replyWithMarkdown(TEXT.registerInfo);
  });
}
