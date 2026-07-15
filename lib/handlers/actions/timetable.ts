// Weekly lesson timetable (the class "roster"/schedule).
//
// A class can define recurring weekly slots: a session type held on a weekday at
// a time, with an optional linked teacher. This is a PLAN only — it never
// creates attendance sessions (those stay ad-hoc in the offline sessions log).
// The slots have stable ids so a future scheduled-actions feature can reference
// a slot to fire timed reminders relative to its day/time.
//
// Surfaces:
//   • per-class panel (o:tt*)  — owner/operator manage slots; any role views week
//   • cross-class "my week"     — /myweek aggregates every class the user manages
import { Markup } from 'telegraf';
import type { Context, Telegram } from 'telegraf';
import { TEXT } from '../../text.js';
import { beginForceReplyAwaiting, replyEphemeral, logTelegramError } from '../../helpers.js';
import { clampButtonLabel } from '../../historyUtils.js';

const TT = TEXT.timetable;

// Session types a slot may schedule (mirrors OFFLINE_SESSION_TYPES in offline.js).
const SCHEDULE_TYPES = ['main', 'registeredSecondary', 'training'];

// Curated timezone list (TEXT.timetable.timezones); first entry is the default.
const TIMEZONES = TT.timezones as { id: string; label: string }[];

// Every IANA zone the runtime knows, for the "all zones" browser. Grouped by the
// region prefix (Africa, Asia, …) so a viewer can drill down instead of paging
// hundreds of flat entries.
const ALL_ZONES: string[] = (typeof Intl.supportedValuesOf === 'function'
  ? (Intl.supportedValuesOf('timeZone') as string[])
  : TIMEZONES.map((z) => z.id)).slice().sort();
const ALL_ZONE_SET = new Set(ALL_ZONES);
const ZONE_REGIONS: string[] = [...new Set(ALL_ZONES.map((z) => z.split('/')[0] ?? z))];
const ZONES_PAGE_SIZE = 8;

function zonesInRegion(region: string): string[] {
  return ALL_ZONES.filter((z) => (z.split('/')[0] ?? z) === region);
}

// A short "UTC±H[:MM]" suffix for a zone at the current instant.
function offsetLabel(tz: string): string {
  const min = Math.round(tzOffsetMs(new Date(), tz) / 60000);
  const sign = min < 0 ? '-' : '+';
  const h = Math.floor(Math.abs(min) / 60);
  const m = Math.abs(min) % 60;
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
}

// Display label for an arbitrary zone in the browser: the sub-region path (region
// prefix stripped, underscores spaced) plus its current offset.
function zoneBrowseLabel(tz: string): string {
  const rest = tz.includes('/') ? tz.slice(tz.indexOf('/') + 1) : tz;
  return `${rest.replace(/_/g, ' ')} (${offsetLabel(tz)})`;
}

// Human label for an IANA zone; prefers the curated Arabic label, else a
// browse-style label with offset.
function tzLabel(tz: string): string {
  return TIMEZONES.find((z) => z.id === tz)?.label ?? zoneBrowseLabel(tz);
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

// Offset (ms) of `tz` from UTC at a given instant: wallClock(tz) − utc.
function tzOffsetMs(instant: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = dtf.formatToParts(instant);
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  const asUTC = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUTC - instant.getTime();
}

// UTC instant for a wall-clock time expressed in `tz` (DST-refined).
function wallToUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi, 0);
  let ts = guess - tzOffsetMs(new Date(guess), tz);
  ts = guess - tzOffsetMs(new Date(ts), tz);
  return new Date(ts);
}

// Weekday (0=Sun..6=Sat) and HH:MM of an instant as seen in `tz`.
function partsInTz(instant: Date, tz: string): { day: number; time: string } {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', weekday: 'short', hour: '2-digit', minute: '2-digit',
  });
  const p = dtf.formatToParts(instant);
  const val = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return {
    day: WEEKDAY_INDEX[val('weekday')] ?? 0,
    time: `${val('hour')}:${val('minute')}`,
  };
}

// Convert a recurring weekly slot (dayOfWeek + HH:MM in `fromTz`) into `toTz`,
// honoring DST and rolling the weekday when the time crosses midnight. Uses the
// current week as the reference instant. No-op when zones match or toTz is null.
function convertSlot(dayOfWeek: number, time: string, fromTz: string, toTz: string | null): { dayOfWeek: number; time: string } {
  if (!toTz || fromTz === toTz) return { dayOfWeek, time };
  const [h, mi] = time.split(':').map(Number);
  const now = new Date();
  // Find a concrete date (within the coming week) that IS `dayOfWeek` in fromTz.
  for (let i = 0; i < 8; i += 1) {
    const inst = wallToUtc(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate() + i, h ?? 0, mi ?? 0, fromTz);
    if (partsInTz(inst, fromTz).day === dayOfWeek) {
      const p = partsInTz(inst, toTz);
      return { dayOfWeek: p.day, time: p.time };
    }
  }
  return { dayOfWeek, time };
}

// Weekday order (length 7) starting at `weekStart` (0=Sun..6=Sat), wrapping.
function weekOrder(weekStart: number): number[] {
  const start = ((weekStart % 7) + 7) % 7;
  return Array.from({ length: 7 }, (_, i) => (start + i) % 7);
}


