import { isAdmin } from '../../guards.js';
import { groupIdFromCtx, logTelegramError, replyChunked, replyEphemeral } from '../../helpers.js';
import { ACTIVE_SESSION_TYPES } from '../../sessionTypes.js';
import { TEXT } from '../../text.js';
import { refreshSessionWidget, rawSessionNames, sessionNames, manageText, manageKb } from '../../widgets.js';

export function register(bot, storage) {
  const {
    getMaster, getSession, getActiveSession, saveSession, clearSession, archiveSession,
    getPageProgress, savePageProgress,
    getGroupRecitationNextPage, saveGroupRecitationNextPage,
  } = storage;

  // Helper to find which session type is active
  async function getActiveSessionType(groupId) {
    for (const type of ACTIVE_SESSION_TYPES) {
      const session = await getSession(groupId, type);
      if (session && session.active) return type;
    }
    return null;
  }

  async function getActiveSessionContext(groupId) {
    const active = await getActiveSession(groupId);
    if (active?.type && active?.session) return active;

    const activeType = await getActiveSessionType(groupId);
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

  bot.command('stopregistration', async (ctx) => {
    if (!await isAdmin(ctx)) return replyEphemeral(ctx, TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    const activeSessions = await getAllActiveSessionContexts(groupId);
    if (!activeSessions.length) return replyEphemeral(ctx, TEXT.noSessionActive);

    const hasOpenRegistration = activeSessions.some(({ session }) => session.registrationActive !== false);
    if (!hasOpenRegistration)
      return replyEphemeral(ctx, TEXT.registrationAlreadyStopped);

    const master = await getMaster(groupId);
    for (const { type, session } of activeSessions) {
      session.registrationActive = false;
      await saveSession(groupId, type, session);
      try {
        await refreshSessionWidget(bot.telegram, session, master, async () => saveSession(groupId, type, session));
      } catch (err) {
        console.warn(JSON.stringify({
          level: 'warn',
          event: 'stopregistration_refresh_failed',
          message: err?.message || String(err),
          groupId,
          sessionType: type,
          at: new Date().toISOString(),
        }));
      }
    }
    return replyEphemeral(ctx, TEXT.registrationStopped);
  });

  bot.command('stoplist', async (ctx) => {
    if (!await isAdmin(ctx)) return replyEphemeral(ctx, TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    const activeType = await getActiveSessionType(groupId);
    if (!activeType) return replyEphemeral(ctx, TEXT.noSessionActive);
    
    const session = await getSession(groupId, activeType);

    const master = await getMaster(groupId);

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

    try {
      await ctx.unpinChatMessage(session.messageId);
    } catch (err) {
      logTelegramError('stop.unpinSessionMessage', err, {
        groupId,
        sessionType: activeType,
        messageId: session.messageId,
      });
    }

    const trackedIds = Array.isArray(session.actionMessageIds) ? [...session.actionMessageIds] : [];
    if (Array.isArray(session.listMessageIds)) {
      for (const msgId of session.listMessageIds) {
        if (msgId && !trackedIds.includes(msgId)) trackedIds.push(msgId);
      }
    }
    if (session.messageId && !trackedIds.includes(session.messageId)) trackedIds.push(session.messageId);

    try {
      for (const msgId of trackedIds) {
        if (!session.chatId || !msgId) continue;
        try {
          await ctx.telegram.deleteMessage(session.chatId, msgId);
        } catch (err) {
          logTelegramError('stop.deleteTrackedMessage', err, {
            groupId,
            sessionType: activeType,
            messageId: msgId,
            chatId: String(session.chatId),
          });
        }
      }
    } catch (err) {
      console.warn(JSON.stringify({
        level: 'warn',
        event: 'stoplist_cleanup_loop_failed',
        message: err?.message || String(err),
        groupId,
        sessionType: activeType,
        at: new Date().toISOString(),
      }));
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
    for (const n of sessionNames(session, master)) {
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

    await replyChunked(ctx, TEXT.checkpointSummary(session, sessionNames(session, master)), { parse_mode: 'Markdown' });
    await ctx.replyWithMarkdown(TEXT.sessionClosingDua);
  });

  bot.command('editlist', async (ctx) => {
    if (!await isAdmin(ctx)) return replyEphemeral(ctx, TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    const activeType = await getActiveSessionType(groupId);
    if (!activeType) return replyEphemeral(ctx, TEXT.noSessionActive);
    
    const session = await getSession(groupId, activeType);
    const master = await getMaster(groupId);
    const sent = await ctx.replyWithMarkdown(manageText(session, master), manageKb(session, master));
    if (session && sent?.message_id) {
      if (!Array.isArray(session.actionMessageIds)) session.actionMessageIds = [];
      if (!session.actionMessageIds.includes(sent.message_id)) {
        session.actionMessageIds.push(sent.message_id);
        await saveSession(groupId, activeType, session);
      }
    }
  });
}
