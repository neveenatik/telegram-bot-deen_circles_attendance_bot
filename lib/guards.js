// Guard functions for admin/creator checks

export async function isAdmin(ctx) {
  if (ctx.chat?.type === 'private') return false;
  try {
    const member = await ctx.getChatMember(ctx.from.id);
    return ['administrator', 'creator'].includes(member.status);
  } catch {
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
