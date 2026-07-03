import { isAdmin } from '../../guards.js';
import { getDisplayName, groupIdFromCtx, replyEphemeral, splitEntries } from '../../helpers.js';
import { TEXT } from '../../text.js';
import { dismissKb } from '../../widgets.js';

const VALID_TYPES = ['courseteacher', 'trainingteacher', 'recitationteacher'];

const typeLabel = {
  courseteacher:     '📖 معلمة الدورة',
  trainingteacher:   '🏋️ معلمة التدريب',
  recitationteacher: '🎙️ معلمة التلاوة',
};

function teacherListText(teachers) {
  if (!teachers.length) return TEXT.emptyTeachers;
  const grouped = {};
  for (const t of teachers) {
    if (!grouped[t.type]) grouped[t.type] = [];
    grouped[t.type].push(t);
  }
  let text = '*📋 قائمة المعلمات*\n\n';
  for (const type of VALID_TYPES) {
    if (!grouped[type]?.length) continue;
    text += `*${typeLabel[type]}:*\n`;
    grouped[type].forEach((t, i) => {
      text += `${i + 1}. [${t.name}](tg://user/${t.userId})\n`;
    });
    text += '\n';
  }
  return text.trim();
}

export function register(bot, storage) {
  const { getTeachers, saveTeachers } = storage;

  // /addteacher [userId] | [name] | [type]
  bot.command('addteacher', async (ctx) => {
    if (!await isAdmin(ctx)) return replyEphemeral(ctx, TEXT.adminOnly);

    const groupId = groupIdFromCtx(ctx);
    const commandInput = ctx.message.text.split(' ').slice(1).join(' ').trim();
    if (!commandInput) return replyEphemeral(ctx, TEXT.invalidAddTeacherFormat);

    const entries = splitEntries(commandInput);
    const teachers = await getTeachers(groupId);
    const added = [];
    const failed = [];

    for (const entry of entries) {
      const parts = entry.split('|').map(s => s.trim());
      if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
        failed.push(`\`${entry}\` – صيغة غير صحيحة`); continue;
      }
      const [rawId, name, type] = parts;
      if (!/^\d+$/.test(rawId)) { failed.push(`\`${entry}\` – رقم الحساب غير صحيح`); continue; }
      if (!VALID_TYPES.includes(type)) { failed.push(`\`${entry}\` – نوع غير صالح`); continue; }
      if (teachers.find(t => t.name === name)) { failed.push(`\`${name}\` – الاسم موجود مسبقاً`); continue; }
      teachers.push({ userId: rawId, name, type });
      added.push({ name, label: typeLabel[type] });
    }

    if (added.length) await saveTeachers(groupId, teachers);

    if (entries.length === 1 && added.length === 1)
      return ctx.replyWithMarkdown(TEXT.teacherAdded(added[0].name, added[0].label), dismissKb());

    const lines = [];
    if (added.length) lines.push(`✅ تمت إضافة ${added.length}: ${added.map(a => a.name).join('، ')}`);
    if (failed.length) lines.push(`⚠️ لم تُضف:\n${failed.map(f => `• ${f}`).join('\n')}`);
    ctx.replyWithMarkdown(lines.join('\n\n'), dismissKb());
  });

  // /addteacherreply [type] (use as a reply to teacher's message)
  bot.command('addteacherreply', async (ctx) => {
    if (!await isAdmin(ctx)) return replyEphemeral(ctx, TEXT.adminOnly);

    const groupId = groupIdFromCtx(ctx);
    const type = ctx.message.text.split(' ').slice(1).join(' ').trim();
    if (!VALID_TYPES.includes(type)) return replyEphemeral(ctx, TEXT.invalidTeacherType);

    const repliedUser = ctx.message.reply_to_message?.from;
    if (!repliedUser?.id) return replyEphemeral(ctx, TEXT.invalidAddTeacherReplyFormat);
    if (repliedUser.is_bot) return replyEphemeral(ctx, TEXT.invalidAddTeacherReplyTarget);

    const teachers = await getTeachers(groupId);
    const userId = String(repliedUser.id);
    const name = getDisplayName(repliedUser);

    const existingById = teachers.find((t) => String(t.userId) === userId);
    if (existingById) return replyEphemeral(ctx, TEXT.teacherUserIdTaken(userId));

    if (teachers.find((t) => t.name === name)) {
      return replyEphemeral(ctx, TEXT.teacherNameTaken(name), { parse_mode: 'Markdown' });
    }

    teachers.push({ userId, name, type });
    await saveTeachers(groupId, teachers);
    return ctx.replyWithMarkdown(TEXT.teacherAdded(name, typeLabel[type]), dismissKb());
  });

  // /removeteacher [name]
  bot.command('removeteacher', async (ctx) => {
    if (!await isAdmin(ctx)) return replyEphemeral(ctx, TEXT.adminOnly);

    const groupId = groupIdFromCtx(ctx);
    const commandInput = ctx.message.text.split(' ').slice(1).join(' ').trim();
    if (!commandInput) return replyEphemeral(ctx, TEXT.invalidRemoveTeacherFormat);

    const entries = splitEntries(commandInput);
    const teachers = await getTeachers(groupId);
    const removed = [];
    const failed = [];

    for (const name of entries) {
      const idx = teachers.findIndex(t => t.name === name);
      if (idx === -1) { failed.push(`\`${name}\` – غير موجودة`); continue; }
      teachers.splice(idx, 1);
      removed.push(name);
    }

    if (removed.length) await saveTeachers(groupId, teachers);

    if (entries.length === 1 && removed.length === 1)
      return ctx.replyWithMarkdown(TEXT.teacherRemoved(removed[0]), dismissKb());

    const lines = [];
    if (removed.length) lines.push(`✅ تم حذف ${removed.length}: ${removed.join('، ')}`);
    if (failed.length) lines.push(`⚠️ لم تُحذف:\n${failed.map(f => `• ${f}`).join('\n')}`);
    ctx.replyWithMarkdown(lines.join('\n\n'), dismissKb());
  });

  // /assignteacher [name] | [type]
  bot.command('assignteacher', async (ctx) => {
    if (!await isAdmin(ctx)) return replyEphemeral(ctx, TEXT.adminOnly);

    const groupId = groupIdFromCtx(ctx);
    const commandInput = ctx.message.text.split(' ').slice(1).join(' ').trim();
    if (!commandInput) return replyEphemeral(ctx, TEXT.invalidAssignTeacherFormat);

    const entries = splitEntries(commandInput);
    const teachers = await getTeachers(groupId);
    const assigned = [];
    const failed = [];

    for (const entry of entries) {
      const parts = entry.split('|').map(s => s.trim());
      if (parts.length !== 2 || !parts[0] || !parts[1]) {
        failed.push(`\`${entry}\` – صيغة غير صحيحة`); continue;
      }
      const [name, type] = parts;
      if (!VALID_TYPES.includes(type)) { failed.push(`\`${entry}\` – نوع غير صالح`); continue; }
      const teacher = teachers.find(t => t.name === name);
      if (!teacher) { failed.push(`\`${name}\` – غير موجودة`); continue; }
      teacher.type = type;
      assigned.push({ name, label: typeLabel[type] });
    }

    if (assigned.length) await saveTeachers(groupId, teachers);

    if (entries.length === 1 && assigned.length === 1)
      return ctx.replyWithMarkdown(TEXT.teacherAssigned(assigned[0].name, assigned[0].label), dismissKb());

    const lines = [];
    if (assigned.length) lines.push(`✅ تم تحديث ${assigned.length}:\n${assigned.map(a => `• \`${a.name}\` ← ${a.label}`).join('\n')}`);
    if (failed.length) lines.push(`⚠️ لم تُحدَّث:\n${failed.map(f => `• ${f}`).join('\n')}`);
    ctx.replyWithMarkdown(lines.join('\n\n'), dismissKb());
  });

  // /listteachers
  bot.command('listteachers', async (ctx) => {
    if (!await isAdmin(ctx)) return replyEphemeral(ctx, TEXT.adminOnly);

    const groupId = groupIdFromCtx(ctx);
    const teachers = await getTeachers(groupId);
    return ctx.replyWithMarkdown(teacherListText(teachers));
  });

  // /tagteachers [type] — mention teachers by type
  bot.command('tagteachers', async (ctx) => {
    if (!await isAdmin(ctx)) return replyEphemeral(ctx, TEXT.adminOnly);

    const groupId = groupIdFromCtx(ctx);
    const type = ctx.message.text.split(' ').slice(1).join(' ').trim();

    if (type && !VALID_TYPES.includes(type)) {
      return replyEphemeral(ctx, TEXT.invalidTeacherType);
    }

    const teachers = await getTeachers(groupId);
    const filtered = type ? teachers.filter(t => t.type === type) : teachers;

    if (filtered.length === 0) {
      return type
        ? replyEphemeral(ctx, TEXT.noTeachersOfType(typeLabel[type]))
        : replyEphemeral(ctx, TEXT.emptyTeachers);
    }

    // Build mention strings
    const mentions = filtered
      .map(t => `[${t.name}](tg://user/${t.userId})`)
      .join(' ');

    const message = `📢 *انتباه المعلمات*\n\n${mentions}\n\nهناك إعلان مهم! يرجى الانتظار لقراءة التفاصيل.`;

    await ctx.replyWithMarkdown(message);
  });
}
