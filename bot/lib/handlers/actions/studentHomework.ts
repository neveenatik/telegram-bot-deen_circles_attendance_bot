// Student self-service homework (DM loop).
//
// A student is a roster member (members row) whose telegram_user_id has been
// linked — the class owner shares a deep link (t.me/<bot>?start=hw-<gref>-<ln>)
// which links the tapping account to that roster slot. Once linked, the student
// DMs the bot to see her classes' homework, view/hear the assignment content,
// submit an answer (text/photo/voice/…), read her teacher's reply, and resubmit.
// Submitting notifies the class owner + operators; a teacher reply (handled in
// homework.ts) notifies the student.
import { Markup } from 'telegraf';
import type { Context, Telegram } from 'telegraf';
import { TEXT } from '../../text.js';
import { beginForceReplyAwaiting, logTelegramError, escapeTelegramMarkdown } from '../../helpers.js';
import { clampButtonLabel } from '../../historyUtils.js';

const SH = TEXT.studentHomework;

type FileType = 'document' | 'photo' | 'video' | 'audio' | 'voice';

interface HomeworkFile {
  fileId: string;
  fileType: 'document' | 'photo' | 'video' | 'audio';
}

interface HomeworkItem {
  id: number;
  title: string;
  content: string | null;
  files: HomeworkFile[];
  fileCount: number;
}

interface Submission {
  reviewed: boolean;
  resubmitted: boolean;
  teacherReply: string | null;
}

interface StudentClass {
  groupId: string;
  rowId: number;
  className: string;
  memberId: number;
  memberName: string;
}

interface ReplyPromptRecord {
  action?: string;
  groupId?: string;
  gref?: string;
  itemId?: number | string;
  memberId?: number;
  chatId?: number | string;
  msgId?: number;
  [key: string]: unknown;
}

interface Storage {
  getReplyPrompt(chatId: string, promptMsgId: number): Promise<ReplyPromptRecord | null>;
  delReplyPrompt(chatId: string, promptMsgId: number): Promise<void>;
  setReplyPrompt(chatId: string, promptMsgId: number, record: Record<string, unknown>): Promise<void>;
  linkStudentUser(rowId: string | number, listNumber: number, userId: number | string): Promise<{ id: number; name: string; groupId: string } | null>;
  listStudentClasses(userId: number | string): Promise<StudentClass[]>;
  getHomework(groupId: string): Promise<HomeworkItem[]>;
  getHomeworkById(groupId: string, id: string): Promise<HomeworkItem | null>;
  getSubmissionForMember(homeworkId: number, memberId: number): Promise<Submission | null>;
  submitStudentHomework(homeworkId: number, memberId: number, payload: { content: string | null; fileId: string | null; fileType: string | null }): Promise<{ id: number | null; resubmitted: boolean }>;
  listClassStaffUserIds(groupId: string): Promise<string[]>;
}

type Handler = (ctx: Context, next: () => Promise<void>) => unknown;

interface BotLike {
  telegram: Telegram;
  on(updateType: string | string[], handler: Handler): unknown;
  action(trigger: RegExp | string, handler: Handler): unknown;
  command(name: string, handler: Handler): unknown;
  start(handler: Handler): unknown;
}

