// Homework tracking — the project's second TypeScript module.
//
// A main class links one dedicated homework group (group_settings.homework_group_id).
// Three surfaces live here:
//
//  1. Group listener (homework group) — passive live tracking, acknowledged with
//     lightweight message reactions (no clutter):
//       • staff posts a #التكليف-tagged message → register a homework item (📓)
//       • a registered member replies to that post → record a submission (👍)
//       • staff replies to a submission → mark it reviewed (✅)
//  2. Group /manage panel (mg:hw*) — admins review per-item submission/review
//     counts + a per-student breakdown, and nudge non-submitters in the group.
//  3. Offline class panel (o:hw*) — owners/operators of a group-less class create
//     items by hand and cycle each student's state (⬜️ → 📝 → ✅) manually, since
//     there is no Telegram thread to observe.
import { Markup } from 'telegraf';
import type { Context, Telegram } from 'telegraf';
import { TEXT } from '../../text.js';
import {
  beginForceReplyAwaiting,
  replyEphemeral,
  logTelegramError,
  escapeTelegramMarkdown,
} from '../../helpers.js';
import { isAdminOf } from '../../guards.js';
import { clampButtonLabel } from '../../historyUtils.js';

const HW = TEXT.homework;

type Surface = 'offline' | 'group';

interface HomeworkItem {
  id: number;
  title: string;
  sourceMessageId: number | null;
  postedBy: string | null;
  createdAt: string | null;
}

interface Member {
  id: number;
  name: string;
}

interface RosterMember {
  userId: string | null;
  name: string;
}

interface MemberWithId {
  id: number;
  name: string;
  userId: string | null;
  listNumber: number | null;
}

interface Submission {
  id: number;
  memberId: number | null;
  memberName: string | null;
  submissionMessageId: number | null;
  submittedAt: string | null;
  reviewed: boolean;
  reviewedBy: string | null;
  reviewedAt: string | null;
  resubmitted: boolean;
  resubmittedAt: string | null;
}

// The four per-student states an offline submission can hold.
type SubmissionState = 'none' | 'submitted' | 'reviewed' | 'resubmitted';

interface Teacher {
  id: number;
  userId: string | null;
  name: string;
  type: string;
}

interface ManageableClass {
  groupId: string;
  rowId: string | number;
  role: string;
  name: string;
}

interface ReplyPromptRecord {
  action?: string;
  surface?: Surface;
  groupId?: string;
  gref?: string;
  chatId?: number | string;
  msgId?: number;
  [key: string]: unknown;
}

interface Storage {
  // Reply-prompt plumbing (offline add-title force reply).
  getReplyPrompt(chatId: string, promptMsgId: number): Promise<ReplyPromptRecord | null>;
  delReplyPrompt(chatId: string, promptMsgId: number): Promise<void>;
  setReplyPrompt(chatId: string, promptMsgId: number, record: Record<string, unknown>): Promise<void>;
  // Linking + resolution.
  resolveHomeworkMainGroup(homeworkGroupId: string): Promise<{ mainGroupId: string; mainRowId: string | number } | null>;
  getHomeworkGroupId(groupId: string): Promise<string | null>;
  resolveManageableClass(gref: string, userId: number | string): Promise<ManageableClass | null>;
  // Homework items.
  getHomework(groupId: string): Promise<HomeworkItem[]>;
  getHomeworkById(groupId: string, id: string): Promise<HomeworkItem | null>;
  getHomeworkBySourceMessage(groupId: string, sourceMessageId: number): Promise<HomeworkItem | null>;
  addHomework(groupId: string, homework: { title: string; sourceMessageId: number | null; postedBy: string | null }): Promise<number | null>;
  removeHomework(groupId: string, homeworkId: string): Promise<void>;
  // Submissions.
  getSubmissions(homeworkId: number): Promise<Submission[]>;
  recordSubmission(homeworkId: number, memberId: number, submissionMessageId?: number | null): Promise<number | null>;
  toggleSubmission(homeworkId: number, memberId: number): Promise<boolean>;
  markReviewedByMessage(submissionMessageId: number, reviewerUserId: number | string): Promise<boolean>;
  toggleReviewed(homeworkId: number, memberId: number, reviewerUserId?: number | string | null): Promise<boolean>;
  setSubmissionState(homeworkId: number, memberId: number, state: SubmissionState, actorUserId?: number | string | null): Promise<void>;
  // Rosters.
  getMaster(groupId: string): Promise<{ members: RosterMember[] }>;
  getMembersWithIds(groupId: string): Promise<MemberWithId[]>;
  findMemberByUserId(groupId: string, userId: number | string): Promise<Member | null>;
  getTeachers(groupId: string): Promise<Teacher[]>;
}

