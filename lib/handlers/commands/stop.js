import { isAdmin } from '../../guards.js';
import { groupIdFromCtx, logTelegramError, replyChunked, replyEphemeral } from '../../helpers.js';
import { ACTIVE_SESSION_TYPES, getActiveSessionType } from '../../sessionTypes.js';
import { syncSessionNamesFromMaster } from '../../sessionSync.js';
import { TEXT } from '../../text.js';
import { refreshSessionWidget, rawSessionNames, editSessionPickerText, editSessionPickerKb } from '../../widgets.js';
import * as participants from '../../sessionParticipants.js';

/**
 * Build a predicate that flags a walk-in guest still awaiting approval. A guest
 * matches a pending entry by her Telegram id while the session is live (memberId
 * present) or by name once archived (memberId is dropped on persist, but the
 * guest_name equals the pending name recorded at the same tap). Dismissed
 * walk-ins are hard-deleted from the queue, so they simply never match.
 */
function buildPendingMatcher(session, pending) {
  const uids = new Set();
  const names = new Set();
  for (const p of pending || []) {
    if (p?.userId != null) uids.add(String(p.userId));
    if (p?.name) names.add(String(p.name));
  }
  if (!uids.size && !names.size) return () => false;
  return (name) => {
    const rec = participants.get(session, name);
    if (rec?.memberId && uids.has(String(rec.memberId))) return true;
    return names.has(name);
  };
}

/**
 * Send the standard stoplist-style report for a closed session.
 * Can be called from /stoplist directly or from /lastreport for reprint.
 */
export async function sendSessionReport(ctx, session, master, pending = []) {
  const groups = { present: [], listening: [], excused: [], absent: [] };
  for (const n of rawSessionNames(session, master)) {
    const k = participants.getStatus(session, n) || 'absent';
    (groups[k] || groups.absent).push(n);
  }
  const opts = { isPending: buildPendingMatcher(session, pending) };

  if (session.type === 'personalRecitation') {
    await replyChunked(ctx, TEXT.pageListReport(session, opts), { parse_mode: 'Markdown' });
  } else if (session.type === 'groupRecitation') {
    await replyChunked(ctx, TEXT.groupRecitationReport(session, opts), { parse_mode: 'Markdown' });
  } else if (session.type === 'registeredSecondary') {
    await replyChunked(ctx, TEXT.secondaryReport(session, opts), { parse_mode: 'Markdown' });
  } else {
    await replyChunked(ctx, TEXT.report(session, groups, opts), { parse_mode: 'Markdown' });
  }
}

