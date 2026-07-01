import { isAdmin } from '../../guards.js';
import { groupIdFromCtx, replyEphemeral } from '../../helpers.js';
import { TEXT } from '../../text.js';
import { membersText, membersKb, refreshSessionWidget } from '../../widgets.js';

export function register(bot, storage) {
  const { getMaster, saveMaster, getSession, saveSession } = storage;

  bot.command('students', async (ctx) => {
    if (!await isAdmin(ctx)) return replyEphemeral(ctx, TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    const master = await getMaster(groupId);
    ctx.replyWithMarkdown(membersText(master), membersKb(master));
  });

  bot.command('addstudent', async (ctx) => {
    if (!await isAdmin(ctx)) return replyEphemeral(ctx, TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    const args  = ctx.message.text.split(' ').slice(1).join(' ');
    const parts = args.split('|').map(s => s.trim());
    if (parts.length !== 2 || !parts[0] || !parts[1])
      return replyEphemeral(ctx, TEXT.invalidAddFormat);

    const [rawId, name] = parts;
    if (!/^\d+$/.test(rawId))
      return replyEphemeral(ctx, TEXT.invalidUserId);
    const userId = rawId;

    const master = await getMaster(groupId);
    if (master.members.find(m => m.name === name))
      return replyEphemeral(ctx, TEXT.memberExists(name), { parse_mode: 'Markdown' });
    if (master.members.find(m => m.userId === userId))
      return replyEphemeral(ctx, TEXT.userIdLinked(userId));

    master.members.push({ userId, name });
    await saveMaster(groupId, master);

    const session = await getSession(groupId);
    if (session) {
      session.attendance[name] = null;
      if (session.called) session.called[name] = null;
      await saveSession(groupId, session);
      await refreshSessionWidget(bot.telegram, session, master);
    }
    replyEphemeral(ctx, TEXT.memberAdded(name, userId), { parse_mode: 'Markdown' });
  });

  bot.command('removestudent', async (ctx) => {
    if (!await isAdmin(ctx)) return replyEphemeral(ctx, TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    const name = ctx.message.text.split(' ').slice(1).join(' ').trim();
    if (!name) return replyEphemeral(ctx, TEXT.invalidRemoveFormat);

    const master = await getMaster(groupId);
    const idx = master.members.findIndex(m => m.name === name);
    if (idx === -1)
      return replyEphemeral(ctx, TEXT.memberNotInList(name), { parse_mode: 'Markdown' });

    master.members.splice(idx, 1);
    await saveMaster(groupId, master);

    const session = await getSession(groupId);
    if (session) {
      delete session.attendance[name];
      await saveSession(groupId, session);
      await refreshSessionWidget(bot.telegram, session, master);
    }
    replyEphemeral(ctx, TEXT.memberDeleted(name), { parse_mode: 'Markdown' });
  });

  bot.command('renamestudent', async (ctx) => {
    if (!await isAdmin(ctx)) return replyEphemeral(ctx, TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    const args  = ctx.message.text.split(' ').slice(1).join(' ');
    const parts = args.split('|').map(s => s.trim());
    if (parts.length !== 2 || !parts[0] || !parts[1])
      return replyEphemeral(ctx, TEXT.invalidRenameFormat);

    const [oldName, newName] = parts;
    const master = await getMaster(groupId);

    const entry = master.members.find(m => m.name === oldName);
    if (!entry)
      return replyEphemeral(ctx, TEXT.oldNameNotFound(oldName), { parse_mode: 'Markdown' });
    if (master.members.find(m => m.name === newName))
      return replyEphemeral(ctx, TEXT.nameTaken(newName), { parse_mode: 'Markdown' });

    entry.name = newName;
    await saveMaster(groupId, master);

    const session = await getSession(groupId);
    if (session && oldName in session.attendance) {
      session.attendance[newName] = session.attendance[oldName];
      delete session.attendance[oldName];
      await saveSession(groupId, session);
      await refreshSessionWidget(bot.telegram, session, master);
    }
    replyEphemeral(ctx, TEXT.memberRenamed(oldName, newName), { parse_mode: 'Markdown' });
  });
}
