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