type Handler = (ctx: Context, next: () => Promise<void>) => unknown;

interface BotLike {
  telegram: Telegram;
  on(updateType: string | string[], handler: Handler): unknown;
  action(trigger: RegExp | string, handler: Handler): unknown;
}

// The subset of an incoming message we read (group flow + offline force reply).
interface IncomingMessage {
  message_id: number;
  text?: string;
  caption?: string;
  reply_to_message?: { message_id: number };
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

function hasTag(text: string): boolean {
  return text.includes(HW.tag);
}

function extractTitle(text: string): string {
  const stripped = text.split(HW.tag).join(' ').replace(/\s+/g, ' ').trim();
  return stripped || HW.defaultTitle;
}

// ⬜️ not submitted · 📝 submitted, awaiting review · ✅ reviewed · 🔁 resubmitted.
function marker(submitted: boolean, reviewed: boolean, resubmitted: boolean): string {
  if (resubmitted) return '🔁';
  if (reviewed) return '✅';
  if (submitted) return '📝';
  return '⬜️';
}

// Reduce a submission row to its state; absence of a row is 'none'.
function submissionState(sub: Submission | undefined | null): SubmissionState {
  if (!sub) return 'none';
  if (sub.resubmitted) return 'resubmitted';
  if (sub.reviewed) return 'reviewed';
  return 'submitted';
}

// The offline manual cycle: ⬜️ → 📝 → ✅ → 🔁 → ⬜️.
function nextState(state: SubmissionState): SubmissionState {
  switch (state) {
    case 'none': return 'submitted';
    case 'submitted': return 'reviewed';
    case 'reviewed': return 'resubmitted';
    default: return 'none';
  }
}

function readMatch(ctx: Context): RegExpExecArray {
  const m = (ctx as unknown as { match?: RegExpExecArray }).match;
  return m ?? ([] as unknown as RegExpExecArray);
}

function dismissRow() {
  return [Markup.button.callback(TEXT.closeButton, 'msg:dismiss')];
}

// ── Pure renderers ───────────────────────────────────────────────────────────

function homeworkListView(surface: Surface, token: string, items: HomeworkItem[]) {
  const list = Array.isArray(items) ? items : [];
  const rows = [];
  if (surface === 'offline') {
    rows.push([Markup.button.callback(HW.addButton, `o:hwadd:${token}`)]);
  }
  for (const item of list) {
    const cb = surface === 'group' ? `mg:hwit:${token}:${item.id}` : `o:hwit:${token}:${item.id}`;
    rows.push([Markup.button.callback(clampButtonLabel(item.title), cb)]);
  }
  if (list.length) {
    const repCb = surface === 'group' ? `mg:hwrep:${token}` : `o:hwrep:${token}`;
    rows.push([Markup.button.callback(HW.reportButton, repCb)]);
  }
  const backCb = surface === 'group' ? `mg:home:${token}` : `o:cls:${token}`;
  rows.push([Markup.button.callback(TEXT.backButton, backCb)]);
  rows.push(dismissRow());
  const hint = list.length ? HW.listHint : (surface === 'group' ? HW.empty : HW.offlineEmpty);
  return { text: `${HW.title}\n\n${hint}`, keyboard: Markup.inlineKeyboard(rows) };
}

// Count the submitted / reviewed / resubmitted totals for one homework item.
function tallySubmissions(submissions: Submission[]): { submitted: number; reviewed: number; resubmitted: number } {
  return {
    submitted: submissions.length,
    reviewed: submissions.filter((s) => s.reviewed).length,
    resubmitted: submissions.filter((s) => s.resubmitted).length,
  };
}

// Group item detail: counts + a read-only per-student breakdown (matched by name
// against the current roster). Non-submitters can be nudged in the group.
function homeworkGroupItemView(groupId: string, item: HomeworkItem, roster: RosterMember[], submissions: Submission[]) {
  const stateByName = new Map<string, Submission>();
  for (const s of submissions) {
    if (s.memberName) stateByName.set(s.memberName, s);
  }
  const total = roster.length;
  const { submitted, reviewed, resubmitted } = tallySubmissions(submissions);

  const lines: string[] = [];
  for (const m of roster) {
    const s = stateByName.get(m.name);
    lines.push(`${marker(Boolean(s), Boolean(s?.reviewed), Boolean(s?.resubmitted))} ${escapeTelegramMarkdown(m.name)}`);
  }
  const body = total
    ? `${HW.itemTitle(escapeTelegramMarkdown(item.title))}\n${HW.counts(submitted, total, reviewed, resubmitted)}\n\n${lines.join('\n')}\n\n${HW.legend}`
    : `${HW.itemTitle(escapeTelegramMarkdown(item.title))}\n\n${HW.noStudents}`;

  const rows = [];
  if (total && submitted < total) {
    rows.push([Markup.button.callback(HW.tagButton, `mg:hwtag:${groupId}:${item.id}`)]);
  }
  rows.push([Markup.button.callback(HW.removeButton, `mg:hwrm:${groupId}:${item.id}`)]);
  rows.push([Markup.button.callback(TEXT.backButton, `mg:hw:${groupId}`)]);
  rows.push(dismissRow());
  return { text: body, keyboard: Markup.inlineKeyboard(rows) };
}

// Offline item detail: one toggle button per student cycling ⬜️ → 📝 → ✅ → ⬜️.
function homeworkOfflineItemView(gref: string, item: HomeworkItem, members: MemberWithId[], submissions: Submission[]) {
  const stateByMember = new Map<number, Submission>();
  for (const s of submissions) {
    if (s.memberId !== null) stateByMember.set(s.memberId, s);
  }
  const total = members.length;
  const { submitted, reviewed, resubmitted } = tallySubmissions(submissions);

  const rows = [];
  for (const m of members) {
    const s = stateByMember.get(m.id);
    rows.push([Markup.button.callback(
      clampButtonLabel(`${marker(Boolean(s), Boolean(s?.reviewed), Boolean(s?.resubmitted))} ${m.name}`),
      `o:hwtog:${gref}:${item.id}:${m.id}`,
    )]);
  }
  rows.push([Markup.button.callback(HW.removeButton, `o:hwrm:${gref}:${item.id}`)]);
  rows.push([Markup.button.callback(TEXT.backButton, `o:hw:${gref}`)]);
  rows.push(dismissRow());

  const head = total
    ? `${HW.itemTitle(escapeTelegramMarkdown(item.title))}\n${HW.counts(submitted, total, reviewed, resubmitted)}\n\n${HW.manageHint}`
    : `${HW.itemTitle(escapeTelegramMarkdown(item.title))}\n\n${HW.noStudents}`;
  return { text: head, keyboard: Markup.inlineKeyboard(rows) };
}

function homeworkRemoveConfirmView(surface: Surface, token: string, item: HomeworkItem) {
  const okCb = surface === 'group' ? `mg:hwrmx:${token}:${item.id}` : `o:hwrmx:${token}:${item.id}`;
  const backCb = surface === 'group' ? `mg:hwit:${token}:${item.id}` : `o:hwit:${token}:${item.id}`;
  const rows = [
    [Markup.button.callback(HW.confirmRemoveButton, okCb)],
    [Markup.button.callback(TEXT.backButton, backCb)],
    dismissRow(),
  ];
  return { text: HW.removeConfirm(escapeTelegramMarkdown(item.title)), keyboard: Markup.inlineKeyboard(rows) };
}

// One homework item's slice of the printable report: its counts plus a marker
// line per student.
interface ReportEntry {
  item: HomeworkItem;
  total: number;
  counts: { submitted: number; reviewed: number; resubmitted: number };
  lines: string[];
}

// Build the printable homework report. Returns Telegram-sized chunks (≤ ~3500
// chars) so a class with many items/students never overflows a single message.
function buildHomeworkReport(className: string, entries: ReportEntry[]): string[] {
  const blocks: string[] = [HW.reportHeader(escapeTelegramMarkdown(className))];
  for (const e of entries) {
    const header = HW.reportItemHeader(
      escapeTelegramMarkdown(e.item.title), e.counts.submitted, e.total, e.counts.reviewed, e.counts.resubmitted,
    );
    blocks.push(e.lines.length ? `${header}\n${e.lines.join('\n')}` : `${header}\n${HW.noStudents}`);
  }
  blocks.push(HW.legend);

  const chunks: string[] = [];
  let current = '';
  for (const block of blocks) {
    if (current && current.length + block.length + 2 > 3500) {
      chunks.push(current);
      current = '';
    }
    current = current ? `${current}\n\n${block}` : block;
  }
  if (current) chunks.push(current);
  return chunks;
}

export function createHandlers({ storage, telegram }: { storage: Storage; telegram: Telegram }) {
  const {
    getReplyPrompt,
    delReplyPrompt,
    setReplyPrompt,
    resolveHomeworkMainGroup,
    getHomeworkGroupId,
    resolveManageableClass,
    getHomework,
    getHomeworkById,
    getHomeworkBySourceMessage,
    addHomework,
    removeHomework,
    getSubmissions,
    recordSubmission,
    markReviewedByMessage,
    setSubmissionState,
    getMaster,
    getMembersWithIds,
    findMemberByUserId,
    getTeachers,
  } = storage;

  // Acknowledge a live action with a single emoji reaction. Best-effort: swallow
  // errors (old Telegram clients, missing permission, unsupported emoji).
  async function react(chatId: number | string, messageId: number, emoji: string): Promise<void> {
    try {
      const setReaction = (telegram as unknown as {
        setMessageReaction?: (chatId: number | string, messageId: number, reaction: unknown) => Promise<unknown>;
      }).setMessageReaction;
      if (typeof setReaction === 'function') {
        await setReaction.call(telegram, chatId, messageId, [{ type: 'emoji', emoji }]);
      }
    } catch (err) {
      logTelegramError('homework.react', err, { chatId: String(chatId), messageId });
    }
  }

  // Staff = an admin of the homework group OR a homeworkteacher of the main class.
  async function isStaff(homeworkGroupId: string, mainGroupId: string, userId: number): Promise<boolean> {
    if (await isAdminOf(telegram, homeworkGroupId, userId)) return true;
    const teachers = await getTeachers(mainGroupId);
    return teachers.some((t) => t.type === 'homeworkteacher' && String(t.userId) === String(userId));
  }

  // ── Message listener (homework group live flow + offline add-title reply) ────

  async function onHomeworkMessage(ctx: Context, next: () => Promise<void>): Promise<void> {
    const chat = ctx.chat;
    const msg = ctx.message as IncomingMessage | undefined;
    const userId = ctx.from?.id;
    if (!chat || !msg || userId === undefined) return next();

    // Private chat: the only homework concern is an owner answering the offline
    // "add homework title" force-reply. Everything else falls through to text.js.
    if (chat.type === 'private') {
      const replyTo = msg.reply_to_message;
      if (!replyTo) return next();
      const chatKey = String(chat.id);
      const pending = await getReplyPrompt(chatKey, replyTo.message_id);
      if (!pending || pending.action !== 'homeworkAddOffline' || !pending.groupId) return next();

      const title = (msg.text ?? '').trim();
      if (!title) {
        // Keep the prompt open so she can reply again with a title.
        await replyEphemeral(ctx, HW.emptyTitle);
        return;
      }
      await delReplyPrompt(chatKey, replyTo.message_id);
      await addHomework(pending.groupId, { title, sourceMessageId: null, postedBy: String(userId) });
      await replyEphemeral(ctx, HW.added(title), { parse_mode: 'Markdown' });

      // Refresh the originating offline panel back to the (now longer) list.
      if (pending.chatId === undefined || pending.msgId === undefined) return;
      const list = await getHomework(pending.groupId);
      const view = homeworkListView('offline', String(pending.gref ?? ''), list);
      try {
        await telegram.editMessageText(pending.chatId, pending.msgId, undefined, view.text, {
          parse_mode: 'Markdown', ...view.keyboard,
        });
      } catch (err) {
        logTelegramError('homework.add.refreshPanel', err, {
          chatId: String(pending.chatId), messageId: pending.msgId,
        });
      }
      return;
    }

    if (chat.type !== 'group' && chat.type !== 'supergroup') return next();

    const content = msg.text ?? msg.caption ?? '';
    const replyTo = msg.reply_to_message;

    // Cheap pre-filter: only replies or #التكليف-tagged posts can be relevant,
    // so ordinary group chatter never triggers a database lookup.
    if (!replyTo && !hasTag(content)) return next();

    const resolved = await resolveHomeworkMainGroup(String(chat.id));
    if (!resolved) return next();
    const { mainGroupId } = resolved;
    const homeworkGroupId = String(chat.id);

    if (replyTo) {
      // (2) Student submission — a reply to a tracked assignment post.
      const item = await getHomeworkBySourceMessage(mainGroupId, replyTo.message_id);
      if (item) {
        const member = await findMemberByUserId(mainGroupId, userId);
        if (!member) return next(); // unregistered replier — ignore
        await recordSubmission(item.id, member.id, msg.message_id);
        await react(chat.id, msg.message_id, '👍');
        return;
      }

      // (3) Teacher review — a staff member replies to a student's submission.
      // Gate on staff first: markReviewedByMessage matches purely by message id,
      // so a non-staff reply must never flip a submission to reviewed.
      if (await isStaff(homeworkGroupId, mainGroupId, userId)) {
        const reviewed = await markReviewedByMessage(replyTo.message_id, userId);
        if (reviewed) {
          await react(chat.id, msg.message_id, '✅');
          return;
        }
      }
      return next();
    }

    // (1) Assignment post — a staff member posts a #التكليف-tagged message.
    if (hasTag(content) && await isStaff(homeworkGroupId, mainGroupId, userId)) {
      await addHomework(mainGroupId, {
        title: extractTitle(content),
        sourceMessageId: msg.message_id,
        postedBy: String(userId),
      });
      await react(chat.id, msg.message_id, '📓');
      return;
    }

    return next();
  }

  // ── Group /manage surface (mg:hw*) ──────────────────────────────────────────
  // Token = the Telegram chat id; gate on isAdminOf against that group.

  async function authorizeGroup(ctx: Context): Promise<string | null> {
    const groupId = readMatch(ctx)[1] ?? '';
    const userId = ctx.from?.id;
    if (!groupId || userId === undefined) return null;
    const ok = await isAdminOf(telegram, groupId, userId);
    return ok ? groupId : null;
  }

  async function homeworkGroup(ctx: Context): Promise<void> {
    const groupId = await authorizeGroup(ctx);
    if (!groupId) { await ctx.answerCbQuery(TEXT.adminOnly); return; }
    const list = await getHomework(groupId);
    const view = homeworkListView('group', groupId, list);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function homeworkItemGroup(ctx: Context): Promise<void> {
    const groupId = await authorizeGroup(ctx);
    if (!groupId) { await ctx.answerCbQuery(TEXT.adminOnly); return; }
    const id = readMatch(ctx)[2] ?? '';
    const item = await getHomeworkById(groupId, id);
    if (!item) { await ctx.answerCbQuery(HW.missing); return; }
    const [{ members }, submissions] = await Promise.all([
      getMaster(groupId),
      getSubmissions(item.id),
    ]);
    const view = homeworkGroupItemView(groupId, item, members, submissions);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function homeworkTagGroup(ctx: Context): Promise<void> {
    const groupId = await authorizeGroup(ctx);
    if (!groupId) { await ctx.answerCbQuery(TEXT.adminOnly); return; }
    const id = readMatch(ctx)[2] ?? '';
    const item = await getHomeworkById(groupId, id);
    if (!item) { await ctx.answerCbQuery(HW.missing); return; }

    const [{ members }, submissions] = await Promise.all([
      getMaster(groupId),
      getSubmissions(item.id),
    ]);
    const submittedNames = new Set(submissions.map((s) => s.memberName).filter(Boolean) as string[]);
    const pending = members.filter((m) => !submittedNames.has(m.name) && m.userId);
    if (!pending.length) { await ctx.answerCbQuery(HW.allTagged); return; }

    const homeworkGroupId = await getHomeworkGroupId(groupId);
    if (!homeworkGroupId) { await ctx.answerCbQuery(HW.noHomeworkGroupForTag); return; }

    const mentions = pending
      .map((m) => `[${escapeTelegramMarkdown(m.name)}](tg://user?id=${m.userId})`)
      .join('، ');
    try {
      await telegram.sendMessage(homeworkGroupId, HW.tagReminder(escapeTelegramMarkdown(item.title), mentions), {
        parse_mode: 'Markdown',
      });
      await ctx.answerCbQuery(HW.tagDoneToast(pending.length));
    } catch (err) {
      logTelegramError('homework.tag.group', err, { groupId, homeworkId: id });
      await ctx.answerCbQuery(HW.noHomeworkGroupForTag);
    }
  }

  async function homeworkRemoveGroup(ctx: Context): Promise<void> {
    const groupId = await authorizeGroup(ctx);
    if (!groupId) { await ctx.answerCbQuery(TEXT.adminOnly); return; }
    const id = readMatch(ctx)[2] ?? '';
    const item = await getHomeworkById(groupId, id);
    if (!item) { await ctx.answerCbQuery(HW.missing); return; }
    const view = homeworkRemoveConfirmView('group', groupId, item);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function homeworkRemoveExecGroup(ctx: Context): Promise<void> {
    const groupId = await authorizeGroup(ctx);
    if (!groupId) { await ctx.answerCbQuery(TEXT.adminOnly); return; }
    const id = readMatch(ctx)[2] ?? '';
    const item = await getHomeworkById(groupId, id);
    await removeHomework(groupId, id);
    const list = await getHomework(groupId);
    const view = homeworkListView('group', groupId, list);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery(item ? HW.removedToast(item.title) : undefined);
  }

  // Deliver a (possibly multi-part) report as fresh messages so it can be
  // forwarded or printed, leaving the panel untouched.
  async function sendReport(ctx: Context, chunks: string[]): Promise<void> {
    for (const chunk of chunks) {
      await ctx.reply(chunk, { parse_mode: 'Markdown' });
    }
  }

  // Best-effort group title for the report header; falls back to a neutral label.
  async function groupTitle(groupId: string): Promise<string> {
    try {
      const chat = await telegram.getChat(groupId) as { title?: string };
      return chat.title || HW.reportFallbackName;
    } catch {
      return HW.reportFallbackName;
    }
  }

  async function homeworkReportGroup(ctx: Context): Promise<void> {
    const groupId = await authorizeGroup(ctx);
    if (!groupId) { await ctx.answerCbQuery(TEXT.adminOnly); return; }
    const items = await getHomework(groupId);
    if (!items.length) { await ctx.answerCbQuery(HW.reportEmpty); return; }
    const [{ members }, title] = await Promise.all([getMaster(groupId), groupTitle(groupId)]);
    const entries: ReportEntry[] = [];
    for (const item of items) {
      const subs = await getSubmissions(item.id);
      const byName = new Map(subs.filter((s) => s.memberName).map((s) => [s.memberName as string, s]));
      const lines = members.map((m) => {
        const s = byName.get(m.name);
        return `${marker(Boolean(s), Boolean(s?.reviewed), Boolean(s?.resubmitted))} ${escapeTelegramMarkdown(m.name)}`;
      });
      entries.push({ item, total: members.length, counts: tallySubmissions(subs), lines });
    }
    await sendReport(ctx, buildHomeworkReport(title, entries));
    await ctx.answerCbQuery(HW.reportGeneratedToast);
  }

  // ── Offline class surface (o:hw*) ───────────────────────────────────────────
  // Token = numeric gref; resolveManageableClass gates on owner/operator.

  async function resolveOffline(ctx: Context): Promise<ManageableClass | null> {
    const gref = readMatch(ctx)[1] ?? '';
    const userId = ctx.from?.id;
    if (!gref || userId === undefined) return null;
    const cls = await resolveManageableClass(gref, userId);
    if (!cls || (cls.role !== 'owner' && cls.role !== 'operator')) return null;
    return cls;
  }

  async function homeworkOffline(ctx: Context): Promise<void> {
    const cls = await resolveOffline(ctx);
    if (!cls) { await ctx.answerCbQuery(TEXT.adminOnly); return; }
    const list = await getHomework(cls.groupId);
    const view = homeworkListView('offline', String(cls.rowId), list);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function homeworkAddOffline(ctx: Context): Promise<void> {
    const cls = await resolveOffline(ctx);
    if (!cls) { await ctx.answerCbQuery(TEXT.adminOnly); return; }
    await beginForceReplyAwaiting(ctx, {
      setReplyPrompt,
      groupId: cls.groupId,
      record: { action: 'homeworkAddOffline', surface: 'offline', gref: String(cls.rowId) },
      sendPrompt: () => ctx.reply(HW.addPrompt, { parse_mode: 'Markdown', reply_markup: { force_reply: true } }),
    });
  }

  async function homeworkItemOffline(ctx: Context): Promise<void> {
    const cls = await resolveOffline(ctx);
    if (!cls) { await ctx.answerCbQuery(TEXT.adminOnly); return; }
    const id = readMatch(ctx)[2] ?? '';
    const item = await getHomeworkById(cls.groupId, id);
    if (!item) { await ctx.answerCbQuery(HW.missing); return; }
    const [members, submissions] = await Promise.all([
      getMembersWithIds(cls.groupId),
      getSubmissions(item.id),
    ]);
    const view = homeworkOfflineItemView(String(cls.rowId), item, members, submissions);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  // Cycle one student's state: ⬜️ → 📝 (submit) → ✅ (review) → 🔁 (resubmit) → ⬜️.
  async function homeworkToggleOffline(ctx: Context): Promise<void> {
    const cls = await resolveOffline(ctx);
    if (!cls) { await ctx.answerCbQuery(TEXT.adminOnly); return; }
    const id = readMatch(ctx)[2] ?? '';
    const memberId = Number(readMatch(ctx)[3] ?? '');
    const item = await getHomeworkById(cls.groupId, id);
    if (!item) { await ctx.answerCbQuery(HW.missing); return; }

    const before = await getSubmissions(item.id);
    const current = before.find((s) => s.memberId === memberId) ?? null;
    const userId = ctx.from?.id ?? null;
    await setSubmissionState(item.id, memberId, nextState(submissionState(current)), userId);

    const [members, submissions] = await Promise.all([
      getMembersWithIds(cls.groupId),
      getSubmissions(item.id),
    ]);
    const view = homeworkOfflineItemView(String(cls.rowId), item, members, submissions);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function homeworkRemoveOffline(ctx: Context): Promise<void> {
    const cls = await resolveOffline(ctx);
    if (!cls) { await ctx.answerCbQuery(TEXT.adminOnly); return; }
    const id = readMatch(ctx)[2] ?? '';
    const item = await getHomeworkById(cls.groupId, id);
    if (!item) { await ctx.answerCbQuery(HW.missing); return; }
    const view = homeworkRemoveConfirmView('offline', String(cls.rowId), item);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function homeworkRemoveExecOffline(ctx: Context): Promise<void> {
    const cls = await resolveOffline(ctx);
    if (!cls) { await ctx.answerCbQuery(TEXT.adminOnly); return; }
    const id = readMatch(ctx)[2] ?? '';
    const item = await getHomeworkById(cls.groupId, id);
    await removeHomework(cls.groupId, id);
    const list = await getHomework(cls.groupId);
    const view = homeworkListView('offline', String(cls.rowId), list);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery(item ? HW.removedToast(item.title) : undefined);
  }

  async function homeworkReportOffline(ctx: Context): Promise<void> {
    const cls = await resolveOffline(ctx);
    if (!cls) { await ctx.answerCbQuery(TEXT.adminOnly); return; }
    const items = await getHomework(cls.groupId);
    if (!items.length) { await ctx.answerCbQuery(HW.reportEmpty); return; }
    const members = await getMembersWithIds(cls.groupId);
    const entries: ReportEntry[] = [];
    for (const item of items) {
      const subs = await getSubmissions(item.id);
      const byMember = new Map(subs.filter((s) => s.memberId !== null).map((s) => [s.memberId as number, s]));
      const lines = members.map((m) => {
        const s = byMember.get(m.id);
        return `${marker(Boolean(s), Boolean(s?.reviewed), Boolean(s?.resubmitted))} ${escapeTelegramMarkdown(m.name)}`;
      });
      entries.push({ item, total: members.length, counts: tallySubmissions(subs), lines });
    }
    await sendReport(ctx, buildHomeworkReport(cls.name, entries));
    await ctx.answerCbQuery(HW.reportGeneratedToast);
  }

  return {
    onHomeworkMessage,
    homeworkGroup,
    homeworkItemGroup,
    homeworkTagGroup,
    homeworkReportGroup,
    homeworkRemoveGroup,
    homeworkRemoveExecGroup,
    homeworkOffline,
    homeworkAddOffline,
    homeworkItemOffline,
    homeworkToggleOffline,
    homeworkReportOffline,
    homeworkRemoveOffline,
    homeworkRemoveExecOffline,
  };
}

export function register(bot: BotLike, storage: Storage): void {
  const h = createHandlers({ storage, telegram: bot.telegram });
  bot.on(['text', 'document', 'photo', 'video', 'audio'], h.onHomeworkMessage);

  // Group /manage surface (Telegram chat id token, may be negative).
  bot.action(/^mg:hw:(-?\d+)$/, h.homeworkGroup);
  bot.action(/^mg:hwit:(-?\d+):(\d+)$/, h.homeworkItemGroup);
  bot.action(/^mg:hwtag:(-?\d+):(\d+)$/, h.homeworkTagGroup);
  bot.action(/^mg:hwrep:(-?\d+)$/, h.homeworkReportGroup);
  bot.action(/^mg:hwrm:(-?\d+):(\d+)$/, h.homeworkRemoveGroup);
  bot.action(/^mg:hwrmx:(-?\d+):(\d+)$/, h.homeworkRemoveExecGroup);

  // Offline class surface (numeric gref token).
  bot.action(/^o:hw:(\d+)$/, h.homeworkOffline);
  bot.action(/^o:hwadd:(\d+)$/, h.homeworkAddOffline);
  bot.action(/^o:hwit:(\d+):(\d+)$/, h.homeworkItemOffline);
  bot.action(/^o:hwtog:(\d+):(\d+):(\d+)$/, h.homeworkToggleOffline);
  bot.action(/^o:hwrep:(\d+)$/, h.homeworkReportOffline);
  bot.action(/^o:hwrm:(\d+):(\d+)$/, h.homeworkRemoveOffline);
  bot.action(/^o:hwrmx:(\d+):(\d+)$/, h.homeworkRemoveExecOffline);
}
