import { isAdmin, isAdminOf } from '../../guards.js';
import { groupIdFromCtx, sortArabic, beginForceReplyAwaiting, getDisplayName, escapeTelegramMarkdown, replyEphemeral, logTelegramError } from '../../helpers.js';
import { TEXT } from '../../text.js';
import { memberOptionsKb, membersText, membersKb, refreshSessionWidget as defaultRefreshSessionWidget, dismissKb, membersPageOfIndex } from '../../widgets.js';
import { syncPendingNudge } from '../../pendingNudge.js';
import * as participants from '../../sessionParticipants.js';

const PENDING_PAGE_SIZE = 5;

// Shared pending-registrations panel renderers. Exported so the /pendingstudents
// command and the force-reply re-render path use the exact same gid-encoded
// callback_data — the panel is DM-delivered and every button carries groupId.
export function pendingStudentsText(rows, page = 0, tz = 'Africa/Cairo') {
  const totalPages = Math.max(1, Math.ceil(rows.length / PENDING_PAGE_SIZE));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const start = safePage * PENDING_PAGE_SIZE;
  const slice = rows.slice(start, start + PENDING_PAGE_SIZE);
  if (!rows.length) return TEXT.pendingStudentsEmpty;

  const lines = slice.map((row, i) => {
    const submitted = row.submittedAt ? new Date(row.submittedAt).toLocaleDateString('ar-EG', { timeZone: tz }) : '—';
    const safeName = escapeTelegramMarkdown(row.name);
    const safeUsername = row.username ? escapeTelegramMarkdown(row.username) : null;
    return `${start + i + 1}. ${safeName}\n   ${row.userId}${safeUsername ? ` | @${safeUsername}` : ''}\n   📅 ${submitted}`;
  });

  return `${TEXT.pendingStudentsHeader(rows.length)}\n${TEXT.pendingPageHeader(safePage + 1, totalPages)}\n\n${lines.join('\n\n')}`;
}

export function pendingStudentsKb(groupId, rows, page = 0, confirmDismissUserId = null) {
  const totalPages = Math.max(1, Math.ceil(rows.length / PENDING_PAGE_SIZE));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const start = safePage * PENDING_PAGE_SIZE;
  const slice = rows.slice(start, start + PENDING_PAGE_SIZE);

  const kbRows = [];
  for (const row of slice) {
    if (String(row.userId) === String(confirmDismissUserId)) {
      kbRows.push([
        { text: TEXT.confirmDismissButton, callback_data: `pr:${groupId}:dismissconfirm:${row.userId}:${safePage}` },
        { text: TEXT.backButton, callback_data: `pr:${groupId}:dismisscancel:${safePage}` },
      ]);
      continue;
    }

    kbRows.push([
      { text: TEXT.addStudentButton(row.name), callback_data: `pr:${groupId}:add:${row.userId}:${safePage}` },
      { text: TEXT.addTeacherButton, callback_data: `pr:${groupId}:addteacher:${row.userId}:${safePage}` },
    ]);
    kbRows.push([
      { text: TEXT.dismissStudentButton, callback_data: `pr:${groupId}:dismiss:${row.userId}:${safePage}` },
    ]);
  }

  if (totalPages > 1) {
    kbRows.push([
      ...(safePage > 0 ? [{ text: TEXT.navigationPrevButton, callback_data: `pr:${groupId}:page:${safePage - 1}` }] : []),
      { text: `📄 ${safePage + 1}/${totalPages}`, callback_data: `pr:${groupId}:noop` },
      ...(safePage < totalPages - 1 ? [{ text: TEXT.navigationNextButton, callback_data: `pr:${groupId}:page:${safePage + 1}` }] : []),
    ]);
  }

  if (rows.length > 0) {
    kbRows.push([{ text: TEXT.tagPendingButton, callback_data: `pr:${groupId}:tagpending` }]);
  }
  kbRows.push([{ text: TEXT.closeButton, callback_data: 'msg:dismiss' }]);
  return { reply_markup: { inline_keyboard: kbRows } };
}