// The subset of an incoming message we read when capturing a submission.
interface IncomingMessage {
  message_id: number;
  text?: string;
  caption?: string;
  reply_to_message?: { message_id: number };
  document?: { file_id: string };
  photo?: Array<{ file_id: string }>;
  video?: { file_id: string };
  audio?: { file_id: string };
  voice?: { file_id: string };
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

function dismissRow() {
  return [Markup.button.callback(TEXT.closeButton, 'msg:dismiss')];
}

// ⬜️ not submitted · 📝 submitted, awaiting review · ✅ reviewed · 🔁 resubmitted.
function marker(sub: Submission | null): string {
  if (!sub) return '⬜️';
  if (sub.resubmitted) return '🔁';
  if (sub.reviewed) return '✅';
  return '📝';
}

function statusLabel(sub: Submission | null): string {
  if (!sub) return SH.statusNone;
  if (sub.resubmitted) return SH.statusResubmitted;
  if (sub.reviewed) return SH.statusReviewed;
  return SH.statusSubmitted;
}

function readMatch(ctx: Context): RegExpExecArray {
  const m = (ctx as unknown as { match?: RegExpExecArray }).match;
  return m ?? ([] as unknown as RegExpExecArray);
}

// Extract a student's submission payload from an incoming message.
function extractSubmission(msg: IncomingMessage): { content: string | null; fileId: string | null; fileType: FileType | null } | null {
  const caption = (msg.caption ?? '').trim() || null;
  if (Array.isArray(msg.photo) && msg.photo.length > 0) {
    const largest = msg.photo[msg.photo.length - 1];
    if (largest) return { content: caption, fileId: largest.file_id, fileType: 'photo' };
  }
  if (msg.voice) return { content: caption, fileId: msg.voice.file_id, fileType: 'voice' };
  if (msg.audio) return { content: caption, fileId: msg.audio.file_id, fileType: 'audio' };
  if (msg.video) return { content: caption, fileId: msg.video.file_id, fileType: 'video' };
  if (msg.document) return { content: caption, fileId: msg.document.file_id, fileType: 'document' };
  const text = (msg.text ?? '').trim();
  if (text) return { content: text, fileId: null, fileType: null };
  return null;
}

// ── Renderers ────────────────────────────────────────────────────────────────

function classPickerView(classes: StudentClass[]) {
  const rows = classes.map((c) => [
    Markup.button.callback(clampButtonLabel(c.className || '—'), `sh:list:${c.rowId}`),
  ]);
  rows.push(dismissRow());
  return { text: `${SH.title}\n\n${SH.pickClass}`, keyboard: Markup.inlineKeyboard(rows) };
}

function listView(cls: StudentClass, items: HomeworkItem[], subByItem: Map<number, Submission | null>) {
  const rows = items.map((it) => [Markup.button.callback(
    clampButtonLabel(`${marker(subByItem.get(it.id) ?? null)} ${it.title}`),
    `sh:it:${cls.rowId}:${it.id}`,
  )]);
  rows.push(dismissRow());
  const hint = items.length ? SH.listHint : SH.listEmpty;
  return { text: `${SH.listTitle(cls.className)}\n\n${hint}`, keyboard: Markup.inlineKeyboard(rows) };
}

function itemView(cls: StudentClass, item: HomeworkItem, sub: Submission | null) {
  const lines = [SH.itemTitle(escapeTelegramMarkdown(item.title)), SH.myStatus(statusLabel(sub))];
  if (sub?.teacherReply) lines.push('', SH.teacherReply(escapeTelegramMarkdown(sub.teacherReply)));

  const rows = [];
  if (item.content || item.fileCount) {
    rows.push([Markup.button.callback(SH.viewContentButton, `sh:view:${cls.rowId}:${item.id}`)]);
  }
  const submitLabel = sub && (sub.reviewed || sub.resubmitted) ? SH.resubmitButton : SH.submitButton;
  rows.push([Markup.button.callback(submitLabel, `sh:sub:${cls.rowId}:${item.id}`)]);
  rows.push([Markup.button.callback(SH.backToListButton, `sh:list:${cls.rowId}`)]);
  rows.push(dismissRow());
  return { text: lines.join('\n'), keyboard: Markup.inlineKeyboard(rows) };
}

export function createHandlers({ storage, telegram }: { storage: Storage; telegram: Telegram }) {
  const {
    getReplyPrompt,
    delReplyPrompt,
    setReplyPrompt,
    linkStudentUser,
    listStudentClasses,
    getHomework,
    getHomeworkById,
    getSubmissionForMember,
    submitStudentHomework,
    listClassStaffUserIds,
  } = storage;

  async function resolveStudentClass(userId: number | string, gref: string): Promise<StudentClass | null> {
    const classes = await listStudentClasses(userId);
    return classes.find((c) => String(c.rowId) === String(gref)) ?? null;
  }

  // Send a homework item's content (text body + each media file) to a student.
  async function sendContent(chatId: number | string, item: HomeworkItem): Promise<boolean> {
    let sent = false;
    if (item.content) {
      await telegram.sendMessage(chatId, `${SH.itemTitle(item.title)}\n\n${item.content}`, { parse_mode: 'Markdown' });
      sent = true;
    }
    for (const file of item.files) {
      switch (file.fileType) {
        case 'document': await telegram.sendDocument(chatId, file.fileId); break;
        case 'photo': await telegram.sendPhoto(chatId, file.fileId); break;
        case 'video': await telegram.sendVideo(chatId, file.fileId); break;
        case 'audio': await telegram.sendAudio(chatId, file.fileId); break;
      }
      sent = true;
    }
    return sent;
  }

  // Build the class list of homework with this student's per-item status.
  async function loadList(cls: StudentClass): Promise<{ items: HomeworkItem[]; subByItem: Map<number, Submission | null> }> {
    const items = await getHomework(cls.groupId);
    const subByItem = new Map<number, Submission | null>();
    for (const it of items) {
      const sub = await getSubmissionForMember(it.id, cls.memberId);
      subByItem.set(it.id, sub);
    }
    return { items, subByItem };
  }

  // Fresh entry (deep link / command): reply with a new message, not an edit.
  async function renderHome(ctx: Context, userId: number | string): Promise<void> {
    const classes = await listStudentClasses(userId);
    if (!classes.length) { await ctx.reply(SH.noClasses, { parse_mode: 'Markdown' }); return; }
    if (classes.length > 1) {
      const view = classPickerView(classes);
      await ctx.reply(view.text, { parse_mode: 'Markdown', ...view.keyboard });
      return;
    }
    const cls = classes[0];
    if (!cls) return;
    const { items, subByItem } = await loadList(cls);
    const view = listView(cls, items, subByItem);
    await ctx.reply(view.text, { parse_mode: 'Markdown', ...view.keyboard });
  }

  // ── Entry points ────────────────────────────────────────────────────────────

  // Deep link: t.me/<bot>?start=hw-<gref>-<ln> links the account and shows home.
  async function startLink(ctx: Context, next: () => Promise<void>): Promise<void> {
    if (ctx.chat?.type !== 'private') return next();
    const payload = String((ctx as unknown as { startPayload?: string }).startPayload || '');
    if (!payload.startsWith('hw-')) return next();
    const parts = payload.split('-');
    const gref = parts[1] ?? '';
    const listNumber = Number(parts[2] ?? NaN);
    const userId = ctx.from?.id;
    if (!gref || !Number.isInteger(listNumber) || userId === undefined) return next();

    const linked = await linkStudentUser(gref, listNumber, userId);
    if (!linked) { await ctx.reply(SH.linkFailed); return; }
    await ctx.reply(SH.linkedToast(linked.name));
    await renderHome(ctx, userId);
  }

  // /homework — re-entry for an already-linked student.
  async function homeCommand(ctx: Context): Promise<void> {
    if (ctx.chat?.type !== 'private') return;
    const userId = ctx.from?.id;
    if (userId === undefined) return;
    await renderHome(ctx, userId);
  }

  // ── Callback navigation ──────────────────────────────────────────────────────

  async function listOffline(ctx: Context): Promise<void> {
    const gref = readMatch(ctx)[1] ?? '';
    const userId = ctx.from?.id;
    if (userId === undefined) return;
    const cls = await resolveStudentClass(userId, gref);
    if (!cls) { await ctx.answerCbQuery(SH.linkFailed); return; }
    const { items, subByItem } = await loadList(cls);
    const view = listView(cls, items, subByItem);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function itemOffline(ctx: Context): Promise<void> {
    const m = readMatch(ctx);
    const gref = m[1] ?? '';
    const itemId = m[2] ?? '';
    const userId = ctx.from?.id;
    if (userId === undefined) return;
    const cls = await resolveStudentClass(userId, gref);
    if (!cls) { await ctx.answerCbQuery(SH.linkFailed); return; }
    const item = await getHomeworkById(cls.groupId, itemId);
    if (!item) { await ctx.answerCbQuery(SH.linkFailed); return; }
    const sub = await getSubmissionForMember(item.id, cls.memberId);
    const view = itemView(cls, item, sub);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function viewContentOffline(ctx: Context): Promise<void> {
    const m = readMatch(ctx);
    const gref = m[1] ?? '';
    const itemId = m[2] ?? '';
    const userId = ctx.from?.id;
    if (userId === undefined) return;
    const cls = await resolveStudentClass(userId, gref);
    if (!cls) { await ctx.answerCbQuery(SH.linkFailed); return; }
    const item = await getHomeworkById(cls.groupId, itemId);
    if (!item) { await ctx.answerCbQuery(SH.linkFailed); return; }
    if (!item.content && !item.fileCount) { await ctx.answerCbQuery(SH.noContent); return; }
    try {
      await sendContent(userId, item);
      await ctx.answerCbQuery(SH.contentSentToast);
    } catch (err) {
      logTelegramError('studentHomework.viewContent', err, { gref, itemId });
      await ctx.answerCbQuery(SH.noContent);
    }
  }

  // Arm a force-reply to collect the student's answer (captured by onStudentMessage).
  async function submitPrompt(ctx: Context): Promise<void> {
    const m = readMatch(ctx);
    const gref = m[1] ?? '';
    const itemId = m[2] ?? '';
    const userId = ctx.from?.id;
    if (userId === undefined) return;
    const cls = await resolveStudentClass(userId, gref);
    if (!cls) { await ctx.answerCbQuery(SH.linkFailed); return; }
    const item = await getHomeworkById(cls.groupId, itemId);
    if (!item) { await ctx.answerCbQuery(SH.linkFailed); return; }
    await beginForceReplyAwaiting(ctx, {
      setReplyPrompt,
      groupId: cls.groupId,
      record: { action: 'studentSubmit', gref: String(cls.rowId), itemId: item.id, memberId: cls.memberId },
      sendPrompt: () => ctx.reply(SH.submitPrompt, { parse_mode: 'Markdown', reply_markup: { force_reply: true } }),
    });
  }

  // ── Message listener: a student's answer replying to the submit prompt ───────

  async function onStudentMessage(ctx: Context, next: () => Promise<void>): Promise<void> {
    if (ctx.chat?.type !== 'private') return next();
    const msg = ctx.message as IncomingMessage | undefined;
    const replyTo = msg?.reply_to_message;
    const userId = ctx.from?.id;
    if (!msg || !replyTo || userId === undefined) return next();

    const chatKey = String(ctx.chat.id);
    const pending = await getReplyPrompt(chatKey, replyTo.message_id);
    if (!pending || pending.action !== 'studentSubmit' || !pending.groupId) return next();

    const payload = extractSubmission(msg);
    if (!payload) return next();

    const gref = String(pending.gref ?? '');
    const homeworkId = Number(pending.itemId);
    const memberId = Number(pending.memberId);
    await delReplyPrompt(chatKey, replyTo.message_id);

    const result = await submitStudentHomework(homeworkId, memberId, payload);
    await ctx.reply(result.resubmitted ? SH.resubmitted : SH.submitted);

    // Notify class staff (owner + operators), best-effort.
    const cls = await resolveStudentClass(userId, gref);
    if (cls) {
      const staff = await listClassStaffUserIds(cls.groupId).catch(() => []);
      const item = await getHomeworkById(cls.groupId, String(homeworkId));
      const title = item ? item.title : '';
      const note = result.resubmitted
        ? SH.notifyStaffResubmit(cls.className, cls.memberName, title)
        : SH.notifyStaffSubmit(cls.className, cls.memberName, title);
      for (const uid of staff) {
        try {
          await telegram.sendMessage(uid, note, { parse_mode: 'Markdown' });
        } catch (err) {
          logTelegramError('studentHomework.notifyStaff', err, { uid });
        }
      }

      // Refresh the student's item panel (if it's still the source message).
      if (pending.chatId !== undefined && pending.msgId !== undefined && item) {
        const sub = await getSubmissionForMember(homeworkId, memberId);
        const view = itemView(cls, item, sub);
        try {
          await telegram.editMessageText(pending.chatId, pending.msgId, undefined, view.text, {
            parse_mode: 'Markdown', ...view.keyboard,
          });
        } catch (err) {
          logTelegramError('studentHomework.refreshPanel', err, { chatId: chatKey, messageId: pending.msgId });
        }
      }
    }
  }

  return {
    startLink,
    homeCommand,
    onStudentMessage,
    listOffline,
    itemOffline,
    viewContentOffline,
    submitPrompt,
  };
}

export function register(bot: BotLike, storage: Storage): void {
  const h = createHandlers({ storage, telegram: bot.telegram });
  bot.on(['text', 'document', 'photo', 'video', 'audio', 'voice'], h.onStudentMessage);
  bot.start(h.startLink);
  bot.command('homework', h.homeCommand);
  bot.action(/^sh:list:(\d+)$/, h.listOffline);
  bot.action(/^sh:it:(\d+):(\d+)$/, h.itemOffline);
  bot.action(/^sh:view:(\d+):(\d+)$/, h.viewContentOffline);
  bot.action(/^sh:sub:(\d+):(\d+)$/, h.submitPrompt);
}
