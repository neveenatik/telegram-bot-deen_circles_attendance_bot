import { isAdmin } from '../../guards.js';
import { groupIdFromCtx, getDisplayName, replyEphemeral } from '../../helpers.js';
import { Markup } from 'telegraf';
import { TEXT } from '../../text.js';

export function register(bot, storage) {
  const { getPendingRegistrations, savePendingRegistrations } = storage;

  bot.start(async (ctx) => {
    if (!await isAdmin(ctx)) return replyEphemeral(ctx, TEXT.adminOnly);
    return ctx.replyWithMarkdown(TEXT.help(true));
  });

  bot.help(async (ctx) => ctx.replyWithMarkdown(TEXT.help(await isAdmin(ctx))));

  bot.command('myid', async (ctx) => {
    const displayName = getDisplayName(ctx.from);

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

  bot.command('register', async (ctx) => {
    if (!await isAdmin(ctx)) return replyEphemeral(ctx, TEXT.adminOnly);
    return ctx.replyWithMarkdown(
      TEXT.registerWidgetText,
      Markup.inlineKeyboard([
        [Markup.button.callback(TEXT.registerWidgetButton, 'pr:join')],
        [Markup.button.callback(TEXT.registerWidgetCloseButton, 'pr:close')],
      ])
    );
  });
}
