import { isAdmin } from '../../guards.js';
import { groupIdFromCtx, sortArabic } from '../../helpers.js';
import { TEXT } from '../../text.js';
import { memberOptionsKb, membersText, membersKb, refreshSessionWidget } from '../../widgets.js';

export function register(bot, storage) {
  const { getMaster, saveMaster, getSession, saveSession, setAwaiting } = storage;

  bot.action(/^mb:pick:(\d+)$/, async (ctx) => {
    if (!await isAdmin(ctx))
      return ctx.answerCbQuery(TEXT.adminOnly, { show_alert: true });

    const groupId = groupIdFromCtx(ctx);
    const master = await getMaster(groupId);
    const sorted = sortArabic(master.members.map(m => m.name));
    const i      = parseInt(ctx.match[1], 10);
    const name   = sorted[i];
    if (!name) return ctx.answerCbQuery(TEXT.memberNotFound, { show_alert: true });

    await ctx.editMessageText(
      TEXT.memberOptionsHeader(name),
      { parse_mode: 'Markdown', ...memberOptionsKb(i) }
    );
    ctx.answerCbQuery();
  });

  bot.action(/^mb:del:(\d+)$/, async (ctx) => {
    if (!await isAdmin(ctx))
      return ctx.answerCbQuery(TEXT.adminOnly, { show_alert: true });

    const groupId = groupIdFromCtx(ctx);
    const master = await getMaster(groupId);
    const sorted = sortArabic(master.members.map(m => m.name));
    const i      = parseInt(ctx.match[1], 10);
    const name   = sorted[i];
    if (!name) return ctx.answerCbQuery(TEXT.memberNotFound, { show_alert: true });

    master.members.splice(master.members.findIndex(m => m.name === name), 1);
    await saveMaster(groupId, master);

    const session = await getSession(groupId);
    if (session) {
      delete session.attendance[name];
      if (session.called) delete session.called[name];
      await saveSession(groupId, session);
      await refreshSessionWidget(bot.telegram, session, master);
    }

    await ctx.editMessageText(membersText(master), { parse_mode: 'Markdown', ...membersKb(master) });
    ctx.answerCbQuery(TEXT.memberDeletedShort(name));
  });

  bot.action(/^mb:ren:(\d+)$/, async (ctx) => {
    if (!await isAdmin(ctx))
      return ctx.answerCbQuery(TEXT.adminOnly, { show_alert: true });

    const groupId = groupIdFromCtx(ctx);
    const master = await getMaster(groupId);
    const sorted = sortArabic(master.members.map(m => m.name));
    const i      = parseInt(ctx.match[1], 10);
    const name   = sorted[i];
    if (!name) return ctx.answerCbQuery(TEXT.memberNotFound, { show_alert: true });

    await ctx.answerCbQuery();
    const msgId = ctx.callbackQuery.message.message_id;
    await setAwaiting(groupId, String(ctx.from.id), {
      action: 'rename', chatId: ctx.chat.id, msgId, oldName: name,
      promptMsgId: null, awaitingPrompt: true,
    });
    const prompt = await ctx.reply(TEXT.renamePrompt(name), {
      parse_mode: 'Markdown',
      reply_markup: { force_reply: true, input_field_placeholder: 'الاسم الجديد', selective: true },
    });
    await setAwaiting(groupId, String(ctx.from.id), {
      action: 'rename', chatId: ctx.chat.id, msgId, oldName: name,
      promptMsgId: prompt.message_id, awaitingPrompt: false,
    });
  });

  bot.action('mb:back', async (ctx) => {
    if (!await isAdmin(ctx))
      return ctx.answerCbQuery(TEXT.adminOnly, { show_alert: true });
    const groupId = groupIdFromCtx(ctx);
    const master = await getMaster(groupId);
    await ctx.editMessageText(membersText(master), { parse_mode: 'Markdown', ...membersKb(master) });
    ctx.answerCbQuery();
  });

  bot.action('mb:add', async (ctx) => {
    if (!await isAdmin(ctx))
      return ctx.answerCbQuery(TEXT.adminOnly, { show_alert: true });

    const groupId = groupIdFromCtx(ctx);
    await ctx.answerCbQuery();
    const msgId = ctx.callbackQuery.message.message_id;
    await setAwaiting(groupId, String(ctx.from.id), {
      action: 'add', chatId: ctx.chat.id, msgId, promptMsgId: null, awaitingPrompt: true,
    });
    const prompt = await ctx.reply(TEXT.inlinePromptAdd, {
      reply_markup: { force_reply: true, input_field_placeholder: '123456789 | أحمد محمد', selective: true },
    });
    await setAwaiting(groupId, String(ctx.from.id), {
      action: 'add', chatId: ctx.chat.id, msgId, promptMsgId: prompt.message_id, awaitingPrompt: false,
    });
  });
}
