import { isAdmin } from '../../guards.js';
import { groupIdFromCtx } from '../../helpers.js';
import { TEXT } from '../../text.js';
import { sessionText, sessionKb } from '../../widgets.js';

export function register(bot, storage) {
  const { getMaster, getSession, saveSession, getCurrentSeries, getGroupRecitationNextPage } = storage;

  async function startSession(ctx, openRegistration) {
    if (!await isAdmin(ctx)) return ctx.reply(TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    if (await getSession(groupId)) return ctx.reply(TEXT.sessionAlreadyActive);

    const name = ctx.message.text.split(' ').slice(1).join(' ').trim();
    if (!name) return ctx.reply(TEXT.invalidStartFormat);

    const master = await getMaster(groupId);
    const currentSeries = await getCurrentSeries(groupId);
    const attendance = openRegistration
      ? {}
      : Object.fromEntries(master.members.map((m) => [m.name, null]));

    const session = {
      name,
      startedAt: new Date().toISOString(),
      startedBy: ctx.from.id,
      seriesId: currentSeries,
      chatId:    ctx.chat.id,
      messageId: null,
      active:    true,
      registrationOpen: true,
      openRegistration,
      attendance,
      called: {},
    };

    const sent = await ctx.replyWithMarkdown(sessionText(session, master), sessionKb(true, true, openRegistration));
    session.messageId = sent.message_id;
    await saveSession(groupId, session);
    try { await ctx.pinChatMessage(sent.message_id, { disable_notification: true }); } catch (_) {}
  }

  bot.command('startlist',           (ctx) => startSession(ctx, true));
  bot.command('startregisteredlist', (ctx) => startSession(ctx, false));

  bot.command('startpagelist', async (ctx) => {
    if (!await isAdmin(ctx)) return ctx.reply(TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    if (await getSession(groupId)) return ctx.reply(TEXT.sessionAlreadyActive);

    const name = ctx.message.text.split(' ').slice(1).join(' ').trim();
    if (!name) return ctx.reply(TEXT.invalidPageListFormat);

    const master = await getMaster(groupId);
    const currentSeries = await getCurrentSeries(groupId);

    const session = {
      name,
      startedAt: new Date().toISOString(),
      startedBy: ctx.from.id,
      seriesId: currentSeries,
      chatId: ctx.chat.id,
      messageId: null,
      active: true,
      registrationOpen: true,
      openRegistration: true,
      pageList: true,
      pages: {},
      attendance: {},
      called: {},
    };

    const sent = await ctx.replyWithMarkdown(sessionText(session, master), sessionKb(true, true, true));
    session.messageId = sent.message_id;
    await saveSession(groupId, session);
    try { await ctx.pinChatMessage(sent.message_id, { disable_notification: true }); } catch (_) {}
  });

  bot.command('startgrouprecitation', async (ctx) => {
    if (!await isAdmin(ctx)) return ctx.reply(TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    if (await getSession(groupId)) return ctx.reply(TEXT.sessionAlreadyActive);

    const name = ctx.message.text.split(' ').slice(1).join(' ').trim();
    if (!name) return ctx.reply(TEXT.invalidStartGroupRecitationFormat);

    const master = await getMaster(groupId);
    const currentSeries = await getCurrentSeries(groupId);
    const nextPage = await getGroupRecitationNextPage(groupId);

    const session = {
      name,
      startedAt: new Date().toISOString(),
      startedBy: ctx.from.id,
      seriesId: currentSeries,
      chatId: ctx.chat.id,
      messageId: null,
      active: true,
      registrationOpen: true,
      openRegistration: true,
      groupRecitation: true,
      groupRecitationStartPage: nextPage,
      pages: {},
      attendance: {},
      called: {},
    };

    const sent = await ctx.replyWithMarkdown(sessionText(session, master), sessionKb(true, true, true));
    session.messageId = sent.message_id;
    await saveSession(groupId, session);
    try { await ctx.pinChatMessage(sent.message_id, { disable_notification: true }); } catch (_) {}
  });
}
