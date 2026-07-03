import { isAdmin } from '../../guards.js';
import { groupIdFromCtx, sortArabic, ensureNoPendingAwaiting, getDisplayName, escapeTelegramMarkdown } from '../../helpers.js';
import { TEXT } from '../../text.js';
import { memberOptionsKb, membersText, membersKb, refreshSessionWidget, dismissKb, membersPageOfIndex } from '../../widgets.js';

export function register(bot, storage) {
  const { getMaster, saveMaster, getActiveSession, getSession, saveSession, setAwaiting, getAwaiting, getPendingRegistrations, savePendingRegistrations } = storage;
  const PENDING_PAGE_SIZE = 5;

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

    const kbRows = slice.map((row) => (
      String(row.userId) === String(confirmDismissUserId)
        ? [
            { text: '✅ تأكيد التجاهل', callback_data: `pr:dismissconfirm:${row.userId}:${safePage}` },
            { text: '↩️ رجوع', callback_data: `pr:dismisscancel:${safePage}` },
          ]
        : [
            { text: `➕ ${row.name}`, callback_data: `pr:add:${row.userId}:${safePage}` },
            { text: '🗑️ تجاهل', callback_data: `pr:dismiss:${row.userId}:${safePage}` },
          ]
    ));

    if (totalPages > 1) {
      kbRows.push([
        ...(safePage > 0 ? [{ text: '⬅️', callback_data: `pr:page:${safePage - 1}` }] : []),
        { text: `📄 ${safePage + 1}/${totalPages}`, callback_data: 'pr:noop' },
        ...(safePage < totalPages - 1 ? [{ text: '➡️', callback_data: `pr:page:${safePage + 1}` }] : []),
      ]);
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

    await ctx.editMessageText(
      TEXT.memberOptionsHeader(name),
      { parse_mode: 'Markdown', ...memberOptionsKb(i, membersPageOfIndex(i)) }
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
    return ctx.answerCbQuery(TEXT.memberAdded(entry.name, userId));
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
}
