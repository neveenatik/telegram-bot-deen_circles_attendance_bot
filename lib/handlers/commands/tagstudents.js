import { isAdmin } from '../../guards.js';
import { groupIdFromCtx } from '../../helpers.js';
import { TEXT } from '../../text.js';

export function register(bot, storage) {
  const { getMaster } = storage;

  bot.command('tagstudents', async (ctx) => {
    if (!await isAdmin(ctx)) return ctx.reply(TEXT.adminOnly);

    const groupId = groupIdFromCtx(ctx);
    const master = await getMaster(groupId);
    
    if (!master.members || master.members.length === 0) {
      return ctx.reply(TEXT.emptyMembers);
    }

    // Build mention strings for all registered students
    // Format: [name](tg://user/userId) creates clickable mention link
    const mentions = master.members
      .map(member => `[${member.name}](tg://user/${member.userId})`)
      .join(' ');

    const message = `📢 *انتباه الجميع*\n\n${mentions}\n\nهناك إعلان مهم! يرجى الانتظار لقراءة التفاصيل.`;
    
    await ctx.replyWithMarkdown(message);
  });
}
