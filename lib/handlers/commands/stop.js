import { isAdmin } from '../../guards.js';
import { groupIdFromCtx, logTelegramError, replyChunked, replyEphemeral } from '../../helpers.js';
import { ACTIVE_SESSION_TYPES, getActiveSessionType } from '../../sessionTypes.js';
import { syncSessionNamesFromMaster } from '../../sessionSync.js';
import { TEXT } from '../../text.js';
import { refreshSessionWidget, rawSessionNames, editSessionPickerText, editSessionPickerKb } from '../../widgets.js';

/**
 * Send the standard stoplist-style report for a closed session.
 * Can be called from /stoplist directly or from /lastreport for reprint.
 */
export async function sendSessionReport(ctx, session, master) {
  const groups = { present: [], listening: [], excused: [], absent: [] };
  for (const n of rawSessionNames(session, master)) {
    const k = session.attendance[n] || 'absent';
    (groups[k] || groups.absent).push(n);
  }

  if (session.type === 'personalRecitation') {
    await replyChunked(ctx, TEXT.pageListReport(session), { parse_mode: 'Markdown' });
  } else if (session.type === 'groupRecitation') {
    await replyChunked(ctx, TEXT.groupRecitationReport(session), { parse_mode: 'Markdown' });
  } else if (session.type === 'registeredSecondary') {
    await replyChunked(ctx, TEXT.secondaryReport(session), { parse_mode: 'Markdown' });
  } else {
    await replyChunked(ctx, TEXT.report(session, groups), { parse_mode: 'Markdown' });
  }

  if (session.type === 'main' && Array.isArray(session.checkpoints) && session.checkpoints.length > 0) {
    await replyChunked(ctx, TEXT.checkpointSummary(session, rawSessionNames(session, master)), { parse_mode: 'Markdown' });
  }
}

