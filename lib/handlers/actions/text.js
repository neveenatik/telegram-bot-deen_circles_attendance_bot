import { groupIdFromCtx, formatPages, parsePageInput } from '../../helpers.js';
import { TEXT } from '../../text.js';
import { membersText, membersKb, manageText, manageKb, refreshSessionWidget } from '../../widgets.js';

export function register(bot, storage) {
  const {
    getAwaiting, delAwaiting, getMaster, saveMaster,
    getSession, saveSession, getPageProgress, savePageProgress,
  } = storage;

  // Helper to find active session type
  async function getActiveSessionType(groupId) {
    const types = ['main', 'open', 'registeredSecondary', 'personalRecitation', 'groupRecitation'];
    for (const type of types) {
      const session = await getSession(groupId, type);
      if (session && session.active) return type;
    }
    return null;
  }

  bot.on('text', async (ctx) => {
    if (ctx.message.text.startsWith('/')) return;

    const groupId = groupIdFromCtx(ctx);
    const uid     = String(ctx.from.id);
    const pending = await getAwaiting(groupId, uid);
    if (!pending) return;

    if (pending.awaitingPrompt && !pending.promptMsgId) {
      return ctx.reply('⏳ جاري تجهيز رسالة الإدخال، من فضلك انتظري لحظة ثم أرسلي الرد على الرسالة نفسها.');
    }

    if (pending.promptMsgId) {
      const replyId = ctx.message.reply_to_message?.message_id;
      if (replyId !== pending.promptMsgId)
        return ctx.reply(TEXT.replyToPromptOnly);
    }

    await delAwaiting(groupId, uid);
    const input = ctx.message.text.trim();
    if (!input) return ctx.reply(TEXT.emptyInput);

    const master = await getMaster(groupId);

    if (pending.action === 'add') {
      const parts = input.split('|').map(s => s.trim());
      if (parts.length !== 2 || !parts[0] || !parts[1])
        return ctx.reply(TEXT.inlineInvalidAddFormat);

      const [rawId, newName] = parts;
      if (!/^\d+$/.test(rawId))
        return ctx.reply(TEXT.invalidUserId);
      const userId = rawId;

      if (master.members.find(m => m.name === newName))
        return ctx.reply(TEXT.memberExists(newName), { parse_mode: 'Markdown' });
      if (master.members.find(m => m.userId === userId))
        return ctx.reply(TEXT.userIdLinked(userId));

      master.members.push({ userId, name: newName });
      await saveMaster(groupId, master);

      const activeType = await getActiveSessionType(groupId);
      if (activeType) {
        const session = await getSession(groupId, activeType);
        if (session) {
          session.attendance[newName] = null;
          await saveSession(groupId, activeType, session);
          await refreshSessionWidget(bot.telegram, session, master);
        }
      }

      ctx.reply(TEXT.memberAdded(newName, userId), { parse_mode: 'Markdown' });
      bot.telegram.editMessageText(
        pending.chatId, pending.msgId, undefined,
        membersText(master),
        { parse_mode: 'Markdown', ...membersKb(master) }
      ).catch(() => {});
    }

    if (pending.action === 'rename') {
      const { oldName } = pending;
      const newName = input;

      if (master.members.find(m => m.name === newName))
        return ctx.reply(TEXT.nameTaken(newName), { parse_mode: 'Markdown' });

      const entry = master.members.find(m => m.name === oldName);
      if (!entry)
        return ctx.reply(TEXT.memberGone(oldName), { parse_mode: 'Markdown' });

      entry.name = newName;
      await saveMaster(groupId, master);

      const activeType = await getActiveSessionType(groupId);
      if (activeType) {
        const session = await getSession(groupId, activeType);
        if (session && oldName in session.attendance) {
          session.attendance[newName] = session.attendance[oldName];
          delete session.attendance[oldName];
          if (session.called && oldName in session.called) {
            session.called[newName] = session.called[oldName];
            delete session.called[oldName];
          }
          if (session.pages && oldName in session.pages) {
            session.pages[newName] = session.pages[oldName];
            delete session.pages[oldName];
          }
          if (session.registrationTimes && oldName in session.registrationTimes) {
            session.registrationTimes[newName] = session.registrationTimes[oldName];
            delete session.registrationTimes[oldName];
          }
          await saveSession(groupId, activeType, session);
          await refreshSessionWidget(bot.telegram, session, master);
        }
      }

      ctx.reply(TEXT.memberRenamed(oldName, newName), { parse_mode: 'Markdown' });
      bot.telegram.editMessageText(
        pending.chatId, pending.msgId, undefined,
        membersText(master),
        { parse_mode: 'Markdown', ...membersKb(master) }
      ).catch(() => {});
    }

    if (pending.action === 'addGuest') {
      const newName = input;
      const activeType = await getActiveSessionType(groupId);
      if (!activeType) return ctx.reply(TEXT.noSessionActive);
      const session = await getSession(groupId, activeType);
      if (!session) return ctx.reply(TEXT.noSessionActive);
      if (session.attendance && newName in session.attendance)
        return ctx.reply(TEXT.guestExistsInSession(newName), { parse_mode: 'Markdown' });

      if (!session.attendance) session.attendance = {};
      session.attendance[newName] = null;
      if (!session.called) session.called = {};
      session.called[newName] = null;
      if (!session.registrationTimes) session.registrationTimes = {};
      session.registrationTimes[newName] = Date.now();
      
      // Assign pages for page list and group recitation sessions
      if (session.type === 'personalRecitation') {
        const progress = await getPageProgress(groupId);
        if (!session.pages) session.pages = {};
        session.pages[newName] = (Number(progress[newName]) || 0) + 1;
      }
      
      if (session.type === 'groupRecitation') {
        if (!session.pages) session.pages = {};
        if (!session.groupRecitationStartPage) session.groupRecitationStartPage = 1;
        session.pages[newName] = session.groupRecitationStartPage;
        session.groupRecitationStartPage += 1;
      }
      
      await saveSession(groupId, activeType, session);

      await refreshSessionWidget(bot.telegram, session, master);
      bot.telegram.editMessageText(
        pending.chatId, pending.msgId, undefined,
        manageText(session, master),
        { parse_mode: 'Markdown', ...manageKb(session, master) }
      ).catch(() => {});
      return ctx.reply(TEXT.guestAddedToSession(newName), { parse_mode: 'Markdown' });
    }

    if (pending.action === 'editPage') {
      const { memberName } = pending;
      const parsedPage = parsePageInput(input.trim());
      if (!parsedPage)
        return ctx.reply(TEXT.invalidPageNumber);

      const activeType = await getActiveSessionType(groupId);
      if (!activeType) return ctx.reply(TEXT.noSessionActive);
      const session = await getSession(groupId, activeType);
      if (!session) return ctx.reply(TEXT.noSessionActive);
      if (!session.pages) session.pages = {};

      session.pages[memberName] = parsedPage;
      await saveSession(groupId, activeType, session);

      const progress = await getPageProgress(groupId);
      progress[memberName] = parsedPage;
      await savePageProgress(groupId, progress);

      await refreshSessionWidget(bot.telegram, session, master);
      bot.telegram.editMessageText(
        pending.chatId, pending.msgId, undefined,
        manageText(session, master),
        { parse_mode: 'Markdown', ...manageKb(session, master) }
      ).catch(() => {});
      return ctx.reply(TEXT.pageEditedSuccess(memberName, formatPages(parsedPage)), { parse_mode: 'Markdown' });
    }
  });
}
