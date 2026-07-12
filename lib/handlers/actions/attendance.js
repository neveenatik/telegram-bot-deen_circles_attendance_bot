import { isAdmin } from '../../guards.js';
import { groupIdFromCtx, logTelegramError } from '../../helpers.js';
import { syncSessionNamesFromMaster as defaultSyncSessionNamesFromMaster } from '../../sessionSync.js';
import { requiresRegistrationApproval } from '../../sessionTypes.js';
import { TEXT, st } from '../../text.js';
import { refreshSessionWidget as defaultRefreshSessionWidget } from '../../widgets.js';
import * as participants from '../../sessionParticipants.js';

/**
 * Build the attendance action handlers.
 *
 * Handlers are returned as plain named functions of `(ctx)` so they can be unit
 * tested with a mock ctx + mock deps, without a live Telegraf bot. Use
 * `register(bot, storage)` to wire them to the bot at startup.
 *
 * @param {object} deps
 * @param {object} deps.storage  Storage facade (getMaster, saveSession, ...).
 * @param {object} deps.telegram Telegram client (i.e. bot.telegram).
 * @param {Function} [deps.refreshSessionWidget] Injectable widget refresher (tests override).
 * @param {Function} [deps.syncSessionNamesFromMaster] Injectable name sync (tests override).
 */