export function register(bot, storage) {
  const {
    getMaster, getSession, getActiveSession, saveSession, clearSession, archiveSession,
    getPageProgress, savePageProgress,
    getGroupRecitationNextPage, saveGroupRecitationNextPage,
  } = storage;

  async function getActiveSessionContext(groupId) {
    const active = await getActiveSession(groupId);
    if (active?.type && active?.session) return active;

    const activeType = await getActiveSessionType(getSession, groupId);
    if (!activeType) return null;
    const session = await getSession(groupId, activeType);
    if (!session) return null;
    return { type: activeType, session };
  }

  async function getAllActiveSessionContexts(groupId) {
    const active = [];
    for (const type of ACTIVE_SESSION_TYPES) {
      const session = await getSession(groupId, type);
      if (session?.active) active.push({ type, session });
    }
    return active;
  }

  const freezeList = async (ctx) => {
    console.log(JSON.stringify({
      level: 'info',
      event: 'freezelist_entered',
      chatId: ctx?.chat?.id ? String(ctx.chat.id) : null,
      userId: ctx?.from?.id ? String(ctx.from.id) : null,
      at: new Date().toISOString(),
    }));
    const groupId = groupIdFromCtx(ctx);
    const admin = await isAdmin(ctx);
    console.log(JSON.stringify({
      level: 'info',
      event: 'freezelist_invoked',
      groupId,
      chatId: ctx?.chat?.id ? String(ctx.chat.id) : null,
      userId: ctx?.from?.id ? String(ctx.from.id) : null,
      isAdmin: admin,
      at: new Date().toISOString(),
    }));
    if (!admin) {
      console.log(JSON.stringify({
        level: 'info',
        event: 'freezelist_rejected_non_admin',
        groupId,
        chatId: ctx?.chat?.id ? String(ctx.chat.id) : null,
        userId: ctx?.from?.id ? String(ctx.from.id) : null,
        at: new Date().toISOString(),
      }));
      return replyEphemeral(ctx, TEXT.adminOnly);
    }
    const activeSessions = await getAllActiveSessionContexts(groupId);
    console.log(JSON.stringify({
      level: 'info',
      event: 'freezelist_requested',
      groupId,
      chatId: ctx?.chat?.id ? String(ctx.chat.id) : null,
      userId: ctx?.from?.id ? String(ctx.from.id) : null,
      activeSessionCount: activeSessions.length,
      sessions: activeSessions.map(({ type, session }) => ({
        type,
        active: Boolean(session?.active),
        registrationActive: session?.registrationActive,
        messageId: session?.messageId || null,
      })),
      at: new Date().toISOString(),
    }));
    if (!activeSessions.length) return replyEphemeral(ctx, TEXT.noSessionActive);

    const hasOpenRegistration = activeSessions.some(({ session }) => session.registrationActive !== false);
    if (!hasOpenRegistration)
      return replyEphemeral(ctx, TEXT.registrationAlreadyStopped);

    const master = await getMaster(groupId);
    for (const { type, session } of activeSessions) {
      session.registrationActive = false;
      await saveSession(groupId, type, session);
      const persisted = await getSession(groupId, type);
      console.log(JSON.stringify({
        level: 'info',
        event: 'freezelist_session_updated',
        groupId,
        sessionType: type,
        registrationActiveInMemory: session?.registrationActive,
        registrationActivePersisted: persisted?.registrationActive,
        persistedActive: Boolean(persisted?.active),
        persistedMessageId: persisted?.messageId || null,
        at: new Date().toISOString(),
      }));
      try {
        await refreshSessionWidget(bot.telegram, session, master, async () => saveSession(groupId, type, session));
      } catch (err) {
        console.warn(JSON.stringify({
          level: 'warn',
          event: 'freezelist_refresh_failed',
          message: err?.message || String(err),
          groupId,
          sessionType: type,
          at: new Date().toISOString(),
        }));
      }
    }
    console.log(JSON.stringify({
      level: 'info',
      event: 'freezelist_completed',
      groupId,
      frozenSessions: activeSessions.map(({ type }) => type),
      at: new Date().toISOString(),
    }));
    return replyEphemeral(ctx, TEXT.registrationStopped);
  };

  bot.command('freezelist', freezeList);
  bot.hears(/^\/freezelist(?:@[A-Za-z0-9_]+)?(?:\s|$)/i, async (ctx) => {
    console.log(JSON.stringify({
      level: 'info',
      event: 'freezelist_fallback_match',
      rawText: String(ctx?.message?.text || ''),
      chatId: ctx?.chat?.id ? String(ctx.chat.id) : null,
      userId: ctx?.from?.id ? String(ctx.from.id) : null,
      at: new Date().toISOString(),
    }));
    return freezeList(ctx);
  });

  console.log(JSON.stringify({
    level: 'info',
    event: 'stop_commands_registered',
    commands: ['freezelist', 'stoplist', 'editlist'],
    at: new Date().toISOString(),
  }));

  bot.command('stoplist', async (ctx) => {
    if (!await isAdmin(ctx)) return replyEphemeral(ctx, TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    const activeSessions = await getAllActiveSessionContexts(groupId);
    if (!activeSessions.length) return replyEphemeral(ctx, TEXT.noSessionActive);

    console.log(JSON.stringify({
      level: 'info',
      event: 'stoplist_requested',
      groupId,
      chatId: ctx?.chat?.id ? String(ctx.chat.id) : null,
      userId: ctx?.from?.id ? String(ctx.from.id) : null,
      activeSessionCount: activeSessions.length,
      sessions: activeSessions.map(({ type, session }) => ({
        type,
        active: Boolean(session?.active),
        registrationActive: session?.registrationActive,
        messageId: session?.messageId || null,
      })),
      at: new Date().toISOString(),
    }));

    const master = await getMaster(groupId);
    const closedTypes = [];
    const failedTypes = [];

    for (const { type: activeType, session } of activeSessions) {
      try {
        console.log(JSON.stringify({
          level: 'info',
          event: 'stoplist_closing_session',
          groupId,
          sessionType: activeType,
          messageId: session?.messageId || null,
          at: new Date().toISOString(),
        }));

        const confirmedByCheckpoint = new Set(
          (Array.isArray(session.checkpoints) ? session.checkpoints : []).flatMap((checkpoint) =>
            Object.keys(checkpoint?.confirmations || {})
          )
        );

        const absentBase = rawSessionNames(session, master);
        for (const name of absentBase) {
          if (!session.attendance[name]) {
            session.attendance[name] = confirmedByCheckpoint.has(name) ? 'present' : 'absent';
          }
        }
        session.active  = false;
        session.endedAt = new Date().toISOString();
        session.endedBy = ctx.from.id;

        // Ensure rename migrations are reflected before composing stop reports/archive.
        syncSessionNamesFromMaster(session, master);

        try {
          await ctx.unpinChatMessage(session.messageId);
        } catch (err) {
          logTelegramError('stop.unpinSessionMessage', err, {
            groupId,
            sessionType: activeType,
            messageId: session.messageId,
          });
        }


        await archiveSession(groupId, activeType, session);
        await clearSession(groupId, activeType);

        // Save page progress — only for members who were actually called
        if ((session.type === 'personalRecitation' || session.type === 'groupRecitation') && session.pages) {
          const progress = await getPageProgress(groupId);
          for (const [name, page] of Object.entries(session.pages)) {
            const hasCallStatus = session.called && session.called[name];
            if (hasCallStatus && page && Number.isInteger(page)) progress[name] = page;
          }
          await savePageProgress(groupId, progress);
        }

        // Save next page for group recitation (only count students who were called)
        if (session.type === 'groupRecitation' && session.pages) {
          let maxPage = 0;
          for (const [name, page] of Object.entries(session.pages)) {
            const hasCallStatus = session.called && session.called[name];
            if (hasCallStatus && Number.isInteger(page) && page > maxPage) maxPage = page;
          }
          await saveGroupRecitationNextPage(groupId, maxPage > 0 ? maxPage + 1 : 1);
        }

        const groups = { present: [], listening: [], excused: [], absent: [] };
        for (const n of rawSessionNames(session, master)) {
          const k = session.attendance[n] || 'absent';
          (groups[k] || groups.absent).push(n);
        }

        await sendSessionReport(ctx, session, master);
        await ctx.replyWithMarkdown(TEXT.sessionClosingDua);
        closedTypes.push(activeType);
      } catch (err) {
        failedTypes.push(activeType);
        console.error(JSON.stringify({
          level: 'error',
          event: 'stoplist_close_session_failed',
          message: err?.message || String(err),
          groupId,
          sessionType: activeType,
          at: new Date().toISOString(),
        }));
      }
    }

    console.log(JSON.stringify({
      level: 'info',
      event: 'stoplist_completed',
      groupId,
      closedTypes,
      failedTypes,
      at: new Date().toISOString(),
    }));
  });

  bot.command('editlist', async (ctx) => {
    if (!await isAdmin(ctx)) return replyEphemeral(ctx, TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    const activeSessions = await getAllActiveSessionContexts(groupId);
    if (!activeSessions.length) return replyEphemeral(ctx, TEXT.noSessionActive);

    const sent = await ctx.replyWithMarkdown(
      editSessionPickerText(activeSessions),
      editSessionPickerKb(activeSessions)
    );

    for (const { type, session } of activeSessions) {
      if (session && sent?.message_id) {
        if (!Array.isArray(session.actionMessageIds)) session.actionMessageIds = [];
        if (!session.actionMessageIds.includes(sent.message_id)) {
          session.actionMessageIds.push(sent.message_id);
          await saveSession(groupId, type, session);
        }
      }
    }
  });
}
