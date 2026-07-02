import { isAdmin } from '../../guards.js';
import { groupIdFromCtx, replyEphemeral } from '../../helpers.js';
import { TEXT } from '../../text.js';

export function register(bot, storage) {
  const { getPendingRegistrations, savePendingRegistrations } = storage;

  bot.start(async (ctx) => {
    if (!await isAdmin(ctx)) return replyEphemeral(ctx, TEXT.adminOnly);
    return ctx.replyWithMarkdown(TEXT.help(true));
  });

  bot.help(async (ctx) => ctx.replyWithMarkdown(TEXT.help(await isAdmin(ctx))));

  bot.command('myid', async (ctx) => {
    const displayName = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ')
      || ctx.from.username || TEXT.noNameFallback;

    if (ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup') {
      const groupId = groupIdFromCtx(ctx);
      const pending = await getPendingRegistrations(groupId);
      const userId = String(ctx.from.id);
      const entry = {
        userId,
        name: displayName,
        username: ctx.from.username || null,
        submittedAt: new Date().toISOString(),
      };
      const idx = pending.findIndex((item) => String(item.userId) === userId);
      if (idx >= 0) pending[idx] = entry;
      else pending.push(entry);
      await savePendingRegistrations(groupId, pending);
    }

    await ctx.reply(TEXT.myIdInfo);
    await ctx.reply(`${ctx.from.id} | ${displayName}`);
  });

  bot.command('registerinfo', async (ctx) => {
    if (!await isAdmin(ctx)) return replyEphemeral(ctx, TEXT.adminOnly);
    ctx.replyWithMarkdown(TEXT.registerInfo);
  });
}
