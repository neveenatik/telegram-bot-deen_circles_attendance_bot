// Guard functions for admin/creator checks

export async function isAdmin(ctx) {
  if (ctx.chat?.type === 'private') return false;
  try {
    const member = await ctx.getChatMember(ctx.from.id);
    return ['administrator', 'creator'].includes(member.status);
  } catch (err) {
    console.warn(JSON.stringify({
      level: 'warn',
      event: 'guard_is_admin_failed',
      message: err?.message || String(err),
      chatId: ctx?.chat?.id ? String(ctx.chat.id) : null,
      userId: ctx?.from?.id ? String(ctx.from.id) : null,
      at: new Date().toISOString(),
    }));
    return false;
  }
}

export async function isCreator(ctx) {
  if (ctx.chat?.type === 'private') return false;
  try {
    const member = await ctx.getChatMember(ctx.from.id);
    return member.status === 'creator';
  } catch {
    return false;
  }
}

// Chat-agnostic admin check: verifies membership status directly against a group
// by id, so it works from a DM (where `isAdmin(ctx)` always returns false).
export async function isAdminOf(telegram, chatId, userId) {
  if (!telegram || !chatId || !userId) return false;
  try {
    const member = await telegram.getChatMember(chatId, userId);
    return ['administrator', 'creator'].includes(member.status);
  } catch (err) {
    console.warn(JSON.stringify({
      level: 'warn',
      event: 'guard_is_admin_of_failed',
      message: err?.message || String(err),
      chatId: chatId ? String(chatId) : null,
      userId: userId ? String(userId) : null,
      at: new Date().toISOString(),
    }));
    return false;
  }
}