interface Slot {
  id: number;
  sessionType: string;
  dayOfWeek: number;
  timeOfDay: string;
  teacherId: number | null;
  teacherName: string | null;
  teacherTypes: string[] | null;
}

interface UserSlot {
  id: number;
  groupId: number;
  className: string;
  sessionType: string;
  dayOfWeek: number;
  timeOfDay: string;
  teacherName: string | null;
  timezone: string;
}

interface Teacher {
  id: number;
  name: string;
  types: string[];
}

interface UserPrefs {
  timezone: string | null;
  weekStart: number;
}

interface ManageableClass {
  groupId: string;
  rowId: string | number;
  role: string;
  name: string;
}

interface ReplyPromptRecord {
  action?: string;
  groupId?: string;
  gref?: string;
  sessionType?: string;
  dayOfWeek?: number;
  chatId?: number | string;
  msgId?: number;
  [key: string]: unknown;
}

interface Storage {
  getReplyPrompt(chatId: string, promptMsgId: number): Promise<ReplyPromptRecord | null>;
  delReplyPrompt(chatId: string, promptMsgId: number): Promise<void>;
  setReplyPrompt(chatId: string, promptMsgId: number, record: Record<string, unknown>): Promise<void>;
  resolveManageableClass(gref: string, userId: number | string): Promise<ManageableClass | null>;
  listScheduleSlots(groupId: string): Promise<Slot[]>;
  getScheduleSlot(groupId: string, slotId: string): Promise<Slot | null>;
  addScheduleSlot(groupId: string, slot: { sessionType: string; dayOfWeek: number; timeOfDay: string; teacherId: number | null }): Promise<number | null>;
  setScheduleSlotTeacher(groupId: string, slotId: string, teacherId: number | null): Promise<void>;
  removeScheduleSlot(groupId: string, slotId: string): Promise<void>;
  listScheduleForUser(userId: number | string): Promise<UserSlot[]>;
  getTeachers(groupId: string): Promise<Teacher[]>;
  getClassTimezone(groupId: string): Promise<string>;
  setClassTimezone(groupId: string, timezone: string): Promise<void>;
  getUserPrefs(userId: number | string): Promise<UserPrefs>;
  setUserTimezone(userId: number | string, timezone: string | null): Promise<void>;
  setUserWeekStart(userId: number | string, weekStart: number): Promise<void>;
}

type Handler = (ctx: Context, next: () => Promise<void>) => unknown;

interface BotLike {
  telegram: Telegram;
  on(updateType: string | string[], handler: Handler): unknown;
  action(trigger: RegExp | string, handler: Handler): unknown;
  command(name: string, handler: Handler): unknown;
}