export function createHandlers({
  storage,
  telegram,
  refreshSessionWidget = defaultRefreshSessionWidget,
  syncSessionNamesFromMaster = defaultSyncSessionNamesFromMaster,
}) {
  const { getMaster, saveMaster, getActiveSession, saveSession, saveParticipant, getPageProgress, getPendingRegistrations, savePendingRegistrations } = storage;

  async function refresh(ctx) {
    if (!await isAdmin(ctx)) {
      return ctx.answerCbQuery(TEXT.adminOnly);
    }

    const groupId = groupIdFromCtx(ctx);
    const activeSession = await getActiveSession(groupId);
    const activeType = activeSession?.type || null;
    const session = activeSession?.session || null;
    if (!activeType || !session) return ctx.answerCbQuery(TEXT.noSessionActive);

    const master = await getMaster(groupId);
    const sync = syncSessionNamesFromMaster(session, master);
    if (sync.changed) {
      await saveSession(groupId, activeType, session);
    }
    console.log(JSON.stringify({
      level: 'info',
      event: 'attendance_refresh_synced',
      groupId,
      sessionType: activeType,
      syncChanged: Boolean(sync.changed),
      syncKept: Number.isInteger(sync.kept) ? sync.kept : 0,
      syncAdded: Number.isInteger(sync.added) ? sync.added : 0,
      syncRemoved: Number.isInteger(sync.removed) ? sync.removed : 0,
      at: new Date().toISOString(),
    }));
    await refreshSessionWidget(telegram, session, master, async () => saveSession(groupId, activeType, session));
    return ctx.answerCbQuery(TEXT.refreshed);
  }

  async function mark(ctx) {
    const groupId = groupIdFromCtx(ctx);
    const clickedMessageId = ctx?.callbackQuery?.message?.message_id || null;
    const action = ctx.match[1];
    const activeSession = await getActiveSession(groupId);
    const activeType = activeSession?.type || null;
    const session = activeSession?.session || null;
    console.log(JSON.stringify({
      level: 'info',
      event: 'attendance_action_received',
      groupId,
      activeType: activeType || null,
      action,
      clickedMessageId,
      chatId: ctx?.chat?.id ? String(ctx.chat.id) : null,
      userId: ctx?.from?.id ? String(ctx.from.id) : null,
      at: new Date().toISOString(),
    }));
    if (!activeType || !session) return ctx.answerCbQuery(TEXT.noSessionActive);

    console.log(JSON.stringify({
      level: 'info',
      event: 'attendance_session_selected',
      groupId,
      sessionType: activeType,
      sessionActive: Boolean(session?.active),
      registrationActive: session?.registrationActive,
      allowPublicRegistration: Boolean(session?.allowPublicRegistration),
      sessionMessageId: session?.messageId || null,
      clickedMessageId,
      messageMatch: Boolean(session?.messageId && clickedMessageId && Number(session.messageId) === Number(clickedMessageId)),
      at: new Date().toISOString(),
    }));
    if (!session?.active)
      return ctx.answerCbQuery(TEXT.noSessionActive);
    if (session.registrationActive === false) {
      console.log(JSON.stringify({
        level: 'info',
        event: 'attendance_blocked_registration_closed',
        groupId,
        sessionType: activeType,
        clickedMessageId,
        sessionMessageId: session?.messageId || null,
        at: new Date().toISOString(),
      }));
      ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch((err) => {
        logTelegramError('attendance.clearClosedRegistrationKeyboard', err, {
          groupId,
          sessionType: activeType,
        });
      });
      return ctx.answerCbQuery(TEXT.registrationClosedAlert);
    }

    const master = await getMaster(groupId);
    const uid    = String(ctx.from.id);
    const member = master.members.find(m => m.userId === uid);
    const status = ctx.match[1];

    if (!member) {
      const name = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ')
        || ctx.from.username || TEXT.noNameFallback;
      // Roster-based lists (main, registeredSecondary, training) do NOT add
      // walk-ins to the roster directly — an accidental tap shouldn't pollute
      // the members list. Instead, queue them as a pending registration for
      // admin approval; approving adds them to this group's roster (and, for
      // training lists, backfills them into the linked main group). They are
      // still counted present in this live session below.
      //
      // Transient lists (open, personalRecitation, groupRecitation) do not gate
      // membership, so their walk-ins are added to the roster on the spot.
      if (requiresRegistrationApproval(session.type)) {
        const pending = getPendingRegistrations ? await getPendingRegistrations(groupId) : [];
        if (!pending.find((p) => String(p.userId) === uid)) {
          pending.push({ userId: uid, name, username: ctx.from.username || null, submittedAt: new Date().toISOString() });
          if (savePendingRegistrations) await savePendingRegistrations(groupId, pending);
        }
      } else {
        master.members.push({ userId: uid, name });
        await saveMaster(groupId, master);
      }
      participants.register(session, name, { status, memberId: uid, registeredAt: Date.now() });

      if (session.type === 'personalRecitation') {
        if (status === 'present') {
          const progress = await getPageProgress(groupId);
          participants.setPage(session, name, (Number(progress[name]) || 0) + 1);
        }
        // listening/excused: no page assigned
      }

      if (session.type === 'groupRecitation' && status === 'present') {
        const page = await allocateGroupRecitationPage(groupId, activeType, session);
        participants.setPage(session, name, page);
        session.groupRecitationStartPage = page + 1;
      }

      await saveParticipant(groupId, activeType, session, name);
      console.log(JSON.stringify({
        level: 'info',
        event: 'attendance_saved_new_member',
        groupId,
        sessionType: activeType,
        action,
        memberName: name,
        userId: uid,
        at: new Date().toISOString(),
      }));
      await refreshSessionWidget(telegram, session, master, async () => saveSession(groupId, activeType, session));
      let toast;
      if (session.type === 'personalRecitation' && status === 'present') {
        toast = TEXT.pageAssigned(name, participants.getPage(session, name));
      } else if (session.type === 'groupRecitation' && status === 'present') {
        toast = TEXT.pageAssignedGroupRecitation(name, participants.getPage(session, name));
      } else {
        toast = TEXT.registeredSelf(st(status).a);
      }
      return ctx.answerCbQuery(toast, { show_alert: session.type === 'personalRecitation' && status === 'present' });
    }

    participants.setStatus(session, member.name, status);
    participants.setMemberId(session, member.name, member.userId);
    participants.ensureRegisteredAt(session, member.name);

    if (session.type === 'personalRecitation') {
      if (status === 'present') {
        const existingPage = participants.getPage(session, member.name);
        if (existingPage !== undefined && existingPage !== null) {
          await saveParticipant(groupId, activeType, session, member.name);
          await refreshSessionWidget(telegram, session, master, async () => saveSession(groupId, activeType, session));
          return ctx.answerCbQuery(TEXT.alreadyHasPage(existingPage));
        }
        const progress = await getPageProgress(groupId);
        participants.setPage(session, member.name, (Number(progress[member.name]) || 0) + 1);
      } else {
        // listening/excused: revert page assignment
        participants.clearPage(session, member.name);
      }
    }

    if (session.type === 'groupRecitation' && status === 'present') {
      const existingPage = participants.getPage(session, member.name);
      if (existingPage === undefined || existingPage === null) {
        const page = await allocateGroupRecitationPage(groupId, activeType, session);
        participants.setPage(session, member.name, page);
        session.groupRecitationStartPage = page + 1;
      }
    } else if (session.type === 'groupRecitation') {
      participants.clearPage(session, member.name);
    }

    await saveParticipant(groupId, activeType, session, member.name);
    console.log(JSON.stringify({
      level: 'info',
      event: 'attendance_saved_existing_member',
      groupId,
      sessionType: activeType,
      action,
      memberName: member.name,
      userId: uid,
      at: new Date().toISOString(),
    }));
    await refreshSessionWidget(telegram, session, master, async () => saveSession(groupId, activeType, session));
    let toast;
    if (session.type === 'personalRecitation' && status === 'present') {
      toast = TEXT.pageAssigned(member.name, participants.getPage(session, member.name));
    } else if (session.type === 'groupRecitation' && status === 'present') {
      const page = participants.getPage(session, member.name);
      toast = page
        ? TEXT.pageAssignedGroupRecitation(member.name, page)
        : TEXT.registeredAs(st(status).a);
    } else {
      toast = TEXT.registeredAs(st(status).a);
    }
    ctx.answerCbQuery(toast, { show_alert: session.type === 'personalRecitation' && status === 'present' });
  }

  // Recitation-correction (registeredSecondary) self-registration: the widget
  // shows the three-part attestation in its footer and a single confirm button.
  // Whoever taps it is registered present — the tap itself carries ctx.from, so
  // no prompt message or per-user callback encoding is needed, and it is robust
  // to production's per-tap webhook invocations (no in-memory state).
  async function recite(ctx, attendedMain = true, backup = false) {
    const groupId = groupIdFromCtx(ctx);
    const activeSession = await getActiveSession(groupId);
    const activeType = activeSession?.type || null;
    const session = activeSession?.session || null;
    if (!activeType || !session || session.type !== 'registeredSecondary' || !session.active) {
      return ctx.answerCbQuery(TEXT.noSessionActive);
    }
    // Primary registration is gated when frozen, but reserve (backup) sign-ups are
    // explicitly allowed on a frozen list — that is the whole point of the button.
    if (!backup && session.registrationActive === false) {
      return ctx.answerCbQuery(TEXT.registrationClosedAlert);
    }

    const master = await getMaster(groupId);
    const uid = String(ctx.from.id);
    const member = master.members.find((m) => m.userId === uid);
    const status = 'present';
    const name = member
      ? member.name
      : ([ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ')
        || ctx.from.username || TEXT.noNameFallback);
    // A reserve (backup) tap must never demote someone already on the primary
    // list — the guaranteed slot from registering while open outranks the reserve.
    if (backup && participants.has(session, name) && participants.getBackup(session, name) !== true) {
      return ctx.answerCbQuery(TEXT.reciteBackupAlreadyRegisteredAlert, { show_alert: true });
    }
    const successAlert = backup
      ? (attendedMain ? TEXT.reciteBackupAlert : TEXT.reciteBackupNoMainAlert)
      : (attendedMain ? TEXT.reciteAttestationAlert : TEXT.reciteAttestationNoMainAlert);

    if (!member) {
      // registeredSecondary requires admin approval, so queue the walk-in as a
      // pending registration (deduped by userId) while counting her present now.
      const pending = getPendingRegistrations ? await getPendingRegistrations(groupId) : [];
      if (!pending.find((p) => String(p.userId) === uid)) {
        pending.push({ userId: uid, name, username: ctx.from.username || null, submittedAt: new Date().toISOString() });
        if (savePendingRegistrations) await savePendingRegistrations(groupId, pending);
      }
      participants.register(session, name, { status, memberId: uid, registeredAt: Date.now(), attendedMain, backup });
      await saveParticipant(groupId, activeType, session, name);
      await refreshSessionWidget(telegram, session, master, async () => saveSession(groupId, activeType, session));
      return ctx.answerCbQuery(successAlert, { show_alert: true });
    }

    participants.setStatus(session, member.name, status);
    participants.setMemberId(session, member.name, member.userId);
    participants.ensureRegisteredAt(session, member.name);
    participants.setAttendedMain(session, member.name, attendedMain);
    participants.setBackup(session, member.name, backup);
    await saveParticipant(groupId, activeType, session, member.name);
    await refreshSessionWidget(telegram, session, master, async () => saveSession(groupId, activeType, session));
    return ctx.answerCbQuery(successAlert, { show_alert: true });
  }

  return { refresh, mark, recite };
}

export function register(bot, storage) {
  const handlers = createHandlers({ storage, telegram: bot.telegram });
  bot.action('a:refresh', handlers.refresh);
  bot.action(/^a:(present|listening|excused)$/, handlers.mark);
  bot.action('a:recite', (ctx) => handlers.recite(ctx, true, false));
  bot.action('a:recite:nomain', (ctx) => handlers.recite(ctx, false, false));
  bot.action('a:recite:backup', (ctx) => handlers.recite(ctx, true, true));
  bot.action('a:recite:backup:nomain', (ctx) => handlers.recite(ctx, false, true));
}
