import { formatPages, parsePageInput, replyEphemeral, splitEntries, logTelegramError, getDisplayName } from '../../helpers.js';
import { getActiveSessionType } from '../../sessionTypes.js';
import { TEXT } from '../../text.js';
import { membersText, membersKb, manageText, manageKb, managePageOfIndex, refreshSessionWidget } from '../../widgets.js';
import { pendingStudentsText, pendingStudentsKb } from './members.js';
import { archivedSessionKey } from '../../historyUtils.js';
import { renderHistorySessionEditor, renderHistoryVerseList } from './history.js';
import { renderClassHome, renderRoster, renderTeachers, renderTeacherMenu, renderManagersMenu, renderManagerMenu, renderTrainingGroups, renderTrainingGroupMenu } from './offline.js';
import { groupTeachersView, groupTeacherMenuView, groupTrainingGroupsView, groupTrainingGroupMenuView } from './hub.js';
import { materialMenuView, materialFilesView } from './materials.js';
import * as participants from '../../sessionParticipants.js';

export function createHandlers({ storage, telegram }) {
  const {
    getReplyPrompt, delReplyPrompt, getMaster, saveMaster,
    getSession, saveSession, getPageProgress, savePageProgress,
    getPendingRegistrations, savePendingRegistrations, allocateGroupRecitationPage,
    getSessions, saveSessions,
    createOfflineClass, renameOfflineClass, addOfflineStudents, addOfflineTeachers,
    renameOfflineStudent, renameOfflineTeacher,
    getOfflineClassById, getTeachers, saveTeachers,
    addClassManager, listClassManagers, touchClassManagerName,
    getTrainingGroups, saveTrainingGroups, setParentGroup,
    getOfflineTrainingGroups, addOfflineTrainingGroup, renameOfflineTrainingGroup,
    renameMaterial, getMaterialById,
    renameMaterialFile,
    getClassTimezone,
  } = storage;
  async function resolveSessionType(groupId, requestedType = null) {
    if (requestedType) {
      const requested = await getSession(groupId, requestedType);
      if (requested?.active) return requestedType;
    }
    return getActiveSessionType(getSession, groupId);
  }

  async function onText(ctx, next) {
    if (ctx.message.text.startsWith('/')) return next();

    // Option A: a captured text reply is routed by the prompt it replies to.
    // Telegram echoes the original prompt as reply_to_message, whose message_id
    // is the key we stored the awaiting record under. No reply → not for us.
    const promptMsgId = ctx.message.reply_to_message?.message_id;
    if (!promptMsgId) return next();

    const chatKey = String(ctx.chat.id);
    const pending = await getReplyPrompt(chatKey, promptMsgId);
    if (!pending) return next();

    await delReplyPrompt(chatKey, promptMsgId);
    const input = ctx.message.text.trim();
    if (!input) return replyEphemeral(ctx, TEXT.emptyInput);

    // The prompt may have been answered in a DM (admin edit panel), so the real
    // target group is carried on the awaiting record; fall back to the reply chat.
    const groupId = pending.groupId || chatKey;
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
        { parse_mode: 'Markdown', ...membersKb(groupId, master) }
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
        { parse_mode: 'Markdown', ...membersKb(groupId, master) }
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
      const pendingTz = getClassTimezone ? await getClassTimezone(groupId).catch(() => 'Africa/Cairo') : 'Africa/Cairo';
      telegram.editMessageText(
        pending.chatId, pending.msgId, undefined,
        pendingStudentsText(pendingRegistrations, page, pendingTz),
        { parse_mode: 'Markdown', ...pendingStudentsKb(groupId, pendingRegistrations, page) }
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
      const { memberName, sessionType, recordKey, series, recordIndex } = pending;
      const verse = input.trim();
      if (!verse || verse.length > 80) return replyEphemeral(ctx, TEXT.invalidVerseInput);

      const typeSessions = await getSessions(groupId, sessionType);
      const idx = typeSessions.findIndex((s) => archivedSessionKey(s) === recordKey);
      if (idx === -1) return replyEphemeral(ctx, TEXT.recordNotFoundForEdit);

      participants.setVerse(typeSessions[idx], memberName, verse);
      await saveSessions(groupId, sessionType, typeSessions);

      const nav = { ns: pending.ns || 'h', gref: pending.gref ?? groupId };
      const view = renderHistoryVerseList(groupId, series, recordIndex, typeSessions[idx], pending.verseListPage || 0, 8, nav);
      telegram.editMessageText(
        pending.chatId, pending.msgId, undefined,
        view.text,
        { parse_mode: 'Markdown', ...view.keyboard }
      ).catch((err) => logTelegramError('text.historyEditVerse.refreshEditor', err, {
        groupId,
        chatId: String(pending.chatId),
        messageId: pending.msgId,
      }));
      return replyEphemeral(ctx, TEXT.verseEditedSuccess(memberName, verse), { parse_mode: 'Markdown' });
    }

    if (pending.action === 'historyEditTitle') {
      const { sessionType, recordKey, series, recordIndex } = pending;
      const newName = input.trim();
      if (!newName) return replyEphemeral(ctx, TEXT.emptyInput);
      if (newName.length > 80) return replyEphemeral(ctx, TEXT.invalidStartFormat);

      const typeSessions = await getSessions(groupId, sessionType);
      const idx = typeSessions.findIndex((s) => archivedSessionKey(s) === recordKey);
      if (idx === -1) return replyEphemeral(ctx, TEXT.recordNotFoundForEdit);

      const oldName = typeSessions[idx].name;
      typeSessions[idx].name = newName;
      await saveSessions(groupId, sessionType, typeSessions);

      const nav = { ns: pending.ns || 'h', gref: pending.gref ?? groupId };
      const tz = getClassTimezone ? await getClassTimezone(groupId).catch(() => 'Africa/Cairo') : 'Africa/Cairo';
      const editor = renderHistorySessionEditor(groupId, series, recordIndex, typeSessions[idx], pending.memberPage || 0, { ...nav, tz });
      telegram.editMessageText(
        pending.chatId, pending.msgId, undefined,
        editor.text,
        { parse_mode: 'Markdown', ...editor.keyboard }
      ).catch((err) => logTelegramError('text.historyEditTitle.refreshEditor', err, {
        groupId,
        chatId: String(pending.chatId),
        messageId: pending.msgId,
      }));
      return replyEphemeral(ctx, TEXT.historyTitleEdited(oldName, newName), { parse_mode: 'Markdown' });
    }

    // ── Offline class force-reply flows ──────────────────────────────────────
    if (pending.action === 'offlineCreateClass') {
      const res = await createOfflineClass(pending.userId, input);
      if (!res.ok) {
        return replyEphemeral(ctx, res.reason === 'duplicate' ? TEXT.offline.duplicate : TEXT.offline.invalidName);
      }
      const cls = { groupId: res.groupId, name: res.name, rowId: res.rowId, ownerUserId: String(pending.userId) };
      const view = renderClassHome(cls);
      telegram.editMessageText(pending.chatId, pending.msgId, undefined, view.text, {
        parse_mode: 'Markdown', ...view.keyboard,
      }).catch((err) => logTelegramError('text.offlineCreateClass.refresh', err, {
        chatId: String(pending.chatId), messageId: pending.msgId,
      }));
      return replyEphemeral(ctx, TEXT.offline.created(res.name), { parse_mode: 'Markdown' });
    }

    if (pending.action === 'offlineRenameClass') {
      const res = await renameOfflineClass(groupId, input);
      if (!res.ok) {
        return replyEphemeral(ctx, res.reason === 'duplicate' ? TEXT.offline.duplicate : TEXT.offline.invalidName);
      }
      const cls = await getOfflineClassById(pending.gref);
      if (cls) {
        const view = renderClassHome(cls);
        telegram.editMessageText(pending.chatId, pending.msgId, undefined, view.text, {
          parse_mode: 'Markdown', ...view.keyboard,
        }).catch((err) => logTelegramError('text.offlineRenameClass.refresh', err, {
          chatId: String(pending.chatId), messageId: pending.msgId,
        }));
      }
      return replyEphemeral(ctx, TEXT.offline.renamed(res.name), { parse_mode: 'Markdown' });
    }

    if (pending.action === 'materialRename') {
      await renameMaterial(groupId, pending.materialId, input);
      const material = await getMaterialById(groupId, pending.materialId);
      if (material) {
        const view = materialMenuView(pending.surface === 'group' ? 'group' : 'offline', String(pending.token), material);
        telegram.editMessageText(pending.chatId, pending.msgId, undefined, view.text, {
          parse_mode: 'Markdown', ...view.keyboard,
        }).catch((err) => logTelegramError('text.materialRename.refresh', err, {
          chatId: String(pending.chatId), messageId: pending.msgId,
        }));
      }
      return replyEphemeral(ctx, TEXT.materials.renamed(input), { parse_mode: 'Markdown' });
    }

    if (pending.action === 'materialFileRename') {
      await renameMaterialFile(groupId, pending.materialId, pending.fileId, input);
      const material = await getMaterialById(groupId, pending.materialId);
      if (material) {
        const view = material.fileCount > 1
          ? materialFilesView(pending.surface === 'group' ? 'group' : 'offline', String(pending.token), material, 0)
          : materialMenuView(pending.surface === 'group' ? 'group' : 'offline', String(pending.token), material);
        telegram.editMessageText(pending.chatId, pending.msgId, undefined, view.text, {
          parse_mode: 'Markdown', ...view.keyboard,
        }).catch((err) => logTelegramError('text.materialFileRename.refresh', err, {
          chatId: String(pending.chatId), messageId: pending.msgId,
        }));
      }
      return replyEphemeral(ctx, TEXT.materials.fileRenamed(input), { parse_mode: 'Markdown' });
    }

    if (pending.action === 'offlineAddStudents') {
      const names = splitEntries(input);
      const res = await addOfflineStudents(groupId, names);
      if (!res.added) return replyEphemeral(ctx, TEXT.offline.noStudentsAdded);
      const cls = await getOfflineClassById(pending.gref);
      if (cls) {
        const refreshed = await getMaster(groupId);
        const view = renderRoster(cls, refreshed.members, 0);
        telegram.editMessageText(pending.chatId, pending.msgId, undefined, view.text, {
          parse_mode: 'Markdown', ...view.keyboard,
        }).catch((err) => logTelegramError('text.offlineAddStudents.refresh', err, {
          chatId: String(pending.chatId), messageId: pending.msgId,
        }));
      }
      return replyEphemeral(ctx, TEXT.offline.studentsAdded(res.added, res.skipped));
    }

    if (pending.action === 'offlineRenameStudent') {
      const res = await renameOfflineStudent(groupId, pending.listNumber, input);
      if (!res.ok) return replyEphemeral(ctx, TEXT.offline.studentNotFound);
      const cls = await getOfflineClassById(pending.gref);
      if (cls) {
        const refreshed = await getMaster(groupId);
        const view = renderRoster(cls, refreshed.members, pending.page || 0);
        telegram.editMessageText(pending.chatId, pending.msgId, undefined, view.text, {
          parse_mode: 'Markdown', ...view.keyboard,
        }).catch((err) => logTelegramError('text.offlineRenameStudent.refresh', err, {
          chatId: String(pending.chatId), messageId: pending.msgId,
        }));
      }
      return replyEphemeral(ctx, TEXT.offline.studentRenamed(res.name), { parse_mode: 'Markdown' });
    }

    if (pending.action === 'offlineAddTeacher') {
      const validTypes = ['courseteacher', 'trainingteacher', 'recitationteacher', 'homeworkteacher'];
      // Role chosen up front (bulk flow): every line is a plain teacher name.
      // Otherwise fall back to the `name | type` per-line format.
      const entries = (pending.role && validTypes.includes(pending.role))
        ? splitEntries(input)
          .map((name) => ({ name: name.trim(), types: [pending.role] }))
          .filter((e) => e.name)
        : splitEntries(input)
          .map((line) => {
            const [name, type] = line.split('|').map((s) => s.trim());
            return { name, types: [type] };
          })
          .filter((e) => e.name && validTypes.includes(e.types[0]));
      if (!entries.length) return replyEphemeral(ctx, TEXT.invalidTeacherType);
      const res = await addOfflineTeachers(groupId, entries);
      const cls = await getOfflineClassById(pending.gref);
      if (cls) {
        const list = await getTeachers(groupId);
        const view = renderTeachers(cls, list);
        telegram.editMessageText(pending.chatId, pending.msgId, undefined, view.text, {
          parse_mode: 'Markdown', ...view.keyboard,
        }).catch((err) => logTelegramError('text.offlineAddTeacher.refresh', err, {
          chatId: String(pending.chatId), messageId: pending.msgId,
        }));
      }
      return replyEphemeral(ctx, TEXT.offline.teachersAdded(res.added));
    }

    if (pending.action === 'offlineRenameTeacher') {
      const res = await renameOfflineTeacher(groupId, pending.teacherId, input);
      if (!res.ok) return replyEphemeral(ctx, TEXT.offline.teacherNotFound);
      const cls = await getOfflineClassById(pending.gref);
      if (cls) {
        const list = await getTeachers(groupId);
        const teacher = (list || []).find((t) => String(t.id) === String(pending.teacherId));
        const view = teacher
          ? renderTeacherMenu(cls, teacher)
          : renderTeachers(cls, list);
        telegram.editMessageText(pending.chatId, pending.msgId, undefined, view.text, {
          parse_mode: 'Markdown', ...view.keyboard,
        }).catch((err) => logTelegramError('text.offlineRenameTeacher.refresh', err, {
          chatId: String(pending.chatId), messageId: pending.msgId,
        }));
      }
      return replyEphemeral(ctx, TEXT.offline.teacherRenamed(res.name), { parse_mode: 'Markdown' });
    }

    if (pending.action === 'offlineAddManager') {
      const cls = await getOfflineClassById(pending.gref);
      if (!cls) return replyEphemeral(ctx, TEXT.offline.notFound);
      const uid = input.trim();
      if (!/^\d+$/.test(uid)) return replyEphemeral(ctx, TEXT.offline.invalidManagerId);
      if (uid === String(cls.ownerUserId)) return replyEphemeral(ctx, TEXT.offline.managerSelfNotAllowed);
      // Only the owner may create operators. If a delegate (operator) added this
      // manager, force the assistant role regardless of what the prompt carried.
      const isOwner = String(ctx.from.id) === String(cls.ownerUserId);
      const role = !isOwner ? 'assistant' : (pending.role === 'assistant' ? 'assistant' : 'operator');
      // Best-effort: resolve the manager's real name so the panel shows it
      // instead of her numeric id. getChat only works once she has interacted
      // with the bot; otherwise we fall back to the id until she opens the class.
      let displayName = null;
      try {
        const chat = await telegram.getChat(uid);
        if (chat) displayName = getDisplayName(chat);
      } catch { /* unknown user (hasn't started the bot yet) — keep the id */ }
      const res = await addClassManager(cls.rowId, uid, role, ctx.from.id, displayName);
      if (!res.ok) return replyEphemeral(ctx, TEXT.offline.invalidManagerId);
      const list = await listClassManagers(cls.rowId);
      const view = renderManagersMenu(cls, list);
      telegram.editMessageText(pending.chatId, pending.msgId, undefined, view.text, {
        parse_mode: 'Markdown', ...view.keyboard,
      }).catch((err) => logTelegramError('text.offlineAddManager.refresh', err, {
        chatId: String(pending.chatId), messageId: pending.msgId,
      }));
      return replyEphemeral(ctx, TEXT.offline.managerAdded(displayName || `#${uid}`, TEXT.offline.roleLabel(role)), { parse_mode: 'Markdown' });
    }

    if (pending.action === 'offlineRenameManager') {
      const cls = await getOfflineClassById(pending.gref);
      if (!cls) return replyEphemeral(ctx, TEXT.offline.notFound);
      const name = input.trim();
      if (!name) return replyEphemeral(ctx, TEXT.offline.managerNameRequired);
      await touchClassManagerName(cls.rowId, pending.uid, name);
      const list = await listClassManagers(cls.rowId);
      const manager = list.find((m) => String(m.userId) === String(pending.uid));
      if (manager) {
        const view = renderManagerMenu(cls, manager);
        telegram.editMessageText(pending.chatId, pending.msgId, undefined, view.text, {
          parse_mode: 'Markdown', ...view.keyboard,
        }).catch((err) => logTelegramError('text.offlineRenameManager.refresh', err, {
          chatId: String(pending.chatId), messageId: pending.msgId,
        }));
      }
      return replyEphemeral(ctx, TEXT.offline.managerRenamed(name), { parse_mode: 'Markdown' });
    }
    if (pending.action === 'offlineAddTrainingGroup') {
      const res = await addOfflineTrainingGroup(groupId, input);
      if (!res.ok) {
        if (res.reason === 'duplicate') return replyEphemeral(ctx, TEXT.offline.trainingGroupDuplicate);
        return replyEphemeral(ctx, TEXT.offline.trainingGroupInvalidName);
      }
      const cls = await getOfflineClassById(pending.gref);
      if (cls) {
        const list = await getOfflineTrainingGroups(groupId);
        const view = renderTrainingGroups(cls, list);
        telegram.editMessageText(pending.chatId, pending.msgId, undefined, view.text, {
          parse_mode: 'Markdown', ...view.keyboard,
        }).catch((err) => logTelegramError('text.offlineAddTrainingGroup.refresh', err, {
          chatId: String(pending.chatId), messageId: pending.msgId,
        }));
      }
      return replyEphemeral(ctx, TEXT.offline.trainingGroupAdded(res.group.name), { parse_mode: 'Markdown' });
    }

    if (pending.action === 'offlineRenameTrainingGroup') {
      const res = await renameOfflineTrainingGroup(groupId, pending.trainingGroupId, input);
      if (!res.ok) return replyEphemeral(ctx, TEXT.offline.trainingGroupNotFound);
      const cls = await getOfflineClassById(pending.gref);
      if (cls) {
        const list = await getOfflineTrainingGroups(groupId);
        const group = list.find((t) => String(t.id) === String(pending.trainingGroupId));
        const view = group
          ? renderTrainingGroupMenu(cls, group)
          : renderTrainingGroups(cls, list);
        telegram.editMessageText(pending.chatId, pending.msgId, undefined, view.text, {
          parse_mode: 'Markdown', ...view.keyboard,
        }).catch((err) => logTelegramError('text.offlineRenameTrainingGroup.refresh', err, {
          chatId: String(pending.chatId), messageId: pending.msgId,
        }));
      }
      return replyEphemeral(ctx, TEXT.offline.trainingGroupRenamed(res.name), { parse_mode: 'Markdown' });
    }
    if (pending.action === 'groupAddTeacher') {
      const validTypes = ['courseteacher', 'trainingteacher', 'recitationteacher', 'homeworkteacher'];
      const teachers = await getTeachers(groupId);
      const added = [];
      const failed = [];
      const roleFirst = pending.role && validTypes.includes(pending.role);
      for (const entry of splitEntries(input)) {
        const parts = entry.split('|').map((s) => s.trim());
        let rawId; let name; let type;
        if (roleFirst) {
          if (parts.length !== 2 || !parts[0] || !parts[1]) { failed.push(`\`${entry}\` – صيغة غير صحيحة`); continue; }
          [rawId, name] = parts;
          type = pending.role;
        } else {
          if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) { failed.push(`\`${entry}\` – صيغة غير صحيحة`); continue; }
          [rawId, name, type] = parts;
          if (!validTypes.includes(type)) { failed.push(`\`${entry}\` – نوع غير صالح`); continue; }
        }
        if (!/^\d+$/.test(rawId)) { failed.push(`\`${entry}\` – رقم الحساب غير صحيح`); continue; }
        if (teachers.find((t) => t.name === name)) { failed.push(`\`${name}\` – الاسم موجود مسبقاً`); continue; }
        if (teachers.find((t) => String(t.userId) === rawId)) { failed.push(`\`${rawId}\` – رقم الحساب مرتبط بمعلمة أخرى`); continue; }
        teachers.push({ userId: rawId, name, types: [type] });
        added.push(name);
      }
      if (added.length) await saveTeachers(groupId, teachers);
      const view = groupTeachersView(groupId, teachers);
      telegram.editMessageText(pending.chatId, pending.msgId, undefined, view.text, {
        parse_mode: 'Markdown', ...view.keyboard,
      }).catch((err) => logTelegramError('text.groupAddTeacher.refresh', err, {
        groupId, chatId: String(pending.chatId), messageId: pending.msgId,
      }));
      if (!added.length && !failed.length) return replyEphemeral(ctx, TEXT.invalidAddTeacherFormat);
      const lines = [];
      if (added.length) lines.push(`✅ تمت إضافة ${added.length}: ${added.join('، ')}`);
      if (failed.length) lines.push(`⚠️ لم تُضف:\n${failed.map((f) => `• ${f}`).join('\n')}`);
      return replyEphemeral(ctx, lines.join('\n\n'), { parse_mode: 'Markdown' });
    }

    if (pending.action === 'groupRenameTeacher') {
      const teachers = await getTeachers(groupId);
      const teacher = teachers.find((t) => String(t.userId) === String(pending.teacherUserId));
      if (!teacher) return replyEphemeral(ctx, TEXT.offline.teacherNotFound);
      const newName = input.trim();
      if (teachers.find((t) => t.name === newName && String(t.userId) !== String(teacher.userId))) {
        return replyEphemeral(ctx, TEXT.teacherNameTaken(newName), { parse_mode: 'Markdown' });
      }
      teacher.name = newName;
      await saveTeachers(groupId, teachers);
      const view = groupTeacherMenuView(groupId, teacher);
      telegram.editMessageText(pending.chatId, pending.msgId, undefined, view.text, {
        parse_mode: 'Markdown', ...view.keyboard,
      }).catch((err) => logTelegramError('text.groupRenameTeacher.refresh', err, {
        groupId, chatId: String(pending.chatId), messageId: pending.msgId,
      }));
      return replyEphemeral(ctx, TEXT.offline.teacherRenamed(newName), { parse_mode: 'Markdown' });
    }

    if (pending.action === 'groupAddTrainingGroup') {
      const sepIndex = input.indexOf('|');
      if (sepIndex === -1) return replyEphemeral(ctx, TEXT.invalidAddTrainingGroupFormat);
      const trainingGroupId = input.slice(0, sepIndex).trim();
      const trainingGroupName = input.slice(sepIndex + 1).trim();
      if (!/^-?\d+$/.test(trainingGroupId)) return replyEphemeral(ctx, TEXT.invalidTrainingGroupId);
      if (!trainingGroupName) return replyEphemeral(ctx, TEXT.invalidAddTrainingGroupFormat);

      const groups = await getTrainingGroups(groupId);
      const existing = groups.find((g) => String(g.groupId) === trainingGroupId);
      if (existing) existing.name = trainingGroupName;
      else groups.push({ groupId: trainingGroupId, name: trainingGroupName });
      await saveTrainingGroups(groupId, groups);
      // Link the training group to this main group (1:1 from the training side)
      // so walk-in students who self-register there backfill into this roster.
      await setParentGroup(trainingGroupId, groupId);

      const view = groupTrainingGroupsView(groupId, groups);
      telegram.editMessageText(pending.chatId, pending.msgId, undefined, view.text, {
        parse_mode: 'Markdown', ...view.keyboard,
      }).catch((err) => logTelegramError('text.groupAddTrainingGroup.refresh', err, {
        groupId, chatId: String(pending.chatId), messageId: pending.msgId,
      }));
      return replyEphemeral(ctx, TEXT.trainingGroupAdded(trainingGroupName, trainingGroupId), { parse_mode: 'Markdown' });
    }

    if (pending.action === 'groupRenameTrainingGroup') {
      const groups = await getTrainingGroups(groupId);
      const group = groups.find((g) => String(g.groupId) === String(pending.trainingGroupId));
      if (!group) return replyEphemeral(ctx, TEXT.manageHub.trainingGroupMissing);
      const newName = input.trim();
      if (!newName) return replyEphemeral(ctx, TEXT.emptyInput);
      group.name = newName;
      await saveTrainingGroups(groupId, groups);
      const view = groupTrainingGroupMenuView(groupId, group);
      telegram.editMessageText(pending.chatId, pending.msgId, undefined, view.text, {
        parse_mode: 'Markdown', ...view.keyboard,
      }).catch((err) => logTelegramError('text.groupRenameTrainingGroup.refresh', err, {
        groupId, chatId: String(pending.chatId), messageId: pending.msgId,
      }));
      return replyEphemeral(ctx, TEXT.manageHub.trainingGroupRenamedToast(newName), { parse_mode: 'Markdown' });
    }

    return next();
  }

  return { onText };
}

export function register(bot, storage) {
  const h = createHandlers({ storage, telegram: bot.telegram });
  bot.on('text', h.onText);
}