interface IncomingMessage {
  message_id: number;
  text?: string;
  reply_to_message?: { message_id: number };
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

function dismissRow() {
  return [Markup.button.callback(TEXT.closeButton, 'msg:dismiss')];
}

function typeLabel(type: string): string {
  return (TEXT.historyTypeTitle as Record<string, string>)[type] || type;
}

function dayLabel(day: number): string {
  return TT.weekdays[day] ?? String(day);
}

function readMatch(ctx: Context): RegExpExecArray {
  const m = (ctx as unknown as { match?: RegExpExecArray }).match;
  return m ?? ([] as unknown as RegExpExecArray);
}

// Validate + normalize an HH:MM (24h) time. Returns 'HH:MM' or null.
function normalizeTime(raw: string): string | null {
  const m = /^\s*([01]?\d|2[0-3]):([0-5]\d)\s*$/.exec(raw);
  if (!m) return null;
  const hh = String(Number(m[1])).padStart(2, '0');
  return `${hh}:${m[2]}`;
}

function canManage(role: string): boolean {
  return role === 'owner' || role === 'operator';
}

// ── Renderers ────────────────────────────────────────────────────────────────

function panelView(cls: ManageableClass, slots: Slot[], timezone: string, canEdit: boolean) {
  const g = cls.rowId;
  const rows = slots.map((s) => [Markup.button.callback(
    clampButtonLabel(TT.slotRow(dayLabel(s.dayOfWeek), s.timeOfDay, typeLabel(s.sessionType), s.teacherName)),
    `o:ttslot:${g}:${s.id}`,
  )]);
  rows.push([Markup.button.callback(TT.weekViewButton, `o:ttweek:${g}`)]);
  if (canEdit) {
    rows.push([Markup.button.callback(TT.addButton, `o:ttadd:${g}`)]);
    rows.push([Markup.button.callback(TT.tzButton, `o:tttz:${g}`)]);
  }
  rows.push([Markup.button.callback(TEXT.backButton, `o:cls:${g}`), ...dismissRow()]);
  const hint = slots.length ? TT.panelHint : TT.empty;
  const header = `${TT.title(cls.name)}\n${TT.tzHeader(tzLabel(timezone))}`;
  return { text: `${header}\n\n${hint}`, keyboard: Markup.inlineKeyboard(rows) };
}

// Timezone picker (owner/operator). Two zones per row for a compact keyboard.
function tzPickerView(cls: ManageableClass, current: string) {
  const g = cls.rowId;
  const rows = [];
  for (let i = 0; i < TIMEZONES.length; i += 2) {
    const a = TIMEZONES[i];
    if (!a) continue;
    const b = TIMEZONES[i + 1];
    const row = [tzButtonFor(g, a, current)];
    if (b) row.push(tzButtonFor(g, b, current));
    rows.push(row);
  }
  rows.push([Markup.button.callback(TT.allZonesButton, `o:tzr:${g}`)]);
  rows.push([Markup.button.callback(TEXT.backButton, `o:tt:${g}`), ...dismissRow()]);
  return { text: TT.tzPickTitle, keyboard: Markup.inlineKeyboard(rows) };
}

function tzButtonFor(g: string | number, zone: { id: string; label: string }, current: string) {
  const mark = zone.id === current ? '✅ ' : '';
  return Markup.button.callback(clampButtonLabel(`${mark}${zone.label}`), `o:tttzx:${g}:${zone.id}`);
}

// Shared "all zones" browser. Region list, then a paginated list of the zones in
// that region. `regionCb`/`zoneCb`/`navCb` are supplied by each picker so the
// final selection reuses that picker's existing apply callback.
function regionListView(regionCb: (i: number) => string, back: string) {
  const rows = [];
  for (let i = 0; i < ZONE_REGIONS.length; i += 2) {
    const a = ZONE_REGIONS[i];
    if (!a) continue;
    const row = [Markup.button.callback(a, regionCb(i))];
    const b = ZONE_REGIONS[i + 1];
    if (b) row.push(Markup.button.callback(b, regionCb(i + 1)));
    rows.push(row);
  }
  rows.push([Markup.button.callback(TEXT.backButton, back), ...dismissRow()]);
  return { text: TT.allZonesRegionTitle, keyboard: Markup.inlineKeyboard(rows) };
}

function zonesPageView(
  regionIdx: number,
  page: number,
  current: string | null,
  zoneCb: (tz: string) => string,
  navCb: (page: number) => string,
  back: string,
) {
  const region = ZONE_REGIONS[regionIdx] ?? '';
  const zones = zonesInRegion(region);
  const totalPages = Math.max(1, Math.ceil(zones.length / ZONES_PAGE_SIZE));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const start = safePage * ZONES_PAGE_SIZE;
  const rows = zones.slice(start, start + ZONES_PAGE_SIZE).map((tz) => {
    const mark = tz === current ? '✅ ' : '';
    return [Markup.button.callback(clampButtonLabel(`${mark}${zoneBrowseLabel(tz)}`), zoneCb(tz))];
  });
  if (totalPages > 1) {
    rows.push([
      ...(safePage > 0 ? [Markup.button.callback(TEXT.navigationPrevButton, navCb(safePage - 1))] : []),
      Markup.button.callback(`📄 ${safePage + 1}/${totalPages}`, 'o:noop'),
      ...(safePage < totalPages - 1 ? [Markup.button.callback(TEXT.navigationNextButton, navCb(safePage + 1))] : []),
    ]);
  }
  rows.push([Markup.button.callback(TEXT.backButton, back), ...dismissRow()]);
  return { text: TT.allZonesZoneTitle(region), keyboard: Markup.inlineKeyboard(rows) };
}

function pickTypeView(cls: ManageableClass) {
  const g = cls.rowId;
  const rows = SCHEDULE_TYPES.map((t) => [Markup.button.callback(typeLabel(t), `o:ttaddt:${g}:${t}`)]);
  rows.push([Markup.button.callback(TEXT.backButton, `o:tt:${g}`), ...dismissRow()]);
  return { text: TT.pickType, keyboard: Markup.inlineKeyboard(rows) };
}

function pickDayView(cls: ManageableClass, type: string) {
  const g = cls.rowId;
  const rows = [];
  // Two weekdays per row for a compact keyboard.
  for (let d = 0; d < 7; d += 2) {
    const row = [Markup.button.callback(dayLabel(d), `o:ttaddd:${g}:${type}:${d}`)];
    if (d + 1 < 7) row.push(Markup.button.callback(dayLabel(d + 1), `o:ttaddd:${g}:${type}:${d + 1}`));
    rows.push(row);
  }
  rows.push([Markup.button.callback(TEXT.backButton, `o:ttadd:${g}`), ...dismissRow()]);
  return { text: TT.pickDay, keyboard: Markup.inlineKeyboard(rows) };
}

function slotMenuView(cls: ManageableClass, slot: Slot, canEdit: boolean) {
  const g = cls.rowId;
  const rows = [];
  if (canEdit) {
    rows.push([Markup.button.callback(TT.assignTeacherButton, `o:ttasg:${g}:${slot.id}`)]);
    rows.push([Markup.button.callback(TT.removeButton, `o:ttrm:${g}:${slot.id}`)]);
  }
  rows.push([Markup.button.callback(TEXT.backButton, `o:tt:${g}`), ...dismissRow()]);
  const text = TT.slotMenuTitle(dayLabel(slot.dayOfWeek), slot.timeOfDay, typeLabel(slot.sessionType), slot.teacherName);
  return { text, keyboard: Markup.inlineKeyboard(rows) };
}

function teacherPickerView(cls: ManageableClass, slot: Slot, teachers: Teacher[]) {
  const g = cls.rowId;
  if (!teachers.length) {
    return {
      text: TT.noTeachersYet,
      keyboard: Markup.inlineKeyboard([[Markup.button.callback(TEXT.backButton, `o:ttslot:${g}:${slot.id}`), ...dismissRow()]]),
    };
  }
  const rows = teachers.map((t) => [Markup.button.callback(
    clampButtonLabel(`${TEXT.teacherTypesLabel(t.types)} ${t.name}`),
    `o:ttasgd:${g}:${slot.id}:${t.id}`,
  )]);
  rows.push([Markup.button.callback(TT.noTeacherButton, `o:ttasgd:${g}:${slot.id}:0`)]);
  rows.push([Markup.button.callback(TEXT.backButton, `o:ttslot:${g}:${slot.id}`), ...dismissRow()]);
  return { text: TT.pickTeacher, keyboard: Markup.inlineKeyboard(rows) };
}

function removeConfirmView(cls: ManageableClass, slot: Slot) {
  const g = cls.rowId;
  const rows = [
    [Markup.button.callback(TT.confirmRemoveButton, `o:ttrmx:${g}:${slot.id}`)],
    [Markup.button.callback(TEXT.backButton, `o:ttslot:${g}:${slot.id}`), ...dismissRow()],
  ];
  return { text: TT.removeConfirm(dayLabel(slot.dayOfWeek), slot.timeOfDay, typeLabel(slot.sessionType)), keyboard: Markup.inlineKeyboard(rows) };
}

// The timezone a viewer effectively sees times in: her chosen zone, or the
// class's own zone when she hasn't set one ("follow class").
function effectiveViewTz(prefs: UserPrefs, classTz: string): string {
  return prefs.timezone ?? classTz;
}

// Two per-viewer controls (view timezone + week start), shared by the per-class
// week view (scope 'c', needs the class id) and cross-class my-week (scope 'm').
function viewPrefsRows(scope: 'c' | 'm', g: string | number) {
  return [[
    Markup.button.callback(TT.viewTzButton, `o:vtz:${scope}:${g}`),
    Markup.button.callback(TT.weekStartButton, `o:vws:${scope}:${g}`),
  ]];
}

// Group slots into a printable week body, converted into the viewer's timezone
// and ordered from her chosen week-start day.
function weekBody(slots: Slot[], fromTz: string, viewTz: string, weekStart: number): string {
  const byDay = new Map<number, { time: string; s: Slot }[]>();
  for (const s of slots) {
    const c = convertSlot(s.dayOfWeek, s.timeOfDay, fromTz, viewTz);
    const list = byDay.get(c.dayOfWeek) ?? [];
    list.push({ time: c.time, s });
    byDay.set(c.dayOfWeek, list);
  }
  const blocks: string[] = [];
  for (const d of weekOrder(weekStart)) {
    const list = byDay.get(d);
    if (!list || !list.length) continue;
    list.sort((a, b) => a.time.localeCompare(b.time));
    const lines = list.map(({ time, s }) => TT.weekSlotLine(time, typeLabel(s.sessionType), s.teacherName));
    blocks.push(`${TT.dayHeader(dayLabel(d))}\n${lines.join('\n')}`);
  }
  return blocks.join('\n\n');
}

function weekView(cls: ManageableClass, slots: Slot[], classTz: string, prefs: UserPrefs) {
  const g = cls.rowId;
  const viewTz = effectiveViewTz(prefs, classTz);
  const body = slots.length ? weekBody(slots, classTz, viewTz, prefs.weekStart) : TT.weekEmpty;
  const rows = [
    ...viewPrefsRows('c', g),
    [Markup.button.callback(TEXT.backButton, `o:tt:${g}`), ...dismissRow()],
  ];
  const header = `${TT.weekTitle(cls.name)}\n${TT.viewTzHeader(tzLabel(viewTz))}`;
  return { text: `${header}\n\n${body}`, keyboard: Markup.inlineKeyboard(rows) };
}

// Cross-class "my week": group by day (converted to the viewer's timezone when
// she set one, otherwise each line keeps its own class timezone), each line
// tagged with its class.
function myWeekBody(slots: UserSlot[], prefs: UserPrefs): string {
  const byDay = new Map<number, { time: string; tz: string; s: UserSlot }[]>();
  for (const s of slots) {
    const viewTz = prefs.timezone ?? s.timezone;
    const c = convertSlot(s.dayOfWeek, s.timeOfDay, s.timezone, prefs.timezone);
    const list = byDay.get(c.dayOfWeek) ?? [];
    list.push({ time: c.time, tz: viewTz, s });
    byDay.set(c.dayOfWeek, list);
  }
  const blocks: string[] = [];
  for (const d of weekOrder(prefs.weekStart)) {
    const list = byDay.get(d);
    if (!list || !list.length) continue;
    list.sort((a, b) => a.time.localeCompare(b.time));
    const lines = list.map(({ time, tz, s }) =>
      TT.myWeekSlotLineTz(time, tzLabel(tz), s.className, typeLabel(s.sessionType), s.teacherName));
    blocks.push(`${TT.dayHeader(dayLabel(d))}\n${lines.join('\n')}`);
  }
  return blocks.join('\n\n');
}

// My-week message (used by /myweek and re-rendered after a preference change).
function myWeekView(slots: UserSlot[], prefs: UserPrefs) {
  const body = slots.length ? myWeekBody(slots, prefs) : TT.weekEmpty;
  const viewLabel = prefs.timezone ? tzLabel(prefs.timezone) : TT.viewTzAuto;
  const rows = [
    ...viewPrefsRows('m', 0),
    [...dismissRow()],
  ];
  const header = `${TT.myWeekTitle}\n${TT.viewTzHeader(viewLabel)}`;
  return { text: `${header}\n\n${body}`, keyboard: Markup.inlineKeyboard(rows) };
}

// Per-viewer view-timezone picker. `back` is the callback to return to.
function viewTzPickerView(scope: 'c' | 'm', g: string | number, current: string | null, back: string) {
  const rows = [[Markup.button.callback(
    `${current === null ? '✅ ' : ''}${TT.viewTzAutoButton}`,
    `o:vtzx:${scope}:${g}:auto`,
  )]];
  for (let i = 0; i < TIMEZONES.length; i += 2) {
    const a = TIMEZONES[i];
    if (!a) continue;
    const b = TIMEZONES[i + 1];
    const row = [viewTzButtonFor(scope, g, a, current)];
    if (b) row.push(viewTzButtonFor(scope, g, b, current));
    rows.push(row);
  }
  rows.push([Markup.button.callback(TT.allZonesButton, `o:vzr:${scope}:${g}`)]);
  rows.push([Markup.button.callback(TEXT.backButton, back), ...dismissRow()]);
  return { text: TT.viewTzPickTitle, keyboard: Markup.inlineKeyboard(rows) };
}

function viewTzButtonFor(scope: 'c' | 'm', g: string | number, zone: { id: string; label: string }, current: string | null) {
  const mark = zone.id === current ? '✅ ' : '';
  return Markup.button.callback(clampButtonLabel(`${mark}${zone.label}`), `o:vtzx:${scope}:${g}:${zone.id}`);
}

// Per-viewer week-start picker. Two weekdays per row.
function weekStartPickerView(scope: 'c' | 'm', g: string | number, current: number, back: string) {
  const rows = [];
  for (let d = 0; d < 7; d += 2) {
    const row = [weekStartButtonFor(scope, g, d, current)];
    if (d + 1 < 7) row.push(weekStartButtonFor(scope, g, d + 1, current));
    rows.push(row);
  }
  rows.push([Markup.button.callback(TEXT.backButton, back), ...dismissRow()]);
  return { text: TT.weekStartPickTitle, keyboard: Markup.inlineKeyboard(rows) };
}

function weekStartButtonFor(scope: 'c' | 'm', g: string | number, day: number, current: number) {
  const mark = day === current ? '✅ ' : '';
  return Markup.button.callback(`${mark}${dayLabel(day)}`, `o:vwsx:${scope}:${g}:${day}`);
}


export function createHandlers({ storage }: { storage: Storage }) {
  const {
    setReplyPrompt,
    getReplyPrompt,
    delReplyPrompt,
    resolveManageableClass,
    listScheduleSlots,
    getScheduleSlot,
    addScheduleSlot,
    setScheduleSlotTeacher,
    removeScheduleSlot,
    listScheduleForUser,
    getTeachers,
    getClassTimezone,
    setClassTimezone,
    getUserPrefs,
    setUserTimezone,
    setUserWeekStart,
  } = storage;

  // Resolve the class for any role (viewing is open); returns null if unresolved.
  async function resolve(ctx: Context): Promise<ManageableClass | null> {
    const gref = readMatch(ctx)[1] ?? '';
    const userId = ctx.from?.id;
    if (!gref || userId === undefined) return null;
    return resolveManageableClass(gref, userId);
  }

  async function panel(ctx: Context): Promise<void> {
    const cls = await resolve(ctx);
    if (!cls) { await ctx.answerCbQuery(TEXT.adminOnly); return; }
    const slots = await listScheduleSlots(cls.groupId);
    const timezone = await getClassTimezone(cls.groupId);
    const view = panelView(cls, slots, timezone, canManage(cls.role));
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function week(ctx: Context): Promise<void> {
    const cls = await resolve(ctx);
    if (!cls) { await ctx.answerCbQuery(TEXT.adminOnly); return; }
    const slots = await listScheduleSlots(cls.groupId);
    const classTz = await getClassTimezone(cls.groupId);
    const prefs = await getUserPrefs(ctx.from?.id ?? '');
    const view = weekView(cls, slots, classTz, prefs);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  // ── Per-viewer display preferences (view timezone + week start) ────────────
  // These are personal to the viewer and apply to both the per-class week view
  // (scope 'c', with the class id) and cross-class my-week (scope 'm').

  // Re-render whichever week surface the viewer came from after a pref change.
  async function rerenderWeek(ctx: Context, scope: string, g: string): Promise<void> {
    const userId = ctx.from?.id ?? '';
    const prefs = await getUserPrefs(userId);
    if (scope === 'm') {
      const slots = await listScheduleForUser(userId);
      const view = myWeekView(slots, prefs);
      await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
      return;
    }
    const cls = await resolveManageableClass(g, userId);
    if (!cls) return;
    const slots = await listScheduleSlots(cls.groupId);
    const classTz = await getClassTimezone(cls.groupId);
    const view = weekView(cls, slots, classTz, prefs);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
  }

  function backFor(scope: string, g: string): string {
    return scope === 'm' ? 'o:mw' : `o:ttweek:${g}`;
  }

  // My-week re-render entry (returned to from the pref pickers).
  async function myWeekRefresh(ctx: Context): Promise<void> {
    await rerenderWeek(ctx, 'm', '0');
    await ctx.answerCbQuery();
  }

  async function viewTzPicker(ctx: Context): Promise<void> {
    const m = readMatch(ctx);
    const scope = m[1] ?? 'm';
    const g = m[2] ?? '0';
    const prefs = await getUserPrefs(ctx.from?.id ?? '');
    const view = viewTzPickerView(scope as 'c' | 'm', g, prefs.timezone, backFor(scope, g));
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function viewTzApply(ctx: Context): Promise<void> {
    const m = readMatch(ctx);
    const scope = m[1] ?? 'm';
    const g = m[2] ?? '0';
    const tz = m[3] ?? '';
    if (tz !== 'auto' && !ALL_ZONE_SET.has(tz)) { await ctx.answerCbQuery(TT.missing); return; }
    await setUserTimezone(ctx.from?.id ?? '', tz === 'auto' ? null : tz);
    await rerenderWeek(ctx, scope, g);
    await ctx.answerCbQuery(TT.viewTzUpdated);
  }

  async function weekStartPicker(ctx: Context): Promise<void> {
    const m = readMatch(ctx);
    const scope = m[1] ?? 'm';
    const g = m[2] ?? '0';
    const prefs = await getUserPrefs(ctx.from?.id ?? '');
    const view = weekStartPickerView(scope as 'c' | 'm', g, prefs.weekStart, backFor(scope, g));
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function weekStartApply(ctx: Context): Promise<void> {
    const m = readMatch(ctx);
    const scope = m[1] ?? 'm';
    const g = m[2] ?? '0';
    const day = Number(m[3] ?? NaN);
    if (!Number.isInteger(day) || day < 0 || day > 6) { await ctx.answerCbQuery(TT.missing); return; }
    await setUserWeekStart(ctx.from?.id ?? '', day);
    await rerenderWeek(ctx, scope, g);
    await ctx.answerCbQuery(TT.weekStartUpdated);
  }

  // Timezone picker + apply (owner/operator only).
  async function tzPicker(ctx: Context): Promise<void> {
    const cls = await resolve(ctx);
    if (!cls || !canManage(cls.role)) { await ctx.answerCbQuery(TEXT.adminOnly); return; }
    const current = await getClassTimezone(cls.groupId);
    const view = tzPickerView(cls, current);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function tzApply(ctx: Context): Promise<void> {
    const cls = await resolve(ctx);
    if (!cls || !canManage(cls.role)) { await ctx.answerCbQuery(TEXT.adminOnly); return; }
    const tz = readMatch(ctx)[2] ?? '';
    if (!ALL_ZONE_SET.has(tz)) { await ctx.answerCbQuery(TT.missing); return; }
    await setClassTimezone(cls.groupId, tz);
    const slots = await listScheduleSlots(cls.groupId);
    const view = panelView(cls, slots, tz, canManage(cls.role));
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery(TT.tzUpdated);
  }

  // All-zones browser for the class-source picker (owner/operator only).
  async function tzRegions(ctx: Context): Promise<void> {
    const cls = await resolve(ctx);
    if (!cls || !canManage(cls.role)) { await ctx.answerCbQuery(TEXT.adminOnly); return; }
    const g = cls.rowId;
    const view = regionListView((i) => `o:tzp:${g}:${i}:0`, `o:tttz:${g}`);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function tzZonesPage(ctx: Context): Promise<void> {
    const cls = await resolve(ctx);
    if (!cls || !canManage(cls.role)) { await ctx.answerCbQuery(TEXT.adminOnly); return; }
    const g = cls.rowId;
    const m = readMatch(ctx);
    const regionIdx = Number(m[2] ?? 0);
    const page = Number(m[3] ?? 0);
    const current = await getClassTimezone(cls.groupId);
    const view = zonesPageView(
      regionIdx, page, current,
      (tz) => `o:tttzx:${g}:${tz}`,
      (p) => `o:tzp:${g}:${regionIdx}:${p}`,
      `o:tzr:${g}`,
    );
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  // All-zones browser for the per-viewer display-timezone picker.
  async function viewTzRegions(ctx: Context): Promise<void> {
    const m = readMatch(ctx);
    const scope = m[1] ?? 'm';
    const g = m[2] ?? '0';
    const view = regionListView((i) => `o:vzp:${scope}:${g}:${i}:0`, `o:vtz:${scope}:${g}`);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function viewTzZonesPage(ctx: Context): Promise<void> {
    const m = readMatch(ctx);
    const scope = m[1] ?? 'm';
    const g = m[2] ?? '0';
    const regionIdx = Number(m[3] ?? 0);
    const page = Number(m[4] ?? 0);
    const prefs = await getUserPrefs(ctx.from?.id ?? '');
    const view = zonesPageView(
      regionIdx, page, prefs.timezone,
      (tz) => `o:vtzx:${scope}:${g}:${tz}`,
      (p) => `o:vzp:${scope}:${g}:${regionIdx}:${p}`,
      `o:vzr:${scope}:${g}`,
    );
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function addPickType(ctx: Context): Promise<void> {
    const cls = await resolve(ctx);
    if (!cls || !canManage(cls.role)) { await ctx.answerCbQuery(TEXT.adminOnly); return; }
    const view = pickTypeView(cls);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function addPickDay(ctx: Context): Promise<void> {
    const cls = await resolve(ctx);
    if (!cls || !canManage(cls.role)) { await ctx.answerCbQuery(TEXT.adminOnly); return; }
    const type = readMatch(ctx)[2] ?? '';
    if (!SCHEDULE_TYPES.includes(type)) { await ctx.answerCbQuery(TT.missing); return; }
    const view = pickDayView(cls, type);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  // After picking type + day, force-reply for the time (captured by onMessage).
  async function addPromptTime(ctx: Context): Promise<void> {
    const cls = await resolve(ctx);
    if (!cls || !canManage(cls.role)) { await ctx.answerCbQuery(TEXT.adminOnly); return; }
    const m = readMatch(ctx);
    const type = m[2] ?? '';
    const day = Number(m[3] ?? NaN);
    if (!SCHEDULE_TYPES.includes(type) || !Number.isInteger(day)) { await ctx.answerCbQuery(TT.missing); return; }
    await beginForceReplyAwaiting(ctx, {
      setReplyPrompt,
      groupId: cls.groupId,
      record: { action: 'timetableTime', gref: String(cls.rowId), sessionType: type, dayOfWeek: day },
      sendPrompt: () => ctx.reply(TT.timePrompt, { parse_mode: 'Markdown', reply_markup: { force_reply: true } }),
    });
  }

  async function slotMenu(ctx: Context): Promise<void> {
    const cls = await resolve(ctx);
    if (!cls) { await ctx.answerCbQuery(TEXT.adminOnly); return; }
    const slotId = readMatch(ctx)[2] ?? '';
    const slot = await getScheduleSlot(cls.groupId, slotId);
    if (!slot) { await ctx.answerCbQuery(TT.missing); return; }
    const view = slotMenuView(cls, slot, canManage(cls.role));
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function assignTeacherMenu(ctx: Context): Promise<void> {
    const cls = await resolve(ctx);
    if (!cls || !canManage(cls.role)) { await ctx.answerCbQuery(TEXT.adminOnly); return; }
    const slotId = readMatch(ctx)[2] ?? '';
    const slot = await getScheduleSlot(cls.groupId, slotId);
    if (!slot) { await ctx.answerCbQuery(TT.missing); return; }
    const teachers = await getTeachers(cls.groupId);
    const view = teacherPickerView(cls, slot, teachers);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function assignTeacher(ctx: Context): Promise<void> {
    const cls = await resolve(ctx);
    if (!cls || !canManage(cls.role)) { await ctx.answerCbQuery(TEXT.adminOnly); return; }
    const m = readMatch(ctx);
    const slotId = m[2] ?? '';
    const teacherId = Number(m[3] ?? 0) || null;
    const slot = await getScheduleSlot(cls.groupId, slotId);
    if (!slot) { await ctx.answerCbQuery(TT.missing); return; }
    await setScheduleSlotTeacher(cls.groupId, slotId, teacherId);
    const updated = await getScheduleSlot(cls.groupId, slotId);
    const view = slotMenuView(cls, updated ?? slot, canManage(cls.role));
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery(teacherId ? TT.teacherAssigned : TT.teacherCleared);
  }

  async function removeConfirm(ctx: Context): Promise<void> {
    const cls = await resolve(ctx);
    if (!cls || !canManage(cls.role)) { await ctx.answerCbQuery(TEXT.adminOnly); return; }
    const slotId = readMatch(ctx)[2] ?? '';
    const slot = await getScheduleSlot(cls.groupId, slotId);
    if (!slot) { await ctx.answerCbQuery(TT.missing); return; }
    const view = removeConfirmView(cls, slot);
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery();
  }

  async function removeExec(ctx: Context): Promise<void> {
    const cls = await resolve(ctx);
    if (!cls || !canManage(cls.role)) { await ctx.answerCbQuery(TEXT.adminOnly); return; }
    const slotId = readMatch(ctx)[2] ?? '';
    await removeScheduleSlot(cls.groupId, slotId);
    const slots = await listScheduleSlots(cls.groupId);
    const timezone = await getClassTimezone(cls.groupId);
    const view = panelView(cls, slots, timezone, canManage(cls.role));
    await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    await ctx.answerCbQuery(TT.removedToast);
  }

  // /myweek — cross-class aggregated week for every class the user manages or
  // is enrolled in (visible to everyone), shown in her chosen view preferences.
  async function myWeek(ctx: Context): Promise<void> {
    if (ctx.chat?.type !== 'private') return;
    const userId = ctx.from?.id;
    if (userId === undefined) return;
    const slots = await listScheduleForUser(userId);
    const prefs = await getUserPrefs(userId);
    const view = myWeekView(slots, prefs);
    await ctx.reply(view.text, { parse_mode: 'Markdown', ...view.keyboard });
  }

  // Capture the time reply that completes an add flow.
  async function onMessage(ctx: Context, next: () => Promise<void>): Promise<void> {
    if (ctx.chat?.type !== 'private') return next();
    const msg = ctx.message as IncomingMessage | undefined;
    const replyTo = msg?.reply_to_message;
    if (!msg || !replyTo) return next();
    const chatKey = String(ctx.chat.id);
    const pending = await getReplyPrompt(chatKey, replyTo.message_id);
    if (!pending || pending.action !== 'timetableTime' || !pending.groupId) return next();

    const time = normalizeTime(msg.text ?? '');
    if (!time) {
      // Keep the prompt open so she can retype a valid time.
      await replyEphemeral(ctx, TT.timeInvalid);
      return;
    }
    await delReplyPrompt(chatKey, replyTo.message_id);
    await addScheduleSlot(pending.groupId, {
      sessionType: String(pending.sessionType),
      dayOfWeek: Number(pending.dayOfWeek),
      timeOfDay: time,
      teacherId: null,
    });
    await replyEphemeral(ctx, TT.slotAdded);

    // Refresh the originating panel to the (now longer) list.
    if (pending.chatId === undefined || pending.msgId === undefined) return;
    const cls = await resolveManageableClass(String(pending.gref ?? ''), ctx.from?.id ?? '');
    if (!cls) return;
    const slots = await listScheduleSlots(cls.groupId);
    const timezone = await getClassTimezone(cls.groupId);
    const view = panelView(cls, slots, timezone, canManage(cls.role));
    try {
      await ctx.telegram.editMessageText(pending.chatId, pending.msgId, undefined, view.text, {
        parse_mode: 'Markdown', ...view.keyboard,
      });
    } catch (err) {
      logTelegramError('timetable.add.refreshPanel', err, { chatId: chatKey, messageId: pending.msgId });
    }
  }

  return {
    panel,
    week,
    tzPicker,
    tzApply,
    tzRegions,
    tzZonesPage,
    myWeekRefresh,
    viewTzPicker,
    viewTzApply,
    viewTzRegions,
    viewTzZonesPage,
    weekStartPicker,
    weekStartApply,
    addPickType,
    addPickDay,
    addPromptTime,
    slotMenu,
    assignTeacherMenu,
    assignTeacher,
    removeConfirm,
    removeExec,
    myWeek,
    onMessage,
  };
}

export function register(bot: BotLike, storage: Storage): void {
  const h = createHandlers({ storage });
  bot.on('text', h.onMessage);
  bot.command('myweek', h.myWeek);
  bot.action(/^o:tt:(\d+)$/, h.panel);
  bot.action(/^o:ttweek:(\d+)$/, h.week);
  bot.action(/^o:tttz:(\d+)$/, h.tzPicker);
  bot.action(/^o:tttzx:(\d+):([A-Za-z0-9_+\-/]+)$/, h.tzApply);
  bot.action(/^o:tzr:(\d+)$/, h.tzRegions);
  bot.action(/^o:tzp:(\d+):(\d+):(\d+)$/, h.tzZonesPage);
  bot.action(/^o:mw$/, h.myWeekRefresh);
  bot.action(/^o:vtz:([cm]):(\d+)$/, h.viewTzPicker);
  bot.action(/^o:vtzx:([cm]):(\d+):(auto|[A-Za-z0-9_+\-/]+)$/, h.viewTzApply);
  bot.action(/^o:vzr:([cm]):(\d+)$/, h.viewTzRegions);
  bot.action(/^o:vzp:([cm]):(\d+):(\d+):(\d+)$/, h.viewTzZonesPage);
  bot.action(/^o:vws:([cm]):(\d+)$/, h.weekStartPicker);
  bot.action(/^o:vwsx:([cm]):(\d+):([0-6])$/, h.weekStartApply);
  bot.action(/^o:ttadd:(\d+)$/, h.addPickType);
  bot.action(/^o:ttaddt:(\d+):([a-zA-Z]+)$/, h.addPickDay);
  bot.action(/^o:ttaddd:(\d+):([a-zA-Z]+):(\d+)$/, h.addPromptTime);
  bot.action(/^o:ttslot:(\d+):(\d+)$/, h.slotMenu);
  bot.action(/^o:ttasg:(\d+):(\d+)$/, h.assignTeacherMenu);
  bot.action(/^o:ttasgd:(\d+):(\d+):(\d+)$/, h.assignTeacher);
  bot.action(/^o:ttrm:(\d+):(\d+)$/, h.removeConfirm);
  bot.action(/^o:ttrmx:(\d+):(\d+)$/, h.removeExec);
}
