import { isAdmin } from '../../guards.js';
import { replyEphemeral } from '../../helpers.js';
import { TEXT } from '../../text.js';

export function register(bot) {
  bot.start(async (ctx) => {
    if (!await isAdmin(ctx)) return replyEphemeral(ctx, TEXT.adminOnly);
    return ctx.replyWithMarkdown(TEXT.help(true));
  });

  bot.help(async (ctx) => ctx.replyWithMarkdown(TEXT.help(await isAdmin(ctx))));

  bot.command('myid', async (ctx) => {
    const displayName = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ')
      || ctx.from.username || TEXT.noNameFallback;
    await ctx.reply(TEXT.myIdInfo);
    await ctx.reply(`${ctx.from.id} | ${displayName}`);
  });

  bot.command('registerinfo', async (ctx) => {
    if (!await isAdmin(ctx)) return replyEphemeral(ctx, TEXT.adminOnly);
    ctx.replyWithMarkdown(TEXT.registerInfo);
  });
}
