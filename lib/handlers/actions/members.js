import { isAdmin } from '../../guards.js';
import { groupIdFromCtx, sortArabic, ensureNoPendingAwaiting, getDisplayName, escapeTelegramMarkdown } from '../../helpers.js';
import { TEXT } from '../../text.js';
import { memberOptionsKb, membersText, membersKb, refreshSessionWidget, dismissKb, membersPageOfIndex } from '../../widgets.js';

export function register(bot, storage) {
  const { getMaster, saveMaster, getActiveSession, getSession, saveSession, setAwaiting, getAwaiting, getPendingRegistrations, savePendingRegistrations, getTeachers, saveTeachers, getTrainingGroups } = storage;
  const PENDING_PAGE_SIZE = 5;
  const DEFAULT_TEACHER_TYPE = 'recitationteacher';
  const teacherTypeLabel = {
    recitationteacher: '🎙️ معلمة التلاوة',
  };

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

    return `${TEXT.pendingStudentsHeader(rows.length)}\n📄 صفحة ${safePage + 1}/${totalPages}\n\n${lines.join('\n\n')}`;
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
          { text: '✅ تأكيد التجاهل', callback_data: `pr:dismissconfirm:${row.userId}:${safePage}` },
          { text: '↩️ رجوع', callback_data: `pr:dismisscancel:${safePage}` },
        ]);
        continue;
      }

      kbRows.push([
        { text: `➕ ${row.name}`, callback_data: `pr:add:${row.userId}:${safePage}` },
        { text: '👩‍🏫 إضافة كمعلمة', callback_data: `pr:addteacher:${row.userId}:${safePage}` },
      ]);
      kbRows.push([
        { text: '🗑️ تجاهل', callback_data: `pr:dismiss:${row.userId}:${safePage}` },
      ]);
    }

    if (totalPages > 1) {
      kbRows.push([
        ...(safePage > 0 ? [{ text: '⬅️', callback_data: `pr:page:${safePage - 1}` }] : []),
        { text: `📄 ${safePage + 1}/${totalPages}`, callback_data: 'pr:noop' },
        ...(safePage < totalPages - 1 ? [{ text: '➡️', callback_data: `pr:page:${safePage + 1}` }] : []),
      ]);
    }

    if (rows.length > 0) {
      kbRows.push([{ text: '📢 تنبيه المعلقين', callback_data: 'pr:tagpending' }]);
    }
    kbRows.push([{ text: '✕ إغلاق', callback_data: 'msg:dismiss' }]);
    return { reply_markup: { inline_keyboard: kbRows } };
  }

  bot.action(/^mb:pick:(\d+)$/, async (ctx) => {
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
  });

  bot.action(/^mb:del:(\d+)$/, async (ctx) => {
    if (!await isAdmin(ctx))
      return ctx.answerCbQuery(TEXT.adminOnly);

    const groupId = groupIdFromCtx(ctx);
    const master = await getMaster(groupId);
    const sorted = sortArabic(master.members.map(m => m.name));
    const i      = parseInt(ctx.match[1], 10);
    const name   = sorted[i];

  bot.action('mb:noop', async (ctx) => {
    await ctx.answerCbQuery();
  });
    if (!name) return ctx.answerCbQuery(TEXT.memberNotFound);

    master.members.splice(master.members.findIndex(m => m.name === name), 1);
    await saveMaster(groupId, master);

    const activeSession = await getActiveSession(groupId);
    if (activeSession?.session) {
      const { type, session } = activeSession;
      delete session.attendance[name];
      if (session.called) delete session.called[name];
      await saveSession(groupId, type, session);
      await refreshSessionWidget(bot.telegram, session, master, async () => saveSession(groupId, type, session));
    }

    await ctx.editMessageText(membersText(master, membersPageOfIndex(i)), { parse_mode: 'Markdown', ...membersKb(master, membersPageOfIndex(i)) });
    ctx.answerCbQuery(TEXT.memberDeletedShort(name));
  });

  bot.action(/^mb:ren:(\d+)$/, async (ctx) => {
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
  });

  bot.action(/^mb:back:(\d+)$/, async (ctx) => {
    if (!await isAdmin(ctx))
      return ctx.answerCbQuery(TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    const master = await getMaster(groupId);
    const page = parseInt(ctx.match[1], 10);
    await ctx.editMessageText(membersText(master, Number.isInteger(page) ? page : 0), { parse_mode: 'Markdown', ...membersKb(master, Number.isInteger(page) ? page : 0) });
    ctx.answerCbQuery();
  });

  bot.action('mb:back', async (ctx) => {
    if (!await isAdmin(ctx))
      return ctx.answerCbQuery(TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    const master = await getMaster(groupId);
    await ctx.editMessageText(membersText(master), { parse_mode: 'Markdown', ...membersKb(master) });
    ctx.answerCbQuery();
  });

  bot.action(/^mb:page:(\d+)$/, async (ctx) => {
    if (!await isAdmin(ctx))
      return ctx.answerCbQuery(TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    const master = await getMaster(groupId);
    const page = parseInt(ctx.match[1], 10);
    await ctx.editMessageText(membersText(master, Number.isInteger(page) ? page : 0), { parse_mode: 'Markdown', ...membersKb(master, Number.isInteger(page) ? page : 0) });
    ctx.answerCbQuery();
  });

  bot.action('mb:noop', async (ctx) => {
    await ctx.answerCbQuery();
  });

  bot.action(/^pr:page:(\d+)$/, async (ctx) => {
    if (!await isAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    const pending = await getPendingRegistrations(groupId);
    const page = parseInt(ctx.match[1], 10);
    await ctx.editMessageText(
      pendingStudentsText(pending, Number.isInteger(page) ? page : 0),
      { parse_mode: 'Markdown', ...pendingStudentsKb(pending, Number.isInteger(page) ? page : 0) }
    );
    ctx.answerCbQuery();
  });

  bot.action('pr:noop', async (ctx) => {
    await ctx.answerCbQuery();
  });

  bot.action('pr:tagpending', async (ctx) => {
    if (!await isAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    const pending = await getPendingRegistrations(groupId);
    if (!pending.length) return ctx.answerCbQuery(TEXT.pendingStudentsEmpty);

    const mentions = pending
      .map((row) => `[${row.name}](tg://user/${row.userId})`)
      .join(' ');
    await ctx.reply(
      TEXT.tagPendingNotice(mentions),
      { parse_mode: 'Markdown' }
    );
    await ctx.answerCbQuery();
  });

  bot.action('pr:join', async (ctx) => {
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
  });

  bot.action('pr:close', async (ctx) => {
    if (!await isAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly, { show_alert: true });
    await ctx.answerCbQuery();
    try {
      await ctx.deleteMessage();
    } catch {
      await ctx.editMessageText(TEXT.registerWidgetClosed);
    }
  });

  bot.action(/^pr:add:(\d+):(\d+)$/, async (ctx) => {
    if (!await isAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly);

    const groupId = groupIdFromCtx(ctx);
    const pending = await getPendingRegistrations(groupId);
    const userId = String(ctx.match[1]);
    const page = parseInt(ctx.match[2], 10);
    const entry = pending.find((row) => String(row.userId) === userId);
    if (!entry) return ctx.answerCbQuery(TEXT.pendingStudentNotFound);

    const master = await getMaster(groupId);
    if (master.members.find((m) => String(m.userId) === userId)) {
      const nextPending = pending.filter((row) => String(row.userId) !== userId);
      await savePendingRegistrations(groupId, nextPending);
      await ctx.editMessageText(
        pendingStudentsText(nextPending, Number.isInteger(page) ? page : 0),
        { parse_mode: 'Markdown', ...pendingStudentsKb(nextPending, Number.isInteger(page) ? page : 0) }
      );
      return ctx.answerCbQuery(TEXT.userIdLinked(userId));
    }
    if (master.members.find((m) => m.name === entry.name)) {
      return ctx.answerCbQuery(TEXT.nameTaken(entry.name));
    }

    master.members.push({ userId, name: entry.name });
    await saveMaster(groupId, master);

    const nextPending = pending.filter((row) => String(row.userId) !== userId);
    await savePendingRegistrations(groupId, nextPending);

    const sessionTypes = ['main', 'open', 'registeredSecondary', 'personalRecitation', 'groupRecitation'];
    for (const type of sessionTypes) {
      const session = await getSession(groupId, type);
      if (!session) continue;
      if (session.attendance && !(entry.name in session.attendance)) {
        session.attendance[entry.name] = null;
      }
      if (session.called && !(entry.name in session.called)) {
        session.called[entry.name] = null;
      }
      await saveSession(groupId, type, session);
      if (session.active) {
        await refreshSessionWidget(bot.telegram, session, master, async () => saveSession(groupId, type, session));
      }
    }

    await ctx.editMessageText(
      pendingStudentsText(nextPending, Number.isInteger(page) ? page : 0),
      { parse_mode: 'Markdown', ...pendingStudentsKb(nextPending, Number.isInteger(page) ? page : 0) }
    );
    await bot.telegram.sendMessage(userId, TEXT.memberAdmittedConfirmation(entry.name));
    return ctx.answerCbQuery(TEXT.memberAdded(entry.name, userId));
  });

  bot.action(/^pr:addteacher:(\d+):(\d+)$/, async (ctx) => {
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
  });

  bot.action(/^pr:edit:(\d+):(\d+)$/, async (ctx) => {
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
  });

  bot.action(/^pr:dismiss:(\d+):(\d+)$/, async (ctx) => {
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
  });

  bot.action(/^pr:dismisscancel:(\d+)$/, async (ctx) => {
    if (!await isAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly);

    const groupId = groupIdFromCtx(ctx);
    const pending = await getPendingRegistrations(groupId);
    const page = parseInt(ctx.match[1], 10);
    await ctx.editMessageText(
      pendingStudentsText(pending, Number.isInteger(page) ? page : 0),
      { parse_mode: 'Markdown', ...pendingStudentsKb(pending, Number.isInteger(page) ? page : 0) }
    );
    return ctx.answerCbQuery();
  });

  bot.action(/^pr:dismissconfirm:(\d+):(\d+)$/, async (ctx) => {
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
  });

  bot.action('mb:add', async (ctx) => {
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
  });

  bot.action('mb:sendconfirmations', async (ctx) => {
    if (!await isAdmin(ctx)) return ctx.answerCbQuery(TEXT.adminOnly);

    const groupId = groupIdFromCtx(ctx);
    const master = await getMaster(groupId);
    const members = Array.isArray(master.members) ? master.members : [];

    if (!members.length) return ctx.answerCbQuery('لا توجد طالبات مسجلات.');

    let successCount = 0;
    let failCount = 0;

    for (const member of members) {
      try {
        await bot.telegram.sendMessage(
          member.userId,
          TEXT.memberAdmittedConfirmation(member.name)
        );
        successCount++;
      } catch (error) {
        failCount++;
      }
    }

    const message = `✅ تم إرسال ${successCount} تأكيد${failCount ? `\n⚠️ فشل إرسال ${failCount}` : ''}`;
    return ctx.answerCbQuery(message, { show_alert: true });
  });
}
