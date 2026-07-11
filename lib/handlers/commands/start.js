import { isAdmin } from '../../guards.js';
import { groupIdFromCtx, logTelegramError, replyEphemeral } from '../../helpers.js';
import { ACTIVE_SESSION_TYPES } from '../../sessionTypes.js';
import { syncSessionNamesFromMaster as defaultSyncSessionNamesFromMaster } from '../../sessionSync.js';
import { TEXT } from '../../text.js';
import { sessionText, sessionKb, refreshSessionWidget as defaultRefreshSessionWidget } from '../../widgets.js';

const DEFAULT_SESSION_NAMES = {
  main: 'مجلس اليوم',
  training: 'حلقة التدريب',
  open: 'مجلس مفتوح',
  registeredSecondary: 'تصحيح التلاوة',
  personalRecitation: 'ختمة فردية',
  groupRecitation: 'ختمة جماعية',
};

export function createHandlers({
  storage,
  telegram,
  refreshSessionWidget = defaultRefreshSessionWidget,
  syncSessionNamesFromMaster = defaultSyncSessionNamesFromMaster,
}) {
  const { getMaster, getSession, saveSession, setGroupRecitationPageCounter, getCurrentSeries, getGroupRecitationNextPage, getTrainingGroups } = storage;

  async function resendFirstActiveSessionWidget(groupId, requestedType, fallbackChatId = null) {
    for (const type of ACTIVE_SESSION_TYPES) {
      const session = await getSession(groupId, type);
      if (!session || !session.active) continue;

      const master = await getMaster(groupId);
      const sync = syncSessionNamesFromMaster(session, master);
      const chatId = session.chatId || fallbackChatId;
      if (!chatId) return false;

      const oldMainMessageId = session.messageId || null;
      const oldListMessageIds = Array.isArray(session.listMessageIds) ? [...session.listMessageIds] : [];

      const sent = await telegram.sendMessage(
        chatId,
        sessionText(session, master),
        { parse_mode: 'Markdown', ...sessionKb(session.active, session.registrationActive !== false, session.allowPublicRegistration) }
      );

      session.chatId = chatId;
      session.messageId = sent.message_id;
      session.listMessageIds = [];
      await saveSession(groupId, type, session);

      await refreshSessionWidget(telegram, session, master, async () => saveSession(groupId, type, session));

      try {
        await telegram.pinChatMessage(chatId, sent.message_id, { disable_notification: true });
      } catch (err) {
        logTelegramError('start.pinResentMainWidget', err, {
          groupId,
          sessionType: type,
          messageId: sent.message_id,
        });
      }

      if (oldMainMessageId) {
        try {
          await telegram.deleteMessage(chatId, oldMainMessageId);
        } catch (err) {
          logTelegramError('start.deleteOldMainWidget', err, {
            groupId,
            sessionType: type,
            messageId: oldMainMessageId,
          });
        }
      }

      for (const msgId of oldListMessageIds) {
        try {
          await telegram.deleteMessage(chatId, msgId);
        } catch (err) {
          logTelegramError('start.deleteOldListWidget', err, {
            groupId,
            sessionType: type,
            messageId: msgId,
          });
        }
      }

      console.log(JSON.stringify({
        level: 'info',
        event: 'start_resent_existing_session',
        groupId,
        requestedType,
        activeType: type,
        syncChanged: sync.changed,
        syncAdded: sync.added,
        syncRemoved: sync.removed,
        oldMainMessageId,
        oldListCount: oldListMessageIds.length,
        sessionMessageId: session.messageId || null,
        at: new Date().toISOString(),
      }));
      return true;
    }
    return false;
  }

  async function listActiveSessions(groupId) {
    const activeSessions = [];
    for (const type of ACTIVE_SESSION_TYPES) {
      const session = await getSession(groupId, type);
      if (session && session.active) {
        activeSessions.push({
          type,
          messageId: session.messageId || null,
          registrationActive: session.registrationActive,
          startedAt: session.startedAt || null,
        });
      }
    }
    return activeSessions;
  }

  // Helper to check if any session is currently active
  async function hasActiveSession(groupId) {
    const activeSessions = await listActiveSessions(groupId);
    return activeSessions.length > 0;
  }

  async function startSession(ctx, type, initializeAttendance, defaultName, options = {}) {
    if (!await isAdmin(ctx)) return replyEphemeral(ctx, TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    if (await hasActiveSession(groupId)) {
      const activeSessions = await listActiveSessions(groupId);
      console.log(JSON.stringify({
        level: 'info',
        event: 'start_blocked_active_session',
        commandType: type,
        groupId,
        chatId: ctx?.chat?.id ? String(ctx.chat.id) : null,
        userId: ctx?.from?.id ? String(ctx.from.id) : null,
        activeSessions,
        at: new Date().toISOString(),
      }));
      await resendFirstActiveSessionWidget(groupId, type, ctx.chat?.id || null);
      return replyEphemeral(ctx, TEXT.refreshed);
    }

    const name = ctx.message.text.split(' ').slice(1).join(' ').trim() || defaultName || DEFAULT_SESSION_NAMES[type] || 'جلسة';

    const master = await getMaster(groupId);
    const seriesId = await getCurrentSeries(groupId);
    const participants = initializeAttendance
      ? Object.fromEntries(master.members.map((m) => [
          m.name,
          { name: m.name, memberId: String(m.userId), status: null, called: null },
        ]))
      : {};

    const session = {
      type,
      name,
      startedAt: new Date().toISOString(),
      startedBy: ctx.from.id,
      seriesId,
      chatId:    ctx.chat.id,
      messageId: null,
      listMessageIds: [],
      active:    true,
      registrationActive: true,
      allowPublicRegistration: options.allowPublicRegistration ?? (type === 'open'),
      participants,
      activityByUserId: {},
    };

    const sent = await ctx.replyWithMarkdown(sessionText(session, master), sessionKb(true, true, session.allowPublicRegistration));
    session.messageId = sent.message_id;
    await saveSession(groupId, type, session);
    await refreshSessionWidget(telegram, session, master, async () => saveSession(groupId, type, session));
    try {
      await ctx.pinChatMessage(sent.message_id, { disable_notification: true });
    } catch (err) {
      logTelegramError('start.pinMainWidget', err, {
        groupId,
        sessionType: type,
        messageId: sent.message_id,
      });
    }
  }

  async function startlist(ctx) {
    return startSession(ctx, 'main', true);
  }

  async function starttraininglist(ctx) {
    const groupId = groupIdFromCtx(ctx);
    const trainingGroups = await getTrainingGroups(groupId);
    if (trainingGroups && trainingGroups.length > 0) {
      return replyEphemeral(ctx, 'هذا الأمر متاح في مجموعات التدريب فقط');
    }
    // Training lists use the dedicated `training` session type. It behaves like
    // `main` (registered members, present/listening statuses, counted in the
    // report) but diverges where needed: it allows public registration for
    // walk-ins and renders in registration order rather than alphabetically.
    // The list is pre-populated from the training group's assigned roster
    // (members are assigned from the main group via the member-management UI);
    // walk-ins are counted present but queued as pending students for teacher
    // approval, which then backfills them into the main group.
    return startSession(ctx, 'training', true, DEFAULT_SESSION_NAMES.training, { allowPublicRegistration: true });
  }

  async function startopenlist(ctx) {
    return startSession(ctx, 'open', false);
  }

  async function startsecondarylist(ctx) {
    return startSession(ctx, 'registeredSecondary', true);
  }

  async function startpersonalrecitation(ctx) {
    if (!await isAdmin(ctx)) return replyEphemeral(ctx, TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    if (await hasActiveSession(groupId)) {
      const activeSessions = await listActiveSessions(groupId);
      console.log(JSON.stringify({
        level: 'info',
        event: 'start_blocked_active_session',
        commandType: 'personalRecitation',
        groupId,
        chatId: ctx?.chat?.id ? String(ctx.chat.id) : null,
        userId: ctx?.from?.id ? String(ctx.from.id) : null,
        activeSessions,
        at: new Date().toISOString(),
      }));
      await resendFirstActiveSessionWidget(groupId, 'personalRecitation', ctx.chat?.id || null);
      return replyEphemeral(ctx, TEXT.refreshed);
    }

    const name = ctx.message.text.split(' ').slice(1).join(' ').trim() || DEFAULT_SESSION_NAMES.personalRecitation;

    const master = await getMaster(groupId);
    const seriesId = await getCurrentSeries(groupId);
    const session = {
      type: 'personalRecitation',
      name,
      startedAt: new Date().toISOString(),
      startedBy: ctx.from.id,
      seriesId,
      chatId: ctx.chat.id,
      messageId: null,
      listMessageIds: [],
      active: true,
      registrationActive: true,
      allowPublicRegistration: true,
      participants: {},
    };

    const sent = await ctx.replyWithMarkdown(sessionText(session, master), sessionKb(true, true, true));
    session.messageId = sent.message_id;
    await saveSession(groupId, 'personalRecitation', session);
    await refreshSessionWidget(telegram, session, master, async () => saveSession(groupId, 'personalRecitation', session));
    try {
      await ctx.pinChatMessage(sent.message_id, { disable_notification: true });
    } catch (err) {
      logTelegramError('start.pinPersonalRecitationWidget', err, {
        groupId,
        sessionType: 'personalRecitation',
        messageId: sent.message_id,
      });
    }
  }

  async function startgrouprecitation(ctx) {
    if (!await isAdmin(ctx)) return replyEphemeral(ctx, TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    if (await hasActiveSession(groupId)) {
      const activeSessions = await listActiveSessions(groupId);
      console.log(JSON.stringify({
        level: 'info',
        event: 'start_blocked_active_session',
        commandType: 'groupRecitation',
        groupId,
        chatId: ctx?.chat?.id ? String(ctx.chat.id) : null,
        userId: ctx?.from?.id ? String(ctx.from.id) : null,
        activeSessions,
        at: new Date().toISOString(),
      }));
      await resendFirstActiveSessionWidget(groupId, 'groupRecitation', ctx.chat?.id || null);
      return replyEphemeral(ctx, TEXT.refreshed);
    }

    const name = ctx.message.text.split(' ').slice(1).join(' ').trim() || DEFAULT_SESSION_NAMES.groupRecitation;

    const master = await getMaster(groupId);
    const nextPage = await getGroupRecitationNextPage(groupId);
    const seriesId = await getCurrentSeries(groupId);

    const session = {
      type: 'groupRecitation',
      name,
      startedAt: new Date().toISOString(),
      startedBy: ctx.from.id,
      seriesId,
      chatId: ctx.chat.id,
      messageId: null,
      listMessageIds: [],
      active: true,
      registrationActive: true,
      allowPublicRegistration: true,
      groupRecitation: true,
      groupRecitationStartPage: nextPage,
      participants: {},
    };

    const sent = await ctx.replyWithMarkdown(sessionText(session, master), sessionKb(true, true, true));
    session.messageId = sent.message_id;
    await saveSession(groupId, 'groupRecitation', session);
    // The allocator is a column, not blob data, so saveSession does not persist
    // the seed; set it explicitly for the freshly (re)started session.
    await setGroupRecitationPageCounter(groupId, 'groupRecitation', nextPage);
    await refreshSessionWidget(telegram, session, master, async () => saveSession(groupId, 'groupRecitation', session));
    try {
      await ctx.pinChatMessage(sent.message_id, { disable_notification: true });
    } catch (err) {
      logTelegramError('start.pinGroupRecitationWidget', err, {
        groupId,
        sessionType: 'groupRecitation',
        messageId: sent.message_id,
      });
    }
  }

  return { startlist, starttraininglist, startopenlist, startsecondarylist, startpersonalrecitation, startgrouprecitation };
}

export function register(bot, storage) {
  const h = createHandlers({ storage, telegram: bot.telegram });
  bot.command('startlist',           h.startlist);
  bot.command('starttraininglist',   h.starttraininglist);
  bot.command('startopenlist',       h.startopenlist);
  bot.command('startsecondarylist',  h.startsecondarylist);
  bot.command('startpersonalrecitation', h.startpersonalrecitation);
  bot.command('startgrouprecitation', h.startgrouprecitation);
}
