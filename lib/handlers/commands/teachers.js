import { isAdmin } from '../../guards.js';
import { groupIdFromCtx, replyEphemeral } from '../../helpers.js';
import { TEXT } from '../../text.js';

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
    const args = ctx.message.text.split(' ').slice(1).join(' ');
    const parts = args.split('|').map(s => s.trim());

    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2])
      return replyEphemeral(ctx, TEXT.invalidAddTeacherFormat);

    const [rawId, name, type] = parts;
    if (!/^\d+$/.test(rawId))
      return replyEphemeral(ctx, TEXT.invalidUserId);
    if (!VALID_TYPES.includes(type))
      return replyEphemeral(ctx, TEXT.invalidTeacherType);

    const teachers = await getTeachers(groupId);
    if (teachers.find(t => t.name === name))
      return replyEphemeral(ctx, TEXT.teacherNameTaken(name));

    teachers.push({ userId: rawId, name, type });
    await saveTeachers(groupId, teachers);
    return ctx.replyWithMarkdown(TEXT.teacherAdded(name, typeLabel[type]));
  });

  // /removeteacher [name]
  bot.command('removeteacher', async (ctx) => {
    if (!await isAdmin(ctx)) return replyEphemeral(ctx, TEXT.adminOnly);

    const groupId = groupIdFromCtx(ctx);
    const name = ctx.message.text.split(' ').slice(1).join(' ').trim();
    if (!name) return replyEphemeral(ctx, TEXT.invalidRemoveTeacherFormat);

    const teachers = await getTeachers(groupId);
    const idx = teachers.findIndex(t => t.name === name);
    if (idx === -1) return replyEphemeral(ctx, TEXT.teacherNotFound(name));

    teachers.splice(idx, 1);
    await saveTeachers(groupId, teachers);
    return ctx.replyWithMarkdown(TEXT.teacherRemoved(name));
  });

  // /assignteacher [name] | [type]  — change a teacher's type
  bot.command('assignteacher', async (ctx) => {
    if (!await isAdmin(ctx)) return replyEphemeral(ctx, TEXT.adminOnly);

    const groupId = groupIdFromCtx(ctx);
    const args = ctx.message.text.split(' ').slice(1).join(' ');
    const parts = args.split('|').map(s => s.trim());

    if (parts.length !== 2 || !parts[0] || !parts[1])
      return replyEphemeral(ctx, TEXT.invalidAssignTeacherFormat);

    const [name, type] = parts;
    if (!VALID_TYPES.includes(type))
      return replyEphemeral(ctx, TEXT.invalidTeacherType);

    const teachers = await getTeachers(groupId);
    const teacher = teachers.find(t => t.name === name);
    if (!teacher) return replyEphemeral(ctx, TEXT.teacherNotFound(name));

    teacher.type = type;
    await saveTeachers(groupId, teachers);
    return ctx.replyWithMarkdown(TEXT.teacherAssigned(name, typeLabel[type]));
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

    if (!type) {
      return replyEphemeral(ctx, TEXT.invalidTagTeacherFormat);
    }

    if (!VALID_TYPES.includes(type)) {
      return replyEphemeral(ctx, TEXT.invalidTeacherType);
    }

    const teachers = await getTeachers(groupId);
    const filtered = teachers.filter(t => t.type === type);

    if (filtered.length === 0) {
      return replyEphemeral(ctx, TEXT.noTeachersOfType(typeLabel[type]));
    }

    // Build mention strings
    const mentions = filtered
      .map(t => `[${t.name}](tg://user/${t.userId})`)
      .join(' ');

    const message = `📢 *انتباه المعلمات*\n\n${mentions}\n\nهناك إعلان مهم! يرجى الانتظار لقراءة التفاصيل.`;

    await ctx.replyWithMarkdown(message);
  });
}