export function createHandlers({ storage, telegram, refreshSessionWidget = defaultRefreshSessionWidget }) {
  const { getMaster, saveMaster, getActiveSession, getSession, saveSession, setReplyPrompt, getPendingRegistrations, savePendingRegistrations, getTeachers, saveTeachers, getTrainingGroups, getParentGroupId, addMembers, getClassTimezone } = storage;
  const classTz = async (groupId) => {
    if (!getClassTimezone) return 'Africa/Cairo';
    try { return await getClassTimezone(groupId); } catch { return 'Africa/Cairo'; }
  };
  const DEFAULT_TEACHER_TYPE = 'recitationteacher';
  const teacherTypeLabel = TEXT.teacherTypeLabel;
  // Admin panels (mb:*, pr:*) are delivered to the admin's DM, so every callback
  // encodes the real groupId as ctx.match[1]. isAdmin(ctx) is false in private
  // chats, so gate on membership of the encoded group instead.
  const ensureAdmin = (ctx) => isAdminOf(telegram, ctx.match[1], ctx.from.id);

  async function resolveAssignedTrainingGroup(groupId, memberUserId) {
    const groups = await getTrainingGroups(groupId);
    for (const group of groups) {
      const trainingMaster = await getMaster(group.groupId);
      const members = Array.isArray(trainingMaster.members) ? trainingMaster.members : [];
      if (members.find((m) => String(m.userId) === String(memberUserId))) {
        return group;
      }
    }
    return null;
  }

  async function pick(ctx) {
    if (!await ensureAdmin(ctx))
      return ctx.answerCbQuery(TEXT.adminOnly);

    const groupId = ctx.match[1];
    const master = await getMaster(groupId);
    const sorted = sortArabic(master.members.map(m => m.name));
    const i      = parseInt(ctx.match[2], 10);
    const name   = sorted[i];
    if (!name) return ctx.answerCbQuery(TEXT.memberNotFound);

    const selected = master.members.find((m) => m.name === name);
    const assignedTraining = selected ? await resolveAssignedTrainingGroup(groupId, selected.userId) : null;

    await ctx.editMessageText(
      TEXT.memberOptionsHeader(name),
      {
        parse_mode: 'Markdown',
        ...memberOptionsKb(groupId, i, membersPageOfIndex(i), assignedTraining?.name || null),
      }
    );
    ctx.answerCbQuery();
  }

  async function deleteMember(ctx) {
    if (!await ensureAdmin(ctx))
      return ctx.answerCbQuery(TEXT.adminOnly);

    const groupId = ctx.match[1];
    const master = await getMaster(groupId);
    const sorted = sortArabic(master.members.map(m => m.name));
    const i      = parseInt(ctx.match[2], 10);
    const name   = sorted[i];
    if (!name) return ctx.answerCbQuery(TEXT.memberNotFound);

    master.members.splice(master.members.findIndex(m => m.name === name), 1);
    await saveMaster(groupId, master);

    const activeSession = await getActiveSession(groupId);
    if (activeSession?.session) {
      const { type, session } = activeSession;
      participants.remove(session, name);
      await saveSession(groupId, type, session);
      await refreshSessionWidget(telegram, session, master, async () => saveSession(groupId, type, session));
    }

    await ctx.editMessageText(membersText(master, membersPageOfIndex(i)), { parse_mode: 'Markdown', ...membersKb(groupId, master, membersPageOfIndex(i)) });
    ctx.answerCbQuery(TEXT.memberDeletedShort(name));
  }

  async function rename(ctx) {
    if (!await ensureAdmin(ctx))
      return ctx.answerCbQuery(TEXT.adminOnly);

    const groupId = ctx.match[1];
    const master = await getMaster(groupId);
    const sorted = sortArabic(master.members.map(m => m.name));
    const i      = parseInt(ctx.match[2], 10);
    const name   = sorted[i];
    if (!name) return ctx.answerCbQuery(TEXT.memberNotFound);

    return beginForceReplyAwaiting(ctx, {
      setReplyPrompt, groupId,
      record: { action: 'rename', oldName: name },
      sendPrompt: () => ctx.reply(TEXT.renamePrompt(name), {
        parse_mode: 'Markdown',
        reply_markup: { force_reply: true, input_field_placeholder: 'الاسم الجديد', selective: true },
      }),
    });
  }

  async function backPage(ctx) {
    if (!await ensureAdmin(ctx))
      return ctx.answerCbQuery(TEXT.adminOnly);
    const groupId = ctx.match[1];
    const master = await getMaster(groupId);
    const page = parseInt(ctx.match[2], 10);
    try {
      await ctx.editMessageText(membersText(master, Number.isInteger(page) ? page : 0), { parse_mode: 'Markdown', ...membersKb(groupId, master, Number.isInteger(page) ? page : 0) });
    } catch (e) {
      if (!String(e?.message || '').includes('message is not modified')) throw e;
    }
    ctx.answerCbQuery();
  }

  async function back(ctx) {
    if (!await ensureAdmin(ctx))
      return ctx.answerCbQuery(TEXT.adminOnly);
    const groupId = ctx.match[1];
    const master = await getMaster(groupId);
    try {
      await ctx.editMessageText(membersText(master), { parse_mode: 'Markdown', ...membersKb(groupId, master) });
    } catch (e) {
      if (!String(e?.message || '').includes('message is not modified')) throw e;
    }
    ctx.answerCbQuery();
  }

  async function page(ctx) {
    if (!await ensureAdmin(ctx))
      return ctx.answerCbQuery(TEXT.adminOnly);
    const groupId = ctx.match[1];
    const master = await getMaster(groupId);
    const page = parseInt(ctx.match[2], 10);
    try {
      await ctx.editMessageText(membersText(master, Number.isInteger(page) ? page : 0), { parse_mode: 'Markdown', ...membersKb(groupId, master, Number.isInteger(page) ? page : 0) });
    } catch (e) {
      if (!String(e?.message || '').includes('message is not modified')) throw e;
    }
    ctx.answerCbQuery();
  }

  async function noop(ctx) {
    await ctx.answerCbQuery();
  }

  async function sendConfirm(ctx) {
    if (!await ensureAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly);

    const groupId = ctx.match[1];
    const master = await getMaster(groupId);
    const idx = parseInt(ctx.match[2], 10);
    const sorted = sortArabic(master.members.map(m => m.name));
    const memberName = sorted[idx];
    
    if (!memberName) return ctx.answerCbQuery(TEXT.memberNotFound);

    const member = master.members.find(m => m.name === memberName);
    if (!member) return ctx.answerCbQuery(TEXT.memberNotFound);

    await telegram.sendMessage(
      groupId,
      `[${member.name}](tg://user/${member.userId})\n${TEXT.memberAdmittedConfirmation(member.name)}`,
      { parse_mode: 'Markdown' }
    );
    member.welcomedAt = new Date().toISOString();
    await saveMaster(groupId, master);
    return ctx.answerCbQuery(TEXT.confirmationSent);
  }

  async function pendingPage(ctx) {
    if (!await ensureAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly);
    const groupId = ctx.match[1];
    const pending = await getPendingRegistrations(groupId);
    const page = parseInt(ctx.match[2], 10);
    await ctx.editMessageText(
      pendingStudentsText(pending, Number.isInteger(page) ? page : 0, await classTz(groupId)),
      { parse_mode: 'Markdown', ...pendingStudentsKb(groupId, pending, Number.isInteger(page) ? page : 0) }
    );
    ctx.answerCbQuery();
  }

  async function pendingNoop(ctx) {
    await ctx.answerCbQuery();
  }

  async function tagPending(ctx) {
    if (!await ensureAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly);
    const groupId = ctx.match[1];
    const pending = await getPendingRegistrations(groupId);
    if (!pending.length) return ctx.answerCbQuery(TEXT.pendingStudentsEmpty);

    const mentions = pending
      .map((row) => `[${row.name}](tg://user/${row.userId})`)
      .join('\n');
    await telegram.sendMessage(
      groupId,
      TEXT.tagPendingNotice(mentions),
      { parse_mode: 'Markdown' }
    );
    await ctx.answerCbQuery();
  }

  async function join(ctx) {
    if (ctx.chat?.type !== 'group' && ctx.chat?.type !== 'supergroup') {
      return ctx.answerCbQuery(TEXT.registerInGroupOnly, { show_alert: true });
    }

    const groupId = groupIdFromCtx(ctx);
    const userId = String(ctx.from.id);
    const displayName = getDisplayName(ctx.from);

    const master = await getMaster(groupId);
    if (master.members.find((m) => String(m.userId) === userId)) {
      return ctx.answerCbQuery(TEXT.registerRequestAlreadyMember, { show_alert: true });
    }

    const pending = await getPendingRegistrations(groupId);
    const entry = {
      userId,
      name: displayName,
      username: ctx.from.username || null,
      submittedAt: new Date().toISOString(),
    };
    const idx = pending.findIndex((item) => String(item.userId) === userId);
    const updated = idx >= 0;
    if (updated) pending[idx] = entry;
    else pending.push(entry);

    await savePendingRegistrations(groupId, pending);
    // Keep the live-session group nudge in sync with the new request count.
    await syncPendingNudge({ telegram, storage, groupId });
    return ctx.answerCbQuery(updated ? TEXT.registerRequestUpdated : TEXT.registerRequestSubmitted, { show_alert: true });
  }

  // Group-side button on the pending nudge: deliver the full pending panel to
  // the tapping admin's DM (the panel prints requester ids, so it never goes to
  // the group). Falls back to a deep link if the bot can't DM the admin yet.
  async function openDm(ctx) {
    if (!await isAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly, { show_alert: true });
    const groupId = groupIdFromCtx(ctx);
    const pending = await getPendingRegistrations(groupId);
    try {
      await telegram.sendMessage(ctx.from.id, pendingStudentsText(pending, 0, await classTz(groupId)), {
        parse_mode: 'Markdown',
        ...pendingStudentsKb(groupId, pending),
      });
      return ctx.answerCbQuery(TEXT.panelSentToDm);
    } catch (err) {
      logTelegramError('pendingNudge.openDm', err, { chatId: String(groupId), userId: String(ctx.from.id) });
      let username = ctx.botInfo?.username;
      if (!username) {
        try { username = (await telegram.getMe())?.username; } catch { username = null; }
      }
      const link = username ? `https://t.me/${username}?start=pendingstudents` : null;
      await ctx.answerCbQuery();
      return replyEphemeral(ctx, TEXT.startBotInDmNudge(link));
    }
  }

  async function close(ctx) {
    if (!await isAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly, { show_alert: true });

    // Try to dismiss the widget message
    try {
      await ctx.deleteMessage();
    } catch (error) {
      console.error('Failed to delete pending students message:', error.message);
      try {
        await ctx.editMessageText(TEXT.registerWidgetClosed);
      } catch (editError) {
        console.error('Failed to edit pending students message:', editError.message);
      }
    }

    await ctx.answerCbQuery();
  }

  async function add(ctx) {
    if (!await ensureAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly);

    const groupId = ctx.match[1];
    const userId = String(ctx.match[2]);
    const page = parseInt(ctx.match[3], 10);
    console.log(`[pr:add] Attempting to add student ${userId} from pending list (page ${page})`);

    try {
      const pending = await getPendingRegistrations(groupId);
      const entry = pending.find((row) => String(row.userId) === userId);
      if (!entry) {
        console.warn(`[pr:add] Student ${userId} not found in pending registrations`);
        return ctx.answerCbQuery(TEXT.pendingStudentNotFound);
      }
      console.log(`[pr:add] Found student: ${userId}`);

      const master = await getMaster(groupId);
      if (master.members.find((m) => String(m.userId) === userId)) {
        console.log(`[pr:add] Student ${userId} already exists in members, removing from pending`);
        const nextPending = pending.filter((row) => String(row.userId) !== userId);
        await savePendingRegistrations(groupId, nextPending);
        await syncPendingNudge({ telegram, storage, groupId });
        await ctx.editMessageText(
          pendingStudentsText(nextPending, Number.isInteger(page) ? page : 0, await classTz(groupId)),
          { parse_mode: 'Markdown', ...pendingStudentsKb(groupId, nextPending, Number.isInteger(page) ? page : 0) }
        );
        return ctx.answerCbQuery(TEXT.userIdLinked(userId));
      }
      if (master.members.find((m) => m.name === entry.name)) {
        console.warn(`[pr:add] Name already taken by another member for userId ${userId}`);
        return ctx.answerCbQuery(TEXT.nameTaken(entry.name));
      }

      master.members.push({ userId, name: entry.name });
      await saveMaster(groupId, master);
      console.log(`[pr:add] Added userId ${userId} to master members list`);

      // If this is a training group linked to a main group, also add the
      // approved student to the main group's roster so they appear in reports.
      const parentGroupId = getParentGroupId ? await getParentGroupId(groupId) : null;
      if (parentGroupId && addMembers) {
        await addMembers(parentGroupId, [{ userId, name: entry.name }]);
      }

      const nextPending = pending.filter((row) => String(row.userId) !== userId);
      await savePendingRegistrations(groupId, nextPending);

      await ctx.editMessageText(
        pendingStudentsText(nextPending, Number.isInteger(page) ? page : 0, await classTz(groupId)),
        { parse_mode: 'Markdown', ...pendingStudentsKb(groupId, nextPending, Number.isInteger(page) ? page : 0) }
      );

      const sessionTypes = ['main', 'training', 'open', 'registeredSecondary', 'personalRecitation', 'groupRecitation'];
      for (const type of sessionTypes) {
        const session = await getSession(groupId, type);
        if (!session) continue;
        if (!participants.has(session, entry.name)) {
          participants.setStatus(session, entry.name, null);
          participants.setCalled(session, entry.name, null);
        } else {
          // She was a pending walk-in in this live session — approval clears the
          // ⏳ tag now that she is a roster member.
          participants.setPendingApproval(session, entry.name, false);
        }
        await saveSession(groupId, type, session);
        if (session.active) {
          await refreshSessionWidget(telegram, session, master, async () => saveSession(groupId, type, session));
        }
      }
      console.log(`[pr:add] Updated attendance/called in all session types`);

      // Sync after the session-refresh loop so the nudge message id we may store
      // on the active session isn't clobbered by the loop's own saveSession.
      await syncPendingNudge({ telegram, storage, groupId });

      return ctx.answerCbQuery(TEXT.memberAdded(entry.name, userId));
    } catch (error) {
      console.error(`[pr:add] Error adding student ${userId}:`, error);
      return ctx.answerCbQuery(TEXT.addMemberError, { show_alert: true });
    }
  }

  async function addTeacher(ctx) {
    if (!await ensureAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly);

    const groupId = ctx.match[1];
    const pending = await getPendingRegistrations(groupId);
    const userId = String(ctx.match[2]);
    const page = parseInt(ctx.match[3], 10);
    const entry = pending.find((row) => String(row.userId) === userId);
    if (!entry) return ctx.answerCbQuery(TEXT.pendingStudentNotFound);

    const teachers = await getTeachers(groupId);
    if (teachers.find((t) => String(t.userId) === userId)) {
      const nextPending = pending.filter((row) => String(row.userId) !== userId);
      await savePendingRegistrations(groupId, nextPending);
      await ctx.editMessageText(
        pendingStudentsText(nextPending, Number.isInteger(page) ? page : 0, await classTz(groupId)),
        { parse_mode: 'Markdown', ...pendingStudentsKb(groupId, nextPending, Number.isInteger(page) ? page : 0) }
      );
      return ctx.answerCbQuery(TEXT.teacherUserIdTaken(userId));
    }
    if (teachers.find((t) => t.name === entry.name)) {
      return ctx.answerCbQuery(TEXT.teacherNameTaken(entry.name));
    }

    teachers.push({ userId, name: entry.name, types: [DEFAULT_TEACHER_TYPE] });
    await saveTeachers(groupId, teachers);

    const nextPending = pending.filter((row) => String(row.userId) !== userId);
    await savePendingRegistrations(groupId, nextPending);
    await syncPendingNudge({ telegram, storage, groupId });

    await ctx.editMessageText(
      pendingStudentsText(nextPending, Number.isInteger(page) ? page : 0, await classTz(groupId)),
      { parse_mode: 'Markdown', ...pendingStudentsKb(groupId, nextPending, Number.isInteger(page) ? page : 0) }
    );
    return ctx.answerCbQuery(TEXT.pendingStudentAddedAsTeacher(entry.name, teacherTypeLabel[DEFAULT_TEACHER_TYPE]));
  }

  async function edit(ctx) {
    if (!await ensureAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly);

    const groupId = ctx.match[1];
    const pending = await getPendingRegistrations(groupId);
    const userId = String(ctx.match[2]);
    const page = parseInt(ctx.match[3], 10);
    const entry = pending.find((row) => String(row.userId) === userId);
    if (!entry) return ctx.answerCbQuery(TEXT.pendingStudentNotFound);

    return beginForceReplyAwaiting(ctx, {
      setReplyPrompt, groupId,
      record: {
        action: 'editPendingRegistration',
        pendingUserId: userId,
        pendingPage: Number.isInteger(page) ? page : 0,
        oldName: entry.name,
      },
      sendPrompt: () => ctx.reply(TEXT.pendingRegistrationRenamePrompt(entry.name), {
        parse_mode: 'Markdown',
        reply_markup: { force_reply: true, input_field_placeholder: 'الاسم الجديد', selective: true },
      }),
    });
  }

  async function dismiss(ctx) {
    if (!await ensureAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly);

    const groupId = ctx.match[1];
    const pending = await getPendingRegistrations(groupId);
    const userId = String(ctx.match[2]);
    const page = parseInt(ctx.match[3], 10);
    const entry = pending.find((row) => String(row.userId) === userId);
    if (!entry) return ctx.answerCbQuery(TEXT.pendingStudentNotFound);

    await ctx.editMessageText(
      pendingStudentsText(pending, Number.isInteger(page) ? page : 0, await classTz(groupId)),
      { parse_mode: 'Markdown', ...pendingStudentsKb(groupId, pending, Number.isInteger(page) ? page : 0, userId) }
    );
    return ctx.answerCbQuery(TEXT.pendingStudentDismissConfirm(entry.name));
  }

  async function dismissCancel(ctx) {
    if (!await ensureAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly);

    const groupId = ctx.match[1];
    const pending = await getPendingRegistrations(groupId);
    const page = parseInt(ctx.match[2], 10);
    await ctx.editMessageText(
      pendingStudentsText(pending, Number.isInteger(page) ? page : 0, await classTz(groupId)),
      { parse_mode: 'Markdown', ...pendingStudentsKb(groupId, pending, Number.isInteger(page) ? page : 0) }
    );
    return ctx.answerCbQuery();
  }

  async function dismissConfirm(ctx) {
    if (!await ensureAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly);

    const groupId = ctx.match[1];
    const pending = await getPendingRegistrations(groupId);
    const userId = String(ctx.match[2]);
    const page = parseInt(ctx.match[3], 10);
    const entry = pending.find((row) => String(row.userId) === userId);
    if (!entry) return ctx.answerCbQuery(TEXT.pendingStudentNotFound);

    const nextPending = pending.filter((row) => String(row.userId) !== userId);
    await savePendingRegistrations(groupId, nextPending);
    await syncPendingNudge({ telegram, storage, groupId });

    // A dismissed walk-in stays counted present in the live session but is no
    // longer awaiting approval — drop her ⏳ tag and refresh the list widget.
    const active = await getActiveSession(groupId);
    if (active?.session && participants.has(active.session, entry.name)
      && participants.get(active.session, entry.name)?.pendingApproval) {
      participants.setPendingApproval(active.session, entry.name, false);
      await saveSession(groupId, active.type, active.session);
      const master = await getMaster(groupId);
      await refreshSessionWidget(telegram, active.session, master, async () => saveSession(groupId, active.type, active.session));
    }

    await ctx.editMessageText(
      pendingStudentsText(nextPending, Number.isInteger(page) ? page : 0, await classTz(groupId)),
      { parse_mode: 'Markdown', ...pendingStudentsKb(groupId, nextPending, Number.isInteger(page) ? page : 0) }
    );
    return ctx.answerCbQuery(TEXT.pendingStudentDismissed(entry.name));
  }

  async function addMember(ctx) {
    if (!await ensureAdmin(ctx))
      return ctx.answerCbQuery(TEXT.adminOnly);

    const groupId = ctx.match[1];
    return beginForceReplyAwaiting(ctx, {
      setReplyPrompt, groupId,
      record: { action: 'add' },
      sendPrompt: () => ctx.replyWithMarkdown(TEXT.inlinePromptAdd, dismissKb()),
    });
  }

  async function sendConfirmations(ctx) {
    if (!await ensureAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly);

    const groupId = ctx.match[1];
    const master = await getMaster(groupId);
    const members = Array.isArray(master.members) ? master.members : [];

    if (!members.length) return ctx.answerCbQuery(TEXT.noMembersToConfirm);

    const toWelcome = members.filter((m) => !m.welcomedAt);
    if (!toWelcome.length) return ctx.answerCbQuery(TEXT.allMembersAlreadyConfirmed, { show_alert: true });

    const mentions = toWelcome
      .map((m) => `[${m.name}](tg://user/${m.userId})`)
      .join('\n');

    const confirmationMessage = `📢 ${mentions}\n\n${TEXT.batchConfirmationHeader}\n\n${TEXT.memberAdmittedConfirmationBatch}`;

    await telegram.sendMessage(groupId, confirmationMessage, { parse_mode: 'Markdown' });
    const now = new Date().toISOString();
    for (const m of toWelcome) m.welcomedAt = now;
    await saveMaster(groupId, master);
    return ctx.answerCbQuery(TEXT.batchConfirmationAlert(toWelcome.length), { show_alert: true });
  }

  return { pick, deleteMember, rename, backPage, back, page, noop, sendConfirm, pendingPage, pendingNoop, tagPending, join, openDm, close, add, addTeacher, edit, dismiss, dismissCancel, dismissConfirm, addMember, sendConfirmations };
}

