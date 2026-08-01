import { isAdmin } from '../../guards.js';
import { groupIdFromCtx, replyEphemeral } from '../../helpers.js';
import { TEXT } from '../../text.js';

export function createHandlers({ storage }) {
  const { getMaster } = storage;

  async function tagstudents(ctx) {
    if (!await isAdmin(ctx)) return replyEphemeral(ctx, TEXT.adminOnly);

    const groupId = groupIdFromCtx(ctx);
    const master = await getMaster(groupId);
    
    if (!master.members || master.members.length === 0) {
      return replyEphemeral(ctx, TEXT.emptyMembers);
    }

    // Build mention strings for all registered students
    // Format: [name](tg://user/userId) creates clickable mention link
    const mentions = master.members
      .map(member => `[${member.name}](tg://user/${member.userId})`)
      .join('\n');

    const message = `📢 *انتباه الجميع*\n\n${mentions}\n\nهناك إعلان مهم! يرجى الانتظار لقراءة التفاصيل.`;
    
    await ctx.replyWithMarkdown(message);
  }

  return { tagstudents };
}

export function register(bot, storage) {
  const h = createHandlers({ storage });
  bot.command('tagstudents', h.tagstudents);
}
