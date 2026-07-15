import { isAdmin } from '../../guards.js';
import { groupIdFromCtx, getDisplayName, replyEphemeral } from '../../helpers.js';
import { Markup } from 'telegraf';
import { TEXT } from '../../text.js';

export function createHandlers({ storage }) {
  const { getPendingRegistrations, savePendingRegistrations } = storage;

  async function start(ctx, next) {
    // A t.me/<bot>?start=offline deep link (shared with a delegate) should reach
    // the offline entry handler registered later, not the admin-only help. The
    // student homework join link (start=hw-<gref>-<ln>) likewise yields to the
    // student handler.
    if (ctx.chat?.type === 'private') {
      const payload = String(ctx.startPayload || '');
      if (payload === 'offline' || payload.startsWith('hw-')) return next();
    }
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

  async function groupid(ctx) {
    if (ctx.chat?.type !== 'group' && ctx.chat?.type !== 'supergroup') {
      return replyEphemeral(ctx, TEXT.groupIdPrivateChat);
    }
    if (!await isAdmin(ctx)) return replyEphemeral(ctx, TEXT.adminOnly);
    return ctx.replyWithMarkdown(TEXT.groupIdInfo(groupIdFromCtx(ctx)));
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

  return { start, help, myid, groupid, registerCmd };
}

export function register(bot, storage) {
  const h = createHandlers({ storage });
  bot.start(h.start);
  bot.help(h.help);
  bot.command('myid', h.myid);
  bot.command('groupid', h.groupid);
  bot.command('register', h.registerCmd);
}