export function register(bot, storage) {
  const h = createHandlers({ storage, telegram: bot.telegram });
  bot.action(/^mb:(-?\d+):pick:(\d+)$/, h.pick);
  bot.action(/^mb:(-?\d+):del:(\d+)$/, h.deleteMember);
  bot.action(/^mb:(-?\d+):ren:(\d+)$/, h.rename);
  bot.action(/^mb:(-?\d+):back:(\d+)$/, h.backPage);
  bot.action(/^mb:(-?\d+):back$/, h.back);
  bot.action(/^mb:(-?\d+):page:(\d+)$/, h.page);
  bot.action(/^mb:(-?\d+):noop$/, h.noop);
  bot.action(/^mb:(-?\d+):sendconfirm:(\d+):(\d+)$/, h.sendConfirm);
  bot.action(/^mb:(-?\d+):add$/, h.addMember);
  bot.action(/^mb:(-?\d+):sendconfirmations$/, h.sendConfirmations);
  bot.action(/^pr:(-?\d+):page:(\d+)$/, h.pendingPage);
  bot.action(/^pr:(-?\d+):noop$/, h.pendingNoop);
  bot.action(/^pr:(-?\d+):tagpending$/, h.tagPending);
  bot.action(/^pr:(-?\d+):add:(\d+):(\d+)$/, h.add);
  bot.action(/^pr:(-?\d+):addteacher:(\d+):(\d+)$/, h.addTeacher);
  bot.action(/^pr:(-?\d+):edit:(\d+):(\d+)$/, h.edit);
  bot.action(/^pr:(-?\d+):dismiss:(\d+):(\d+)$/, h.dismiss);
  bot.action(/^pr:(-?\d+):dismisscancel:(\d+)$/, h.dismissCancel);
  bot.action(/^pr:(-?\d+):dismissconfirm:(\d+):(\d+)$/, h.dismissConfirm);
  // Public self-registration widget (posted in the group by /register) stays
  // group-side: bare pr:join / pr:close, gated by group context, not DM.
  bot.action('pr:join', h.join);
  bot.action('pr:close', h.close);
  // Group-side nudge (posted while a session is active) opens the DM panel.
  bot.action('pr:opendm', h.openDm);
}
