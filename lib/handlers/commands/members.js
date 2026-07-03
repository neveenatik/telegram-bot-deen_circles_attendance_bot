import { isAdmin, isCreator } from '../../guards.js';
import { groupIdFromCtx, replyEphemeral, splitEntries, escapeTelegramMarkdown } from '../../helpers.js';
import { setPendingConfirm } from '../../confirmations.js';
import { TEXT } from '../../text.js';
import { membersText, membersKb, refreshSessionWidget, dismissKb, confirmKb } from '../../widgets.js';

export function register(bot, storage) {
  const { getMaster, saveMaster, getActiveSession, saveSession, getPendingRegistrations, savePendingRegistrations } = storage;

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

  bot.command('students', async (ctx) => {
    if (!await isAdmin(ctx)) return replyEphemeral(ctx, TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    const master = await getMaster(groupId);
    ctx.replyWithMarkdown(membersText(master), membersKb(master));
  });

  bot.command('pendingstudents', async (ctx) => {
    if (!await isAdmin(ctx)) return replyEphemeral(ctx, TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    const pending = await getPendingRegistrations(groupId);
    return ctx.replyWithMarkdown(pendingStudentsText(pending), pendingStudentsKb(pending));
  });

  bot.command('removestudents', async (ctx) => {
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
  });

  bot.command('addstudent', async (ctx) => {
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
          session.attendance[name] = null;
          if (session.called) session.called[name] = null;
        }
        await saveSession(groupId, type, session);
        await refreshSessionWidget(bot.telegram, session, master, async () => saveSession(groupId, type, session));
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
  });

  bot.command('removestudent', async (ctx) => {
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
        for (const name of removed) delete session.attendance[name];
        await saveSession(groupId, type, session);
        await refreshSessionWidget(bot.telegram, session, master, async () => saveSession(groupId, type, session));
      }
    }

    if (entries.length === 1 && removed.length === 1)
      return ctx.replyWithMarkdown(TEXT.memberDeleted(removed[0]), dismissKb());

    const lines = [];
    if (removed.length) lines.push(`✅ تم حذف ${removed.length}: ${removed.join('، ')}`);
    if (failed.length) lines.push(`⚠️ لم تُحذف:\n${failed.map(f => `• ${f}`).join('\n')}`);
    ctx.replyWithMarkdown(lines.join('\n\n'), dismissKb());
  });

  bot.command('renamestudent', async (ctx) => {
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
          if (oldName in session.attendance) {
            session.attendance[newName] = session.attendance[oldName];
            delete session.attendance[oldName];
          }
        }
        await saveSession(groupId, type, session);
        await refreshSessionWidget(bot.telegram, session, master, async () => saveSession(groupId, type, session));
      }
    }

    if (entries.length === 1 && renamed.length === 1)
      return ctx.replyWithMarkdown(TEXT.memberRenamed(renamed[0].oldName, renamed[0].newName), dismissKb());

    const lines = [];
    if (renamed.length) lines.push(`✅ تم تعديل ${renamed.length}:\n${renamed.map(r => `• \`${r.oldName}\` ← \`${r.newName}\``).join('\n')}`);
    if (failed.length) lines.push(`⚠️ لم تُعدَّل:\n${failed.map(f => `• ${f}`).join('\n')}`);
    ctx.replyWithMarkdown(lines.join('\n\n'), dismissKb());
  });
}
