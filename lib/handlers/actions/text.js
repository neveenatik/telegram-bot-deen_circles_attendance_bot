import { groupIdFromCtx, formatPages, parsePageInput, replyEphemeral, splitEntries, logTelegramError, escapeTelegramMarkdown } from '../../helpers.js';
import { getActiveSessionType } from '../../sessionTypes.js';
import { TEXT } from '../../text.js';
import { membersText, membersKb, manageText, manageKb, managePageOfIndex, refreshSessionWidget } from '../../widgets.js';
import { archivedSessionKey } from '../../historyUtils.js';
import { renderHistoryMemberMenu } from './history.js';
import * as participants from '../../sessionParticipants.js';

export function createHandlers({ storage, telegram }) {
  const {
    getAwaiting, delAwaiting, getMaster, saveMaster,
    getSession, saveSession, getPageProgress, savePageProgress,
    getPendingRegistrations, savePendingRegistrations, allocateGroupRecitationPage,
    getSessions, saveSessions,
  } = storage;

  async function resolveSessionType(groupId, requestedType = null) {
    if (requestedType) {
      const requested = await getSession(groupId, requestedType);
      if (requested?.active) return requestedType;
    }
    return getActiveSessionType(getSession, groupId);
  }

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

    kbRows.push([{ text: '✕ إغلاق', callback_data: 'msg:dismiss' }]);
    return { reply_markup: { inline_keyboard: kbRows } };
  }

  async function onText(ctx, next) {
    if (ctx.message.text.startsWith('/')) return next();

    const awaitKey = groupIdFromCtx(ctx);
    const uid     = String(ctx.from.id);
    const pending = await getAwaiting(awaitKey, uid);
    if (!pending) return next();

    if (pending.awaitingPrompt && !pending.promptMsgId) {
      return replyEphemeral(ctx, '⏳ جاري تجهيز رسالة الإدخال، من فضلك انتظري لحظة ثم أرسلي الرد على الرسالة نفسها.');
    }

    if (pending.promptMsgId) {
      const replyId = ctx.message.reply_to_message?.message_id;
      if (replyId !== pending.promptMsgId)
        return replyEphemeral(ctx, TEXT.replyToPromptOnly);
    }

    await delAwaiting(awaitKey, uid);
    const input = ctx.message.text.trim();
    if (!input) return replyEphemeral(ctx, TEXT.emptyInput);

    // The prompt may have been answered in a DM (admin edit panel), so the real
    // target group is carried on the awaiting record; fall back to the reply chat.
    const groupId = pending.groupId || awaitKey;
    const master = await getMaster(groupId);

    if (pending.action === 'add') {
      const entries = splitEntries(input);
      const added = [];
      const failed = [];

      for (const entry of entries) {
        const parts = entry.split('|').map(s => s.trim());
        if (parts.length !== 2 || !parts[0] || !parts[1]) {
          failed.push(`\`${entry}\` – صيغة غير صحيحة`);
          continue;
        }

        const [rawId, newName] = parts;
        if (!/^\d+$/.test(rawId)) {
          failed.push(`\`${entry}\` – رقم الحساب غير صحيح`);
          continue;
        }
        if (master.members.find(m => m.name === newName)) {
          failed.push(`\`${newName}\` – الاسم موجود مسبقاً`);
          continue;
        }
        if (master.members.find(m => m.userId === rawId)) {
          failed.push(`\`${rawId}\` – رقم الحساب مرتبط بطالبة أخرى`);
          continue;
        }

        master.members.push({ userId: rawId, name: newName });
        added.push({ userId: rawId, name: newName });
      }

      if (!added.length && failed.some((f) => f.includes('صيغة غير صحيحة'))) {
        return replyEphemeral(ctx, TEXT.inlineInvalidAddFormat);
      }

      if (added.length) {
        await saveMaster(groupId, master);

        const activeType = await getActiveSessionType(getSession, groupId);
        if (activeType) {
          const session = await getSession(groupId, activeType);
          if (session) {
            for (const { name } of added) {
              participants.setStatus(session, name, null);
            }
            await saveSession(groupId, activeType, session);
            await refreshSessionWidget(telegram, session, master, async () => saveSession(groupId, activeType, session));
          }
        }
      }

      if (entries.length === 1 && added.length === 1) {
        await replyEphemeral(ctx, TEXT.memberAdded(added[0].name, added[0].userId), { parse_mode: 'Markdown' });
      } else {
        const lines = [];
        if (added.length) lines.push(`✅ تمت إضافة ${added.length}: ${added.map(a => a.name).join('، ')}`);
        if (failed.length) lines.push(`⚠️ لم تُضف:\n${failed.map(f => `• ${f}`).join('\n')}`);
        await replyEphemeral(ctx, lines.join('\n\n'), { parse_mode: 'Markdown' });
      }

      telegram.editMessageText(
        pending.chatId, pending.msgId, undefined,
        membersText(master),
        { parse_mode: 'Markdown', ...membersKb(master) }
      ).catch((err) => logTelegramError('text.add.refreshMembersWidget', err, {
        groupId,
        chatId: String(pending.chatId),
        messageId: pending.msgId,
      }));
      return;
    }

    if (pending.action === 'rename') {
      const { oldName } = pending;
      const newName = input;

      if (master.members.find(m => m.name === newName))
        return replyEphemeral(ctx, TEXT.nameTaken(newName), { parse_mode: 'Markdown' });

      const entry = master.members.find(m => m.name === oldName);
      if (!entry)
        return replyEphemeral(ctx, TEXT.memberGone(oldName), { parse_mode: 'Markdown' });

      entry.name = newName;
      await saveMaster(groupId, master);

      const activeType = await getActiveSessionType(getSession, groupId);
      if (activeType) {
        const session = await getSession(groupId, activeType);
        if (session && participants.has(session, oldName)) {
          participants.rename(session, oldName, newName);
          await saveSession(groupId, activeType, session);
          await refreshSessionWidget(telegram, session, master, async () => saveSession(groupId, activeType, session));
        }
      }

      replyEphemeral(ctx, TEXT.memberRenamed(oldName, newName), { parse_mode: 'Markdown' });
      telegram.editMessageText(
        pending.chatId, pending.msgId, undefined,
        membersText(master),
        { parse_mode: 'Markdown', ...membersKb(master) }
      ).catch((err) => logTelegramError('text.rename.refreshMembersWidget', err, {
        groupId,
        chatId: String(pending.chatId),
        messageId: pending.msgId,
      }));
    }

    if (pending.action === 'editPendingRegistration') {
      const newName = input;
      const pendingRegistrations = await getPendingRegistrations(groupId);
      const pendingEntry = pendingRegistrations.find((row) => String(row.userId) === String(pending.pendingUserId));
      if (!pendingEntry)
        return replyEphemeral(ctx, TEXT.pendingStudentNotFound);

      if (master.members.find((m) => m.name === newName)) {
        return replyEphemeral(ctx, TEXT.nameTaken(newName), { parse_mode: 'Markdown' });
      }

      if (pendingRegistrations.find((row) => String(row.userId) !== String(pending.pendingUserId) && row.name === newName)) {
        return replyEphemeral(ctx, TEXT.pendingStudentNameTaken(newName), { parse_mode: 'Markdown' });
      }

      const oldName = pendingEntry.name;
      pendingEntry.name = newName;
      await savePendingRegistrations(groupId, pendingRegistrations);

      const page = Number.isInteger(pending.pendingPage) ? pending.pendingPage : 0;
      telegram.editMessageText(
        pending.chatId, pending.msgId, undefined,
        pendingStudentsText(pendingRegistrations, page),
        { parse_mode: 'Markdown', ...pendingStudentsKb(pendingRegistrations, page) }
      ).catch((err) => logTelegramError('text.editPendingRegistration.refreshPendingWidget', err, {
        groupId,
        chatId: String(pending.chatId),
        messageId: pending.msgId,
      }));

      return replyEphemeral(ctx, TEXT.pendingStudentRenamed(oldName, newName), { parse_mode: 'Markdown' });
    }

    if (pending.action === 'addGuest') {
      const newName = input;
      const activeType = await resolveSessionType(groupId, pending.sessionType || null);
      if (!activeType) return replyEphemeral(ctx, TEXT.noSessionActive);
      const session = await getSession(groupId, activeType);
      if (!session) return replyEphemeral(ctx, TEXT.noSessionActive);
      if (participants.has(session, newName))
        return replyEphemeral(ctx, TEXT.guestExistsInSession(newName), { parse_mode: 'Markdown' });

      participants.setStatus(session, newName, null);
      participants.setCalled(session, newName, null);
      participants.setRegisteredAt(session, newName, Date.now());

      // Assign pages for page list and group recitation sessions
      if (session.type === 'personalRecitation') {
        const progress = await getPageProgress(groupId);
        participants.setPage(session, newName, (Number(progress[newName]) || 0) + 1);
      }

      if (session.type === 'groupRecitation') {
        const page = await allocateGroupRecitationPage(groupId, activeType, session);
        participants.setPage(session, newName, page);
        session.groupRecitationStartPage = page + 1;
      }
      
      await saveSession(groupId, activeType, session);

      await refreshSessionWidget(telegram, session, master, async () => saveSession(groupId, activeType, session));
      telegram.editMessageText(
        pending.chatId, pending.msgId, undefined,
        manageText(session, master),
        { parse_mode: 'Markdown', ...manageKb(session, master, 0, activeType) }
      ).catch((err) => logTelegramError('text.addGuest.refreshManageWidget', err, {
        groupId,
        chatId: String(pending.chatId),
        messageId: pending.msgId,
      }));
      return replyEphemeral(ctx, TEXT.guestAddedToSession(newName), { parse_mode: 'Markdown' });
    }

    if (pending.action === 'editSessionName') {
      const newName = input.trim();
      if (!newName) return replyEphemeral(ctx, TEXT.emptyInput);
      if (newName.length > 80) return replyEphemeral(ctx, TEXT.invalidStartFormat);

      const activeType = await resolveSessionType(groupId, pending.sessionType || null);
      if (!activeType) return replyEphemeral(ctx, TEXT.noSessionActive);
      const session = await getSession(groupId, activeType);
      if (!session) return replyEphemeral(ctx, TEXT.noSessionActive);

      const oldName = session.name;
      session.name = newName;
      await saveSession(groupId, activeType, session);

      await refreshSessionWidget(telegram, session, master, async () => saveSession(groupId, activeType, session));
      const page = Number.isInteger(pending.managePage) ? pending.managePage : 0;
      telegram.editMessageText(
        pending.chatId, pending.msgId, undefined,
        manageText(session, master, page),
        { parse_mode: 'Markdown', ...manageKb(session, master, page, activeType) }
      ).catch((err) => logTelegramError('text.editSessionName.refreshManageWidget', err, {
        groupId,
        chatId: String(pending.chatId),
        messageId: pending.msgId,
      }));
      return replyEphemeral(ctx, TEXT.sessionNameEdited(oldName, newName), { parse_mode: 'Markdown' });
    }

    if (pending.action === 'editPage') {
      const { memberName } = pending;
      const parsedPage = parsePageInput(input.trim());
      if (!parsedPage)
        return replyEphemeral(ctx, TEXT.invalidPageNumber);

      const activeType = await resolveSessionType(groupId, pending.sessionType || null);
      if (!activeType) return replyEphemeral(ctx, TEXT.noSessionActive);
      const session = await getSession(groupId, activeType);
      if (!session) return replyEphemeral(ctx, TEXT.noSessionActive);

      participants.setPage(session, memberName, parsedPage);
      await saveSession(groupId, activeType, session);

      const progress = await getPageProgress(groupId);
      progress[memberName] = parsedPage;
      await savePageProgress(groupId, progress);

      await refreshSessionWidget(telegram, session, master, async () => saveSession(groupId, activeType, session));
      const page = Number.isInteger(pending.memberIndex) ? managePageOfIndex(pending.memberIndex) : 0;
      telegram.editMessageText(
        pending.chatId, pending.msgId, undefined,
        manageText(session, master, page),
        { parse_mode: 'Markdown', ...manageKb(session, master, page, activeType) }
      ).catch((err) => logTelegramError('text.editPage.refreshManageWidget', err, {
        groupId,
        chatId: String(pending.chatId),
        messageId: pending.msgId,
      }));
      return replyEphemeral(ctx, TEXT.pageEditedSuccess(memberName, formatPages(parsedPage)), { parse_mode: 'Markdown' });
    }

    if (pending.action === 'editVerse') {
      const { memberName } = pending;
      const verse = input.trim();
      if (!verse) return replyEphemeral(ctx, TEXT.invalidVerseInput);
      if (verse.length > 80) return replyEphemeral(ctx, TEXT.invalidVerseInput);

      const activeType = await resolveSessionType(groupId, pending.sessionType || null);
      if (!activeType) return replyEphemeral(ctx, TEXT.noSessionActive);
      const session = await getSession(groupId, activeType);
      if (!session) return replyEphemeral(ctx, TEXT.noSessionActive);

      participants.setVerse(session, memberName, verse);
      await saveSession(groupId, activeType, session);

      await refreshSessionWidget(telegram, session, master, async () => saveSession(groupId, activeType, session));
      const page = Number.isInteger(pending.memberIndex) ? managePageOfIndex(pending.memberIndex) : 0;
      telegram.editMessageText(
        pending.chatId, pending.msgId, undefined,
        manageText(session, master, page),
        { parse_mode: 'Markdown', ...manageKb(session, master, page, activeType) }
      ).catch((err) => logTelegramError('text.editVerse.refreshManageWidget', err, {
        groupId,
        chatId: String(pending.chatId),
        messageId: pending.msgId,
      }));
      return replyEphemeral(ctx, TEXT.verseEditedSuccess(memberName, verse), { parse_mode: 'Markdown' });
    }

    if (pending.action === 'historyEditVerse') {
      const { memberName, sessionType, recordKey, token, series, recordIndex } = pending;
      const verse = input.trim();
      if (!verse || verse.length > 80) return replyEphemeral(ctx, TEXT.invalidVerseInput);

      const typeSessions = await getSessions(groupId, sessionType);
      const idx = typeSessions.findIndex((s) => archivedSessionKey(s) === recordKey);
      if (idx === -1) return replyEphemeral(ctx, TEXT.recordNotFoundForEdit);

      participants.setVerse(typeSessions[idx], memberName, verse);
      await saveSessions(groupId, sessionType, typeSessions);

      const menu = renderHistoryMemberMenu(groupId, series, recordIndex, typeSessions[idx], token);
      if (menu) {
        telegram.editMessageText(
          pending.chatId, pending.msgId, undefined,
          menu.text,
          { parse_mode: 'Markdown', ...menu.keyboard }
        ).catch((err) => logTelegramError('text.historyEditVerse.refreshEditor', err, {
          groupId,
          chatId: String(pending.chatId),
          messageId: pending.msgId,
        }));
      }
      return replyEphemeral(ctx, TEXT.verseEditedSuccess(memberName, verse), { parse_mode: 'Markdown' });
    }

    return next();
  }

  return { onText };
}

export function register(bot, storage) {
  const h = createHandlers({ storage, telegram: bot.telegram });
  bot.on('text', h.onText);
}
