import { isAdmin } from '../../guards.js';
import { groupIdFromCtx } from '../../helpers.js';
import { TEXT } from '../../text.js';
import { sessionText, sessionKb } from '../../widgets.js';

export function register(bot, storage) {
  const { getMaster, getSession, saveSession, getGroupRecitationNextPage } = storage;

  // Helper to check if any session is currently active
  async function hasActiveSession(groupId) {
    const types = ['main', 'open', 'registeredSecondary', 'personalRecitation', 'groupRecitation'];
    for (const type of types) {
      const session = await getSession(groupId, type);
      if (session && session.active) return true;
    }
    return false;
  }

  async function startSession(ctx, type, initializeAttendance) {
    if (!await isAdmin(ctx)) return ctx.reply(TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    if (await hasActiveSession(groupId)) return ctx.reply(TEXT.sessionAlreadyActive);

    const name = ctx.message.text.split(' ').slice(1).join(' ').trim();
    if (!name) return ctx.reply(TEXT.invalidStartFormat);

    const master = await getMaster(groupId);
    const attendance = initializeAttendance
      ? Object.fromEntries(master.members.map((m) => [m.name, null]))
      : {};

    const session = {
      type,
      name,
      startedAt: new Date().toISOString(),
      startedBy: ctx.from.id,
      chatId:    ctx.chat.id,
      messageId: null,
      active:    true,
      registrationActive: true,
      allowPublicRegistration: type === 'open',
      attendance,
      registrationTimes: {},
      called: {},
    };

    const sent = await ctx.replyWithMarkdown(sessionText(session, master), sessionKb(true, true, session.allowPublicRegistration));
    session.messageId = sent.message_id;
    await saveSession(groupId, type, session);
    try { await ctx.pinChatMessage(sent.message_id, { disable_notification: true }); } catch (_) {}
  }

  bot.command('startlist',           (ctx) => startSession(ctx, 'main', true));
  bot.command('startopenlist',       (ctx) => startSession(ctx, 'open', false));
  bot.command('startsecondarylist',  (ctx) => startSession(ctx, 'registeredSecondary', true));

  bot.command('startpersonalrecitation', async (ctx) => {
    if (!await isAdmin(ctx)) return ctx.reply(TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    if (await hasActiveSession(groupId)) return ctx.reply(TEXT.sessionAlreadyActive);

    const name = ctx.message.text.split(' ').slice(1).join(' ').trim();
    if (!name) return ctx.reply(TEXT.invalidPageListFormat);

    const master = await getMaster(groupId);
    const session = {
      type: 'personalRecitation',
      name,
      startedAt: new Date().toISOString(),
      startedBy: ctx.from.id,
      chatId: ctx.chat.id,
      messageId: null,
      active: true,
      registrationActive: true,
      allowPublicRegistration: true,
      pages: {},
      attendance: {},
      registrationTimes: {},
      called: {},
    };

    const sent = await ctx.replyWithMarkdown(sessionText(session, master), sessionKb(true, true, true));
    session.messageId = sent.message_id;
    await saveSession(groupId, 'personalRecitation', session);
    try { await ctx.pinChatMessage(sent.message_id, { disable_notification: true }); } catch (_) {}
  });

  bot.command('startgrouprecitation', async (ctx) => {
    if (!await isAdmin(ctx)) return ctx.reply(TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    if (await hasActiveSession(groupId)) return ctx.reply(TEXT.sessionAlreadyActive);

    const name = ctx.message.text.split(' ').slice(1).join(' ').trim();
    if (!name) return ctx.reply(TEXT.invalidStartGroupRecitationFormat);

    const master = await getMaster(groupId);
    const nextPage = await getGroupRecitationNextPage(groupId);

    const session = {
      type: 'groupRecitation',
      name,
      startedAt: new Date().toISOString(),
      startedBy: ctx.from.id,
      chatId: ctx.chat.id,
      messageId: null,
      active: true,
      registrationActive: true,
      allowPublicRegistration: true,
      groupRecitation: true,
      groupRecitationStartPage: nextPage,
      pages: {},
      attendance: {},
      registrationTimes: {},
      called: {},
    };

    const sent = await ctx.replyWithMarkdown(sessionText(session, master), sessionKb(true, true, true));
    session.messageId = sent.message_id;
    await saveSession(groupId, 'groupRecitation', session);
    try { await ctx.pinChatMessage(sent.message_id, { disable_notification: true }); } catch (_) {}
  });
}
