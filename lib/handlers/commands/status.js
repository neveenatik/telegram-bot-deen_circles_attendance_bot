import { isAdmin } from '../../guards.js';
import { groupIdFromCtx } from '../../helpers.js';
import { TEXT } from '../../text.js';
import { rawSessionNames } from '../../widgets.js';

export function register(bot, storage) {
  const { getMaster, getSession } = storage;

  bot.command('status', async (ctx) => {
    if (!await isAdmin(ctx)) return ctx.reply(TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    const session = await getSession(groupId);
    const master  = await getMaster(groupId);
    if (!session)
      return ctx.reply(TEXT.statusNoSession(master.members.length));

    const counts = { present: 0, listening: 0, excused: 0, pending: 0 };
    const names = rawSessionNames(session, master);
    for (const name of names) {
      const k = session.attendance[name] || 'pending';
      counts[k] = (counts[k] || 0) + 1;
    }
    ctx.replyWithMarkdown(
      TEXT.statusReport({ name: session.name, ...counts }, names.length)
    );
  });
}
