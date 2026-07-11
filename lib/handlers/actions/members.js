import { isAdmin } from '../../guards.js';
import { groupIdFromCtx, sortArabic, ensureNoPendingAwaiting, getDisplayName, escapeTelegramMarkdown } from '../../helpers.js';
import { TEXT } from '../../text.js';
import { memberOptionsKb, membersText, membersKb, refreshSessionWidget as defaultRefreshSessionWidget, dismissKb, membersPageOfIndex } from '../../widgets.js';
import * as participants from '../../sessionParticipants.js';

export function createHandlers({ storage, telegram, refreshSessionWidget = defaultRefreshSessionWidget }) {
  const { getMaster, saveMaster, getActiveSession, getSession, saveSession, setAwaiting, getAwaiting, delAwaiting, getPendingRegistrations, savePendingRegistrations, getTeachers, saveTeachers, getTrainingGroups, getParentGroupId, addMembers } = storage;
  const PENDING_PAGE_SIZE = 5;
  const DEFAULT_TEACHER_TYPE = 'recitationteacher';
  const teacherTypeLabel = TEXT.teacherTypeLabel;

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

  function pendingStudentsText(rows, page = 0) {
    const totalPages = Math.max(1, Math.ceil(rows.length / PENDING_PAGE_SIZE));
    const safePage = Math.max(0, Math.min(page, totalPages - 1));
    const start = safePage * PENDING_PAGE_SIZE;
    const slice = rows.slice(start, start + PENDING_PAGE_SIZE);
    if (!rows.length) return TEXT.pendingStudentsEmpty;

    const lines = slice.map((row, i) => {
      const submitted = row.submittedAt ? new Date(row.submittedAt).toLocaleDateString('ar-EG', { timeZone: 'Africa/Cairo' }) : '—';
      const safeName = escapeTelegramMarkdown(row.name);
      const safeUsername = row.username ? escapeTelegramMarkdown(row.username) : null;
      return `${start + i + 1}. ${safeName}\n   ${row.userId}${safeUsername ? ` | @${safeUsername}` : ''}\n   📅 ${submitted}`;
    });

    return `${TEXT.pendingStudentsHeader(rows.length)}\n${TEXT.pendingPageHeader(safePage + 1, totalPages)}\n\n${lines.join('\n\n')}`;
  }

  function pendingStudentsKb(rows, page = 0, confirmDismissUserId = null) {
    const totalPages = Math.max(1, Math.ceil(rows.length / PENDING_PAGE_SIZE));
    const safePage = Math.max(0, Math.min(page, totalPages - 1));
    const start = safePage * PENDING_PAGE_SIZE;
    const slice = rows.slice(start, start + PENDING_PAGE_SIZE);

    const kbRows = [];
    for (const row of slice) {
      if (String(row.userId) === String(confirmDismissUserId)) {
        kbRows.push([
          { text: TEXT.confirmDismissButton, callback_data: `pr:dismissconfirm:${row.userId}:${safePage}` },
          { text: TEXT.backButton, callback_data: `pr:dismisscancel:${safePage}` },
        ]);
        continue;
      }

      kbRows.push([
        { text: TEXT.addStudentButton(row.name), callback_data: `pr:add:${row.userId}:${safePage}` },
        { text: TEXT.addTeacherButton, callback_data: `pr:addteacher:${row.userId}:${safePage}` },
      ]);
      kbRows.push([
        { text: TEXT.dismissStudentButton, callback_data: `pr:dismiss:${row.userId}:${safePage}` },
      ]);
    }

    if (totalPages > 1) {
      kbRows.push([
        ...(safePage > 0 ? [{ text: TEXT.navigationPrevButton, callback_data: `pr:page:${safePage - 1}` }] : []),
        { text: `📄 ${safePage + 1}/${totalPages}`, callback_data: 'pr:noop' },
        ...(safePage < totalPages - 1 ? [{ text: TEXT.navigationNextButton, callback_data: `pr:page:${safePage + 1}` }] : []),
      ]);
    }

    if (rows.length > 0) {
      kbRows.push([{ text: TEXT.tagPendingButton, callback_data: 'pr:tagpending' }]);
    }
    kbRows.push([{ text: TEXT.closeButton, callback_data: 'pr:close' }]);
    return { reply_markup: { inline_keyboard: kbRows } };
  }

  async function pick(ctx) {
    if (!await isAdmin(ctx))
      return ctx.answerCbQuery(TEXT.adminOnly);

    const groupId = groupIdFromCtx(ctx);
    const master = await getMaster(groupId);
    const sorted = sortArabic(master.members.map(m => m.name));
    const i      = parseInt(ctx.match[1], 10);
    const name   = sorted[i];
    if (!name) return ctx.answerCbQuery(TEXT.memberNotFound);

    const selected = master.members.find((m) => m.name === name);
    const assignedTraining = selected ? await resolveAssignedTrainingGroup(groupId, selected.userId) : null;

    await ctx.editMessageText(
      TEXT.memberOptionsHeader(name),
      {
        parse_mode: 'Markdown',
        ...memberOptionsKb(i, membersPageOfIndex(i), assignedTraining?.name || null),
      }
    );
    ctx.answerCbQuery();
  }

  async function deleteMember(ctx) {
    if (!await isAdmin(ctx))
      return ctx.answerCbQuery(TEXT.adminOnly);

    const groupId = groupIdFromCtx(ctx);
    const master = await getMaster(groupId);
    const sorted = sortArabic(master.members.map(m => m.name));
    const i      = parseInt(ctx.match[1], 10);
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

    await ctx.editMessageText(membersText(master, membersPageOfIndex(i)), { parse_mode: 'Markdown', ...membersKb(master, membersPageOfIndex(i)) });
    ctx.answerCbQuery(TEXT.memberDeletedShort(name));
  }

  async function rename(ctx) {
    if (!await isAdmin(ctx))
      return ctx.answerCbQuery(TEXT.adminOnly);

    const groupId = groupIdFromCtx(ctx);
    const master = await getMaster(groupId);
    const sorted = sortArabic(master.members.map(m => m.name));
    const i      = parseInt(ctx.match[1], 10);
    const name   = sorted[i];
    if (!name) return ctx.answerCbQuery(TEXT.memberNotFound);

    const uid = String(ctx.from.id);
    if (!await ensureNoPendingAwaiting(ctx, groupId, uid, getAwaiting)) return;

    await ctx.answerCbQuery();
    const msgId = ctx.callbackQuery.message.message_id;
    await setAwaiting(groupId, uid, {
      action: 'rename', chatId: ctx.chat.id, msgId, oldName: name,
      promptMsgId: null, awaitingPrompt: true,
    });
    const prompt = await ctx.reply(TEXT.renamePrompt(name), {
      parse_mode: 'Markdown',
      reply_markup: { force_reply: true, input_field_placeholder: 'الاسم الجديد', selective: true },
    });
    await setAwaiting(groupId, uid, {
      action: 'rename', chatId: ctx.chat.id, msgId, oldName: name,
      promptMsgId: prompt.message_id, awaitingPrompt: false,
    });
  }

  async function backPage(ctx) {
    if (!await isAdmin(ctx))
      return ctx.answerCbQuery(TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    const master = await getMaster(groupId);
    const page = parseInt(ctx.match[1], 10);
    try {
      await ctx.editMessageText(membersText(master, Number.isInteger(page) ? page : 0), { parse_mode: 'Markdown', ...membersKb(master, Number.isInteger(page) ? page : 0) });
    } catch (e) {
      if (!String(e?.message || '').includes('message is not modified')) throw e;
    }
    ctx.answerCbQuery();
  }

  async function back(ctx) {
    if (!await isAdmin(ctx))
      return ctx.answerCbQuery(TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    const master = await getMaster(groupId);
    try {
      await ctx.editMessageText(membersText(master), { parse_mode: 'Markdown', ...membersKb(master) });
    } catch (e) {
      if (!String(e?.message || '').includes('message is not modified')) throw e;
    }
    ctx.answerCbQuery();
  }

  async function page(ctx) {
    if (!await isAdmin(ctx))
      return ctx.answerCbQuery(TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    const master = await getMaster(groupId);
    const page = parseInt(ctx.match[1], 10);
    try {
      await ctx.editMessageText(membersText(master, Number.isInteger(page) ? page : 0), { parse_mode: 'Markdown', ...membersKb(master, Number.isInteger(page) ? page : 0) });
    } catch (e) {
      if (!String(e?.message || '').includes('message is not modified')) throw e;
    }
    ctx.answerCbQuery();
  }

  async function noop(ctx) {
    await ctx.answerCbQuery();
  }

  async function sendConfirm(ctx) {
    if (!await isAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly);

    const groupId = groupIdFromCtx(ctx);
    const master = await getMaster(groupId);
    const idx = parseInt(ctx.match[1], 10);
    const page = parseInt(ctx.match[2], 10);
    const sorted = sortArabic(master.members.map(m => m.name));
    const memberName = sorted[idx];
    
    if (!memberName) return ctx.answerCbQuery(TEXT.memberNotFound);

    const member = master.members.find(m => m.name === memberName);
    if (!member) return ctx.answerCbQuery(TEXT.memberNotFound);

    await ctx.reply(
      `[${member.name}](tg://user/${member.userId})\n${TEXT.memberAdmittedConfirmation(member.name)}`,
      { parse_mode: 'Markdown' }
    );
    return ctx.answerCbQuery(TEXT.confirmationSent);
  }

  async function pendingPage(ctx) {
    if (!await isAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    const pending = await getPendingRegistrations(groupId);
    const page = parseInt(ctx.match[1], 10);
    await ctx.editMessageText(
      pendingStudentsText(pending, Number.isInteger(page) ? page : 0),
      { parse_mode: 'Markdown', ...pendingStudentsKb(pending, Number.isInteger(page) ? page : 0) }
    );
    ctx.answerCbQuery();
  }

  async function pendingNoop(ctx) {
    await ctx.answerCbQuery();
  }

  async function tagPending(ctx) {
    if (!await isAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    const pending = await getPendingRegistrations(groupId);
    if (!pending.length) return ctx.answerCbQuery(TEXT.pendingStudentsEmpty);

    const mentions = pending
      .map((row) => `[${row.name}](tg://user/${row.userId})`)
      .join('\n');
    await ctx.reply(
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
    return ctx.answerCbQuery(updated ? TEXT.registerRequestUpdated : TEXT.registerRequestSubmitted, { show_alert: true });
  }

  async function close(ctx) {
    if (!await isAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly, { show_alert: true });
    
    const groupId = groupIdFromCtx(ctx);
    const adminId = String(ctx.from.id);
    const awaiting = await getAwaiting(groupId, adminId);
    const addedMembers = awaiting?.pendingStudentsAdded || [];
    
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
    
    // Send batch confirmation if any members were added
    if (addedMembers.length > 0) {
      try {
        const mentions = addedMembers
          .map((m) => `[${m.name}](tg://user/${m.userId})`)
          .join('\n');
        const confirmationMessage = `📢 ${mentions}\n\n${TEXT.batchConfirmationHeader}\n\n${TEXT.memberAdmittedConfirmationBatch}`;
        
        await ctx.reply(confirmationMessage, { parse_mode: 'Markdown' });
        await delAwaiting(groupId, adminId);
      } catch (confirmError) {
        console.error('Failed to send batch confirmation:', confirmError.message);
      }
    }
    
    await ctx.answerCbQuery();
  }

  async function add(ctx) {
    if (!await isAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly);

    const groupId = groupIdFromCtx(ctx);
    const userId = String(ctx.match[1]);
    const page = parseInt(ctx.match[2], 10);
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
        await ctx.editMessageText(
          pendingStudentsText(nextPending, Number.isInteger(page) ? page : 0),
          { parse_mode: 'Markdown', ...pendingStudentsKb(nextPending, Number.isInteger(page) ? page : 0) }
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
        pendingStudentsText(nextPending, Number.isInteger(page) ? page : 0),
        { parse_mode: 'Markdown', ...pendingStudentsKb(nextPending, Number.isInteger(page) ? page : 0) }
      );

      const sessionTypes = ['main', 'training', 'open', 'registeredSecondary', 'personalRecitation', 'groupRecitation'];
      for (const type of sessionTypes) {
        const session = await getSession(groupId, type);
        if (!session) continue;
        if (!participants.has(session, entry.name)) {
          participants.setStatus(session, entry.name, null);
          participants.setCalled(session, entry.name, null);
        }
        await saveSession(groupId, type, session);
        if (session.active) {
          await refreshSessionWidget(telegram, session, master, async () => saveSession(groupId, type, session));
        }
      }
      console.log(`[pr:add] Updated attendance/called in all session types`);

      // Track this member for batch confirmation on close (using awaiting system)
      const adminId = String(ctx.from.id);
      const awaiting = await getAwaiting(groupId, adminId) || { action: 'managingPendingStudents', pendingStudentsAdded: [] };
      if (!Array.isArray(awaiting.pendingStudentsAdded)) {
        awaiting.pendingStudentsAdded = [];
      }
      awaiting.pendingStudentsAdded.push({ userId, name: entry.name });
      await setAwaiting(groupId, adminId, awaiting);
      console.log(`[pr:add] Tracked userId ${userId} for batch confirmation (total tracked: ${awaiting.pendingStudentsAdded.length})`);

      return ctx.answerCbQuery(TEXT.memberAdded(entry.name, userId));
    } catch (error) {
      console.error(`[pr:add] Error adding student ${userId}:`, error);
      return ctx.answerCbQuery(TEXT.addMemberError, { show_alert: true });
    }
  }

  async function addTeacher(ctx) {
    if (!await isAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly);

    const groupId = groupIdFromCtx(ctx);
    const pending = await getPendingRegistrations(groupId);
    const userId = String(ctx.match[1]);
    const page = parseInt(ctx.match[2], 10);
    const entry = pending.find((row) => String(row.userId) === userId);
    if (!entry) return ctx.answerCbQuery(TEXT.pendingStudentNotFound);

    const teachers = await getTeachers(groupId);
    if (teachers.find((t) => String(t.userId) === userId)) {
      const nextPending = pending.filter((row) => String(row.userId) !== userId);
      await savePendingRegistrations(groupId, nextPending);
      await ctx.editMessageText(
        pendingStudentsText(nextPending, Number.isInteger(page) ? page : 0),
        { parse_mode: 'Markdown', ...pendingStudentsKb(nextPending, Number.isInteger(page) ? page : 0) }
      );
      return ctx.answerCbQuery(TEXT.teacherUserIdTaken(userId));
    }
    if (teachers.find((t) => t.name === entry.name)) {
      return ctx.answerCbQuery(TEXT.teacherNameTaken(entry.name));
    }

    teachers.push({ userId, name: entry.name, type: DEFAULT_TEACHER_TYPE });
    await saveTeachers(groupId, teachers);

    const nextPending = pending.filter((row) => String(row.userId) !== userId);
    await savePendingRegistrations(groupId, nextPending);

    await ctx.editMessageText(
      pendingStudentsText(nextPending, Number.isInteger(page) ? page : 0),
      { parse_mode: 'Markdown', ...pendingStudentsKb(nextPending, Number.isInteger(page) ? page : 0) }
    );
    return ctx.answerCbQuery(TEXT.pendingStudentAddedAsTeacher(entry.name, teacherTypeLabel[DEFAULT_TEACHER_TYPE]));
  }

  async function edit(ctx) {
    if (!await isAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly);

    const groupId = groupIdFromCtx(ctx);
    const uid = String(ctx.from.id);
    if (!await ensureNoPendingAwaiting(ctx, groupId, uid, getAwaiting)) return;

    const pending = await getPendingRegistrations(groupId);
    const userId = String(ctx.match[1]);
    const page = parseInt(ctx.match[2], 10);
    const entry = pending.find((row) => String(row.userId) === userId);
    if (!entry) return ctx.answerCbQuery(TEXT.pendingStudentNotFound);

    await ctx.answerCbQuery();
    const msgId = ctx.callbackQuery.message.message_id;
    await setAwaiting(groupId, uid, {
      action: 'editPendingRegistration',
      chatId: ctx.chat.id,
      msgId,
      pendingUserId: userId,
      pendingPage: Number.isInteger(page) ? page : 0,
      oldName: entry.name,
      promptMsgId: null,
      awaitingPrompt: true,
    });
    const prompt = await ctx.reply(TEXT.pendingRegistrationRenamePrompt(entry.name), {
      parse_mode: 'Markdown',
      reply_markup: { force_reply: true, input_field_placeholder: 'الاسم الجديد', selective: true },
    });
    await setAwaiting(groupId, uid, {
      action: 'editPendingRegistration',
      chatId: ctx.chat.id,
      msgId,
      pendingUserId: userId,
      pendingPage: Number.isInteger(page) ? page : 0,
      oldName: entry.name,
      promptMsgId: prompt.message_id,
      awaitingPrompt: false,
    });
  }

  async function dismiss(ctx) {
    if (!await isAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly);

    const groupId = groupIdFromCtx(ctx);
    const pending = await getPendingRegistrations(groupId);
    const userId = String(ctx.match[1]);
    const page = parseInt(ctx.match[2], 10);
    const entry = pending.find((row) => String(row.userId) === userId);
    if (!entry) return ctx.answerCbQuery(TEXT.pendingStudentNotFound);

    await ctx.editMessageText(
      pendingStudentsText(pending, Number.isInteger(page) ? page : 0),
      { parse_mode: 'Markdown', ...pendingStudentsKb(pending, Number.isInteger(page) ? page : 0, userId) }
    );
    return ctx.answerCbQuery(TEXT.pendingStudentDismissConfirm(entry.name));
  }

  async function dismissCancel(ctx) {
    if (!await isAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly);

    const groupId = groupIdFromCtx(ctx);
    const pending = await getPendingRegistrations(groupId);
    const page = parseInt(ctx.match[1], 10);
    await ctx.editMessageText(
      pendingStudentsText(pending, Number.isInteger(page) ? page : 0),
      { parse_mode: 'Markdown', ...pendingStudentsKb(pending, Number.isInteger(page) ? page : 0) }
    );
    return ctx.answerCbQuery();
  }

  async function dismissConfirm(ctx) {
    if (!await isAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly);

    const groupId = groupIdFromCtx(ctx);
    const pending = await getPendingRegistrations(groupId);
    const userId = String(ctx.match[1]);
    const page = parseInt(ctx.match[2], 10);
    const entry = pending.find((row) => String(row.userId) === userId);
    if (!entry) return ctx.answerCbQuery(TEXT.pendingStudentNotFound);

    const nextPending = pending.filter((row) => String(row.userId) !== userId);
    await savePendingRegistrations(groupId, nextPending);

    await ctx.editMessageText(
      pendingStudentsText(nextPending, Number.isInteger(page) ? page : 0),
      { parse_mode: 'Markdown', ...pendingStudentsKb(nextPending, Number.isInteger(page) ? page : 0) }
    );
    return ctx.answerCbQuery(TEXT.pendingStudentDismissed(entry.name));
  }

  async function addMember(ctx) {
    if (!await isAdmin(ctx))
      return ctx.answerCbQuery(TEXT.adminOnly);

    const groupId = groupIdFromCtx(ctx);
    const uid = String(ctx.from.id);
    if (!await ensureNoPendingAwaiting(ctx, groupId, uid, getAwaiting)) return;

    await ctx.answerCbQuery();
    const msgId = ctx.callbackQuery.message.message_id;
    await setAwaiting(groupId, uid, {
      action: 'add', chatId: ctx.chat.id, msgId, promptMsgId: null, awaitingPrompt: true,
    });
    const prompt = await ctx.replyWithMarkdown(TEXT.inlinePromptAdd, dismissKb());
    await setAwaiting(groupId, uid, {
      action: 'add', chatId: ctx.chat.id, msgId, promptMsgId: prompt.message_id, awaitingPrompt: false,
    });
  }

  async function sendConfirmations(ctx) {
    if (!await isAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly);

    const groupId = groupIdFromCtx(ctx);
    const master = await getMaster(groupId);
    const members = Array.isArray(master.members) ? master.members : [];

    if (!members.length) return ctx.answerCbQuery(TEXT.noMembersToConfirm);

    const mentions = members
      .map((m) => `[${m.name}](tg://user/${m.userId})`)
      .join('\n');

    const confirmationMessage = `📢 ${mentions}\n\n${TEXT.batchConfirmationHeader}\n\n${TEXT.memberAdmittedConfirmationBatch}`;

    await ctx.reply(confirmationMessage, { parse_mode: 'Markdown' });
    return ctx.answerCbQuery(TEXT.batchConfirmationAlert(members.length), { show_alert: true });
  }

  return { pick, deleteMember, rename, backPage, back, page, noop, sendConfirm, pendingPage, pendingNoop, tagPending, join, close, add, addTeacher, edit, dismiss, dismissCancel, dismissConfirm, addMember, sendConfirmations };
}

export function register(bot, storage) {
  const h = createHandlers({ storage, telegram: bot.telegram });
  bot.action(/^mb:pick:(\d+)$/, h.pick);
  bot.action(/^mb:del:(\d+)$/, h.deleteMember);
  bot.action(/^mb:ren:(\d+)$/, h.rename);
  bot.action(/^mb:back:(\d+)$/, h.backPage);
  bot.action('mb:back', h.back);
  bot.action(/^mb:page:(\d+)$/, h.page);
  bot.action('mb:noop', h.noop);
  bot.action(/^mb:sendconfirm:(\d+):(\d+)$/, h.sendConfirm);
  bot.action(/^pr:page:(\d+)$/, h.pendingPage);
  bot.action('pr:noop', h.pendingNoop);
  bot.action('pr:tagpending', h.tagPending);
  bot.action('pr:join', h.join);
  bot.action('pr:close', h.close);
  bot.action(/^pr:add:(\d+):(\d+)$/, h.add);
  bot.action(/^pr:addteacher:(\d+):(\d+)$/, h.addTeacher);
  bot.action(/^pr:edit:(\d+):(\d+)$/, h.edit);
  bot.action(/^pr:dismiss:(\d+):(\d+)$/, h.dismiss);
  bot.action(/^pr:dismisscancel:(\d+)$/, h.dismissCancel);
  bot.action(/^pr:dismissconfirm:(\d+):(\d+)$/, h.dismissConfirm);
  bot.action('mb:add', h.addMember);
  bot.action('mb:sendconfirmations', h.sendConfirmations);
}
