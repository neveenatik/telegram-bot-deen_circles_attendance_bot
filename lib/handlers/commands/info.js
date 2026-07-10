import { isAdmin } from '../../guards.js';
import { groupIdFromCtx, getDisplayName, replyEphemeral } from '../../helpers.js';
import { Markup } from 'telegraf';
import { TEXT } from '../../text.js';

export function createHandlers({ storage }) {
  const { getPendingRegistrations, savePendingRegistrations } = storage;

  async function start(ctx) {
    if (!await isAdmin(ctx)) return replyEphemeral(ctx, TEXT.adminOnly);
    return ctx.replyWithMarkdown(TEXT.help(true));
  }

  async function help(ctx) {
    return ctx.replyWithMarkdown(TEXT.help(await isAdmin(ctx)));
  }

  async function myid(ctx) {
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
  }

  async function registerCmd(ctx) {
    if (!await isAdmin(ctx)) return replyEphemeral(ctx, TEXT.adminOnly);
    return ctx.replyWithMarkdown(
      TEXT.registerWidgetText,
      Markup.inlineKeyboard([
        [Markup.button.callback(TEXT.registerWidgetButton, 'pr:join')],
        [Markup.button.callback(TEXT.registerWidgetCloseButton, 'pr:close')],
      ])
    );
  }

  return { start, help, myid, registerCmd };
}

export function register(bot, storage) {
  const h = createHandlers({ storage });
  bot.start(h.start);
  bot.help(h.help);
  bot.command('myid', h.myid);
  bot.command('register', h.registerCmd);
}