export function createHandlers({ storage, telegram }) {
  const {
    getMaster, getSession, getActiveSession, saveSession, archiveSession,
    getPageProgress, savePageProgress,
    getGroupRecitationNextPage, saveGroupRecitationNextPage,
    getPendingRegistrations,
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
        await refreshSessionWidget(telegram, session, master, async () => saveSession(groupId, type, session));
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

  async function freezelistFallback(ctx) {
    console.log(JSON.stringify({
      level: 'info',
      event: 'freezelist_fallback_match',
      rawText: String(ctx?.message?.text || ''),
      chatId: ctx?.chat?.id ? String(ctx.chat.id) : null,
      userId: ctx?.from?.id ? String(ctx.from.id) : null,
      at: new Date().toISOString(),
    }));
    return freezeList(ctx);
  }

  // Widget "stop list" button: same effect as /freezelist. Clear the button
  // spinner first, then run the shared freeze flow (which posts its own notice).
  async function freezelistFromWidget(ctx) {
    if (!await isAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly);
    await ctx.answerCbQuery();
    return freezeList(ctx);
  }

  console.log(JSON.stringify({
    level: 'info',
    event: 'stop_commands_registered',
    commands: ['freezelist', 'stoplist', 'editlist'],
    at: new Date().toISOString(),
  }));

  async function stoplist(ctx) {
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

        const absentBase = rawSessionNames(session, master);
        for (const name of absentBase) {
          if (!participants.getStatus(session, name)) {
            participants.setStatus(session, name, 'absent');
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

        // Save page progress — only for members who were actually called
        if (session.type === 'personalRecitation' || session.type === 'groupRecitation') {
          const progress = await getPageProgress(groupId);
          for (const p of participants.list(session)) {
            if (p.page === undefined) continue;
            if (p.called && p.page && Number.isInteger(p.page)) progress[p.name] = p.page;
          }
          await savePageProgress(groupId, progress);
        }

        // Save next page for group recitation (only count students who were called)
        if (session.type === 'groupRecitation') {
          let maxPage = 0;
          for (const p of participants.list(session)) {
            if (p.page === undefined) continue;
            if (p.called && Number.isInteger(p.page) && p.page > maxPage) maxPage = p.page;
          }
          await saveGroupRecitationNextPage(groupId, maxPage > 0 ? maxPage + 1 : 1);
        }

        const groups = { present: [], listening: [], excused: [], absent: [] };
        for (const n of rawSessionNames(session, master)) {
          const k = participants.getStatus(session, n) || 'absent';
          (groups[k] || groups.absent).push(n);
        }

        const pendingRegs = getPendingRegistrations ? await getPendingRegistrations(groupId) : [];
        await sendSessionReport(ctx, session, master, pendingRegs);
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
  }

  async function stoplistFromWidget(ctx) {
    if (!await isAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly);
    await ctx.answerCbQuery();

    const groupId = groupIdFromCtx(ctx);
    const clickedId = ctx.callbackQuery?.message?.message_id || null;
    // Capture the tapped widget's overflow list messages before stoplist clears
    // the session, so we can delete the whole widget (not just the main message).
    const contexts = await getAllActiveSessionContexts(groupId);
    const owner = contexts.find(({ session }) => clickedId && Number(session?.messageId) === Number(clickedId));
    const overflow = Array.isArray(owner?.session?.listMessageIds) ? [...owner.session.listMessageIds] : [];

    // End the session(s) and post the attendance report.
    await stoplist(ctx);

    for (const msgId of overflow) {
      try {
        await telegram.deleteMessage(ctx.chat.id, msgId);
      } catch (err) {
        logTelegramError('stop.stoplistFromWidget.deleteListMessage', err, {
          chatId: String(ctx.chat?.id || ''),
          messageId: msgId,
        });
      }
    }
    try {
      await ctx.deleteMessage();
    } catch (err) {
      logTelegramError('stop.stoplistFromWidget.deleteWidget', err, {
        chatId: String(ctx.chat?.id || ''),
      });
    }
  }

  async function editlist(ctx) {
    // Confirm via a lightweight toast when triggered from the widget button so we
    // don't clutter the group with a message; commands have no callback query to
    // answer, so they fall back to an ephemeral reply.
    const notify = (text) => (ctx.callbackQuery ? ctx.answerCbQuery(text) : replyEphemeral(ctx, text));
    if (!await isAdmin(ctx)) return notify(TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    const activeSessions = await getAllActiveSessionContexts(groupId);
    if (!activeSessions.length) return notify(TEXT.noSessionActive);

    // The edit panel is an admin control surface — deliver it privately so taps
    // can't hit the wrong member in the busy group. Buttons carry the group id,
    // so every edit still applies to this session.
    try {
      await telegram.sendMessage(ctx.from.id, editSessionPickerText(activeSessions), {
        parse_mode: 'Markdown',
        ...editSessionPickerKb(activeSessions),
      });
      await notify(TEXT.panelSentToDm);
    } catch (err) {
      // Clear the button spinner; the nudge below carries a clickable deep link
      // that a toast can't render, so it stays an ephemeral message.
      if (ctx.callbackQuery) { try { await ctx.answerCbQuery(); } catch { /* already answered */ } }
      let username = ctx.botInfo?.username;
      if (!username) {
        try { username = (await telegram.getMe())?.username; } catch { username = null; }
      }
      const link = username ? `https://t.me/${username}?start=editlist` : null;
      await replyEphemeral(ctx, TEXT.startBotInDmNudge(link));
      logTelegramError('stop.editlist.dmSend', err, { chatId: String(groupId) });
    }
  }

  async function editlistFromWidget(ctx) {
    if (!await isAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly);
    // Let editlist answer the callback query (as a toast) so the confirmation
    // isn't posted as a group message.
    return editlist(ctx);
  }

  return { freezeList, freezelistFallback, freezelistFromWidget, stoplist, stoplistFromWidget, editlist, editlistFromWidget };
}

export function register(bot, storage) {
  const h = createHandlers({ storage, telegram: bot.telegram });
  bot.command('freezelist', h.freezeList);
  bot.hears(/^\/freezelist(?:@[A-Za-z0-9_]+)?(?:\s|$)/i, h.freezelistFallback);
  bot.action('a:freeze', h.freezelistFromWidget);
  bot.command('stoplist', h.stoplist);
  bot.action('a:stop', h.stoplistFromWidget);
  bot.command('editlist', h.editlist);
  bot.action('a:edit', h.editlistFromWidget);
}
