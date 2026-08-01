import { isAdmin } from '../../guards.js';
import { groupIdFromCtx, replyEphemeral } from '../../helpers.js';
import { TEXT } from '../../text.js';
import { rawSessionNames } from '../../widgets.js';
import * as participants from '../../sessionParticipants.js';

export function createHandlers({ storage }) {
  const { getMaster, getActiveSession } = storage;

  async function status(ctx) {
    if (!await isAdmin(ctx)) return replyEphemeral(ctx, TEXT.adminOnly);
    const groupId = groupIdFromCtx(ctx);
    const activeSession = await getActiveSession(groupId);
    const session = activeSession?.session || null;
    const master  = await getMaster(groupId);
    if (!session)
      return replyEphemeral(ctx, TEXT.statusNoSession(groupId, master.members.length));

    const counts = { present: 0, listening: 0, excused: 0, pending: 0 };
    const names = rawSessionNames(session, master);
    for (const name of names) {
      const k = participants.getStatus(session, name) || 'pending';
      counts[k] = (counts[k] || 0) + 1;
    }
    ctx.replyWithMarkdown(
      TEXT.statusReport({ name: session.name, ...counts }, names.length)
    );
  }

  return { status };
}

export function register(bot, storage) {
  const h = createHandlers({ storage });
  bot.command('status', h.status);
}
