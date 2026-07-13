import { isAdmin, isCreator } from '../../guards.js';
import { groupIdFromCtx, replyEphemeral, splitEntries, logTelegramError } from '../../helpers.js';
import { setPendingConfirm } from '../../confirmations.js';
import { TEXT } from '../../text.js';
import { membersText, membersKb, refreshSessionWidget as defaultRefreshSessionWidget, dismissKb, confirmKb } from '../../widgets.js';
import { pendingStudentsText, pendingStudentsKb } from '../actions/members.js';
import * as participants from '../../sessionParticipants.js';

export function createHandlers({ storage, telegram, refreshSessionWidget = defaultRefreshSessionWidget }) {
  const { getMaster, saveMaster, getActiveSession, saveSession, getPendingRegistrations, savePendingRegistrations } = storage;

  async function dmNudge(ctx, groupId, startPayload) {
    let username = ctx.botInfo?.username;
    if (!username) {
      try { username = (await telegram.getMe())?.username; } catch { username = null; }
    }
    const link = username ? `https://t.me/${username}?start=${startPayload}` : null;
    await replyEphemeral(ctx, TEXT.startBotInDmNudge(link));
    return link;
  }

  async function students(ctx) {
    if (!await isAdmin(ctx)) return replyEphemeral(ctx, TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    const master = await getMaster(groupId);
    // Admin control surface — deliver privately so taps can't hit the wrong
    // record in a busy group. Buttons carry groupId, so edits still apply here.
    try {
      await telegram.sendMessage(ctx.from.id, membersText(master), {
        parse_mode: 'Markdown',
        ...membersKb(groupId, master),
      });
      await replyEphemeral(ctx, TEXT.panelSentToDm);
    } catch (err) {
      await dmNudge(ctx, groupId, 'students');
      logTelegramError('members.students.dmSend', err, { chatId: String(groupId) });
    }
  }

  async function pendingstudents(ctx) {
    if (!await isAdmin(ctx)) return replyEphemeral(ctx, TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    const pending = await getPendingRegistrations(groupId);
    try {
      await telegram.sendMessage(ctx.from.id, pendingStudentsText(pending), {
        parse_mode: 'Markdown',
        ...pendingStudentsKb(groupId, pending),
      });
      await replyEphemeral(ctx, TEXT.panelSentToDm);
    } catch (err) {
      await dmNudge(ctx, groupId, 'pendingstudents');
      logTelegramError('members.pendingstudents.dmSend', err, { chatId: String(groupId) });
    }
  }

  async function removestudents(ctx) {
    if (!await isCreator(ctx)) return replyEphemeral(ctx, TEXT.creatorOnly);
    const groupId = groupIdFromCtx(ctx);
    const master = await getMaster(groupId);
    const count = Array.isArray(master.members) ? master.members.length : 0;
    if (!count) return replyEphemeral(ctx, TEXT.noStudentsToRemove);

    const token = setPendingConfirm(ctx.from.id, {
      action: 'removeAllStudents',
      groupId,
    });

    return ctx.replyWithMarkdown(
      TEXT.confirmPrompt(`حذف جميع الطالبات المسجلات (${count}) من القائمة الحالية`),
      confirmKb(token)
    );
  }

  async function addstudent(ctx) {
    if (!await isAdmin(ctx)) return replyEphemeral(ctx, TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    const commandInput = ctx.message.text.split(' ').slice(1).join(' ').trim();
    if (!commandInput) return replyEphemeral(ctx, TEXT.invalidAddFormat);

    const entries = splitEntries(commandInput);
    const master = await getMaster(groupId);
    const added = [];
    const failed = [];

    for (const entry of entries) {
      const parts = entry.split('|').map(s => s.trim());
      if (parts.length !== 2 || !parts[0] || !parts[1]) {
        failed.push(`\`${entry}\` – صيغة غير صحيحة`);
        continue;
      }
      const [rawId, name] = parts;
      if (!/^\d+$/.test(rawId)) {
        failed.push(`\`${entry}\` – رقم الحساب غير صحيح`);
        continue;
      }
      if (master.members.find(m => m.name === name)) {
        failed.push(`\`${name}\` – الاسم موجود مسبقاً`);
        continue;
      }
      if (master.members.find(m => m.userId === rawId)) {
        failed.push(`\`${rawId}\` – رقم الحساب مرتبط بطالبة أخرى`);
        continue;
      }
      master.members.push({ userId: rawId, name });
      added.push({ userId: rawId, name });
    }

    if (added.length) {
      await saveMaster(groupId, master);
      const pending = await getPendingRegistrations(groupId);
      const nextPending = pending.filter((row) => !added.some((item) => item.userId === row.userId || item.name === row.name));
      if (nextPending.length !== pending.length) {
        await savePendingRegistrations(groupId, nextPending);
      }
      const activeSession = await getActiveSession(groupId);
      if (activeSession?.session) {
        const { type, session } = activeSession;
        for (const { name } of added) {
          participants.setStatus(session, name, null);
          participants.setCalled(session, name, null);
        }
        await saveSession(groupId, type, session);
        await refreshSessionWidget(telegram, session, master, async () => saveSession(groupId, type, session));
      }
    }

    // Single entry success: short ephemeral
    if (entries.length === 1 && added.length === 1) {
      return replyEphemeral(ctx, TEXT.memberAdded(added[0].name, added[0].userId), { parse_mode: 'Markdown' });
    }

    // Single entry failure or multiple entries: dismissible message
    const lines = [];
    if (added.length) lines.push(`✅ تمت إضافة ${added.length}: ${added.map(a => a.name).join('، ')}`);
    if (failed.length) lines.push(`⚠️ لم تُضف:\n${failed.map(f => `• ${f}`).join('\n')}`);
    ctx.replyWithMarkdown(lines.join('\n\n'), dismissKb());
  }

  async function removestudent(ctx) {
    if (!await isAdmin(ctx)) return replyEphemeral(ctx, TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    const commandInput = ctx.message.text.split(' ').slice(1).join(' ').trim();
    if (!commandInput) return replyEphemeral(ctx, TEXT.invalidRemoveFormat);

    const entries = splitEntries(commandInput);
    const master = await getMaster(groupId);
    const removed = [];
    const failed = [];

    for (const name of entries) {
      const idx = master.members.findIndex(m => m.name === name);
      if (idx === -1) { failed.push(`\`${name}\` – غير موجودة`); continue; }
      master.members.splice(idx, 1);
      removed.push(name);
    }

    if (removed.length) {
      await saveMaster(groupId, master);
      const activeSession = await getActiveSession(groupId);
      if (activeSession?.session) {
        const { type, session } = activeSession;
        for (const name of removed) participants.remove(session, name);
        await saveSession(groupId, type, session);
        await refreshSessionWidget(telegram, session, master, async () => saveSession(groupId, type, session));
      }
    }

    if (entries.length === 1 && removed.length === 1)
      return ctx.replyWithMarkdown(TEXT.memberDeleted(removed[0]), dismissKb());

    const lines = [];
    if (removed.length) lines.push(`✅ تم حذف ${removed.length}: ${removed.join('، ')}`);
    if (failed.length) lines.push(`⚠️ لم تُحذف:\n${failed.map(f => `• ${f}`).join('\n')}`);
    ctx.replyWithMarkdown(lines.join('\n\n'), dismissKb());
  }

  async function renamestudent(ctx) {
    if (!await isAdmin(ctx)) return replyEphemeral(ctx, TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    const commandInput = ctx.message.text.split(' ').slice(1).join(' ').trim();
    if (!commandInput) return replyEphemeral(ctx, TEXT.invalidRenameFormat);

    const entries = splitEntries(commandInput);
    const master = await getMaster(groupId);
    const renamed = [];
    const failed = [];

    for (const entry of entries) {
      const parts = entry.split('|').map(s => s.trim());
      if (parts.length !== 2 || !parts[0] || !parts[1]) {
        failed.push(`\`${entry}\` – صيغة غير صحيحة`); continue;
      }
      const [oldName, newName] = parts;
      if (!master.members.find(m => m.name === oldName)) {
        failed.push(`\`${oldName}\` – غير موجودة`); continue;
      }
      if (master.members.find(m => m.name === newName)) {
        failed.push(`\`${newName}\` – الاسم مستخدم مسبقاً`); continue;
      }
      master.members.find(m => m.name === oldName).name = newName;
      renamed.push({ oldName, newName });
    }

    if (renamed.length) {
      await saveMaster(groupId, master);
      const activeSession = await getActiveSession(groupId);
      if (activeSession?.session) {
        const { type, session } = activeSession;
        for (const { oldName, newName } of renamed) {
          participants.rename(session, oldName, newName);
        }
        await saveSession(groupId, type, session);
        await refreshSessionWidget(telegram, session, master, async () => saveSession(groupId, type, session));
      }
    }

    if (entries.length === 1 && renamed.length === 1)
      return ctx.replyWithMarkdown(TEXT.memberRenamed(renamed[0].oldName, renamed[0].newName), dismissKb());

    const lines = [];
    if (renamed.length) lines.push(`✅ تم تعديل ${renamed.length}:\n${renamed.map(r => `• \`${r.oldName}\` ← \`${r.newName}\``).join('\n')}`);
    if (failed.length) lines.push(`⚠️ لم تُعدَّل:\n${failed.map(f => `• ${f}`).join('\n')}`);
    ctx.replyWithMarkdown(lines.join('\n\n'), dismissKb());
  }

  return { students, pendingstudents, removestudents, addstudent, removestudent, renamestudent };
}

export function register(bot, storage) {
  const h = createHandlers({ storage, telegram: bot.telegram });
  bot.command('students', h.students);
  bot.command('pendingstudents', h.pendingstudents);
  bot.command('removestudents', h.removestudents);
  bot.command('addstudent', h.addstudent);
  bot.command('removestudent', h.removestudent);
  bot.command('renamestudent', h.renamestudent);
}
