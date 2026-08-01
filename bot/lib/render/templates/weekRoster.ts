// Weekly roster template: turns schedule data into a shareable HTML document
// that the render engine rasterises to a PNG. The markup is right-to-left and
// self-contained (embedded fonts + inline CSS) so it renders identically in the
// Vercel Chromium and in a local browser.
import { fontFaceCss, FONT_FAMILY } from '../fonts.js';
import { renderText } from '../strings.js';

// Session kinds the roster can colour-code. The handler passes the session
// type; the template owns the short label + colours so the image stays compact
// (the full Arabic titles are only used in the Telegram messages).
export type RosterKind =
  | 'main'
  | 'training'
  | 'open'
  | 'registeredSecondary'
  | 'personalRecitation'
  | 'groupRecitation'
  | 'homeworkReview'
  | 'other';

export interface RosterSlot {
  time: string;
  label: string;
  teacher?: string;
  kind?: RosterKind;
}

export interface RosterDay {
  day: string;
  slots: RosterSlot[];
}

export interface WeekRosterData {
  title: string;
  subtitle?: string;
  days: RosterDay[];
  footer?: string;
}

export const ROSTER_WIDTH = 1260;

// Day- and teacher-filtered rosters are list-style (far fewer sessions), so
// they use a narrower portrait width.
export const LIST_WIDTH = 780;

// A single day's roster: every session scheduled on one day.
export interface DayRosterData {
  title: string;
  subtitle?: string;
  slots: RosterSlot[];
  footer?: string;
}

// One teacher's roster across the week, grouped by day (only days with sessions).
export interface TeacherRosterData {
  title: string;
  subtitle?: string;
  days: RosterDay[];
  footer?: string;
}

const COLORS = {
  page: '#f3efe4',
  frame: '#ffffff',
  accent: '#1f7a5a',
  accentDark: '#155c43',
  accentSoft: '#e7f2ed',
  gold: '#c19a3e',
  goldSoft: '#efe4c6',
  text: '#1f2937',
  muted: '#6b7280',
  rowAlt: '#f4f9f6',
  allDay: '#faf6e9',
  border: '#e2ded1',
};

// Minimalist Islamic-style ornaments, inline so the template stays
// self-contained (no external images on Vercel).

// Crescent + five-point star for the header plaque.
const CRESCENT_SVG = `<svg width="76" height="76" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <path d="M66 50a27 27 0 1 1-19-25.8A22 22 0 1 0 66 50z" fill="${COLORS.gold}"/>
  <path d="M80 27l3.4 6.9 7.6 1.1-5.5 5.4 1.3 7.6-6.8-3.6-6.8 3.6 1.3-7.6-5.5-5.4 7.6-1.1z" fill="${COLORS.gold}"/>
</svg>`;

// A single corner flourish; the four corners reuse it with CSS transforms.
const CORNER_SVG = `<svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M10 10 C 54 10, 10 54, 10 96" stroke="${COLORS.gold}" stroke-width="3" stroke-linecap="round"/>
  <path d="M10 10 C 10 54, 54 10, 96 10" stroke="${COLORS.gold}" stroke-width="3" stroke-linecap="round"/>
  <path d="M26 26 q 30 4 34 34" stroke="${COLORS.gold}" stroke-width="2" stroke-linecap="round" opacity="0.7"/>
  <circle cx="10" cy="10" r="5.5" fill="${COLORS.gold}"/>
</svg>`;

// Thin divider with a central diamond, placed under the title.
const DIVIDER_SVG = `<svg width="360" height="24" viewBox="0 0 360 24" xmlns="http://www.w3.org/2000/svg">
  <line x1="30" y1="12" x2="158" y2="12" stroke="${COLORS.gold}" stroke-width="2"/>
  <path d="M180 3l8 9-8 9-8-9z" fill="${COLORS.gold}"/>
  <path d="M158 12l10-5v10z" fill="${COLORS.gold}"/>
  <path d="M202 12l-10-5v10z" fill="${COLORS.gold}"/>
  <line x1="202" y1="12" x2="330" y2="12" stroke="${COLORS.gold}" stroke-width="2"/>
</svg>`;

// Neutral marker for the all-day row header (avoids spelling out "all day").
const ALLDAY_MARKER = `<svg width="22" height="22" viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg"><path d="M11 1l10 10-10 10L1 11z" fill="#ffffff"/></svg>`;

// Short label + colour per session kind. `main` is filled (solid green) so it
// stands out; the rest are soft tints, each a distinct hue.
interface KindStyle {
  label: string;
  bg: string;
  text: string;
  border: string;
  sub: string;
}
const KINDS: Record<RosterKind, KindStyle> = {
  main: { label: 'أساسي', bg: '#1f7a5a', text: '#ffffff', border: '#155c43', sub: '#d8ede4' },
  training: { label: 'تدريب', bg: '#fbf1d5', text: '#7a5d12', border: '#e6cf8f', sub: '#9a7d33' },
  open: { label: 'تسجيل مفتوح', bg: '#e2f4ef', text: '#116551', border: '#bce3d8', sub: '#3f7d6e' },
  registeredSecondary: { label: 'تصحيح التلاوة', bg: '#e4eefb', text: '#1f5273', border: '#bcd6f0', sub: '#4a6d86' },
  personalRecitation: { label: 'تلاوة فردية', bg: '#fdeae8', text: '#8a3b30', border: '#f2cbc4', sub: '#a5665d' },
  groupRecitation: { label: 'تلاوة جماعية', bg: '#eae8fb', text: '#3f3a86', border: '#ccc7ef', sub: '#5f5aa0' },
  homeworkReview: { label: 'مراجعة التكاليف', bg: '#efe7f7', text: '#553a77', border: '#d9c7ec', sub: '#6f5590' },
  other: { label: 'أخرى', bg: '#eef1f0', text: '#374151', border: '#d8ddda', sub: '#6b7280' },
};

function kindOf(slot: RosterSlot): KindStyle | null {
  return slot.kind ? KINDS[slot.kind] : null;
}

function slotContent(slot: RosterSlot): string {
  const k = kindOf(slot);
  const label = k ? k.label : slot.label;
  const boxStyle = k ? ` style="background:${k.bg};border-color:${k.border}"` : '';
  const labelStyle = k ? ` style="color:${k.text}"` : '';
  const teacher = slot.teacher
    ? `<div class="cell-teacher"${k ? ` style="color:${k.sub}"` : ''}>${renderText(slot.teacher)}</div>`
    : '';
  return `<div class="cell-item"${boxStyle}>
      <div class="cell-label"${labelStyle}>${renderText(label)}</div>
      ${teacher}
    </div>`;
}

// Sort key for a time column: parse "HH:MM" to minutes.
function timeSortKey(time: string): number {
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(time);
  return m ? Number(m[1]) * 60 + Number(m[2]) : Number.POSITIVE_INFINITY;
}

// A slot is "timed" when its time is a real HH:MM. Anything else (e.g. the
// all-day homework review) is pulled out of the time columns and shown in a
// separate per-day row instead.
function isTimed(time: string): boolean {
  return /^\s*\d{1,2}:\d{2}\s*$/.test(time);
}

// Distinct timed values across the whole week, ordered chronologically; these
// become the table's columns.
function collectTimes(days: RosterDay[]): string[] {
  const times = new Set<string>();
  for (const day of days) {
    for (const slot of day.slots) {
      if (isTimed(slot.time)) times.add(slot.time.trim());
    }
  }
  return [...times].sort((a, b) => timeSortKey(a) - timeSortKey(b));
}

// One day's sessions at a given time (the time is implied by the row).
function dayCell(day: RosterDay, time: string): string {
  const matches = day.slots.filter(
    (slot) => isTimed(slot.time) && slot.time.trim() === time,
  );
  if (!matches.length) return '<td class="day-cell empty"></td>';
  return `<td class="day-cell filled">${matches.map(slotContent).join('')}</td>`;
}

// Header row: a corner label plus one column per day.
function headRow(days: RosterDay[]): string {
  const cols = days
    .map((d) => `<th class="day-head">${renderText(d.day)}</th>`)
    .join('');
  return `<tr><th class="corner-cell">${renderText('الوقت')}</th>${cols}</tr>`;
}

// One body row for a given time: the time header plus a cell per day.
function timeRow(time: string, days: RosterDay[]): string {
  const cells = days.map((d) => dayCell(d, time)).join('');
  return `<tr><th class="time-head">${renderText(time)}</th>${cells}</tr>`;
}

// Group a day's all-day slots by kind (or label) and list every teacher joined
// by commas — the label appears once, coloured by kind, and the "all day"
// wording is omitted entirely.
function allDayContent(slots: RosterSlot[]): string {
  const order: string[] = [];
  const groups = new Map<string, { label: string; color: string; teachers: string[] }>();
  for (const slot of slots) {
    const k = kindOf(slot);
    const key = slot.kind ?? `label:${slot.label}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        label: k ? k.label : slot.label,
        color: k ? k.text : COLORS.accentDark,
        teachers: [],
      };
      groups.set(key, group);
      order.push(key);
    }
    if (slot.teacher) group.teachers.push(slot.teacher);
  }
  return order
    .map((key) => {
      const group = groups.get(key);
      if (!group) return '';
      const names = group.teachers.length
        ? `<span class="allday-teachers">${group.teachers.map((t) => renderText(t)).join('<br>')}</span>`
        : '';
      return `<div class="allday-group">
          <span class="allday-label" style="color:${group.color}">${renderText(group.label)}</span>
          ${names}
        </div>`;
    })
    .join('');
}

// A single all-day row across every day column; each cell holds that day's
// grouped all-day content (empty where a day has none). Returns '' when no day
// has any all-day slots.
function allDayRow(days: RosterDay[]): string {
  const hasAny = days.some((d) => d.slots.some((s) => !isTimed(s.time)));
  if (!hasAny) return '';
  const cells = days
    .map((d) => {
      const allDay = d.slots.filter((s) => !isTimed(s.time));
      if (!allDay.length) return '<td class="allday-cell empty"></td>';
      return `<td class="allday-cell">${allDayContent(allDay)}</td>`;
    })
    .join('');
  return `<tr class="allday-row"><th class="allday-head">${ALLDAY_MARKER}</th>${cells}</tr>`;
}

// A single list row for the day/teacher rosters: a leading time badge (or the
// all-day marker), the colour-coded kind pill, and an optional teacher name
// pushed to the far edge.
function listRow(slot: RosterSlot, opts: { showTeacher?: boolean } = {}): string {
  const k = kindOf(slot);
  const label = k ? k.label : slot.label;
  const pillStyle = k
    ? ` style="background:${k.bg};color:${k.text};border-color:${k.border}"`
    : '';
  const badge = isTimed(slot.time)
    ? `<span class="time-badge">${renderText(slot.time.trim())}</span>`
    : `<span class="time-badge allday">${ALLDAY_MARKER}</span>`;
  const teacher =
    opts.showTeacher && slot.teacher
      ? `<span class="row-teacher">${renderText(slot.teacher)}</span>`
      : '';
  return `<div class="list-row">
      ${badge}
      <span class="kind-pill"${pillStyle}>${renderText(label)}</span>
      ${teacher}
    </div>`;
}

// Split a day's slots into timed (chronological) and all-day buckets.
function sortedSlots(slots: RosterSlot[]): { timed: RosterSlot[]; allDay: RosterSlot[] } {
  const timed = slots
    .filter((s) => isTimed(s.time))
    .sort((a, b) => timeSortKey(a.time) - timeSortKey(b.time));
  const allDay = slots.filter((s) => !isTimed(s.time));
  return { timed, allDay };
}

// The shared decorative document shell (frame, header, ornaments, footer and
// every CSS rule). Each roster template builds a `body` and drops it in here.
function documentShell(opts: {
  title: string;
  subtitle?: string;
  footer?: string;
  width: number;
  body: string;
}): string {
  const subtitle = opts.subtitle
    ? `<div class="subtitle">${renderText(opts.subtitle)}</div>`
    : '';
  const footer = opts.footer
    ? `<div class="footer">${renderText(opts.footer)}</div>`
    : '';

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="utf-8">
<style>
${fontFaceCss()}
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: ${COLORS.page}; }
#root {
  width: ${opts.width}px;
  direction: rtl;
  background: ${COLORS.page};
  color: ${COLORS.text};
  font-family: '${FONT_FAMILY}', sans-serif;
  padding: 40px;
}
.frame {
  position: relative;
  background: ${COLORS.frame};
  border: 2px solid ${COLORS.gold};
  border-radius: 28px;
  padding: 48px 44px 44px;
  box-shadow: inset 0 0 0 6px ${COLORS.frame}, inset 0 0 0 7px ${COLORS.goldSoft};
}
.corner { position: absolute; line-height: 0; }
.corner.tl { top: 12px; right: 12px; }
.corner.tr { top: 12px; left: 12px; transform: scaleX(-1); }
.corner.bl { bottom: 12px; right: 12px; transform: scaleY(-1); }
.corner.br { bottom: 12px; left: 12px; transform: scale(-1, -1); }
.header { text-align: center; margin-bottom: 8px; }
.crescent { line-height: 0; margin-bottom: 10px; }
.title { font-size: 50px; font-weight: 700; color: ${COLORS.accentDark}; line-height: 1.2; }
.subtitle { font-size: 28px; color: ${COLORS.muted}; margin-top: 8px; }
.divider { line-height: 0; margin: 14px 0 4px; }
.table-wrap {
  margin-top: 20px;
  border: 2px solid ${COLORS.accent};
  border-radius: 18px;
  overflow: hidden;
}
table {
  width: 100%;
  border-collapse: collapse;
  direction: rtl;
  table-layout: fixed;
}
th, td {
  border: 1px solid ${COLORS.border};
  padding: 12px 8px;
  text-align: center;
  vertical-align: middle;
  word-wrap: break-word;
  overflow-wrap: break-word;
}
thead th {
  background: ${COLORS.accent};
  color: #ffffff;
  font-size: 26px;
  font-weight: 700;
  white-space: nowrap;
  padding: 16px 6px;
}
thead th.corner-cell { background: ${COLORS.accentDark}; width: 120px; }
.time-head {
  background: ${COLORS.accentSoft};
  color: ${COLORS.accentDark};
  font-size: 26px;
  font-weight: 700;
  white-space: nowrap;
  width: 120px;
}
.day-cell { background: ${COLORS.frame}; }
.day-cell.empty { background: ${COLORS.page}; }
tbody tr:nth-child(even) .day-cell { background: ${COLORS.rowAlt}; }
.cell-item {
  border: 1px solid ${COLORS.border};
  border-radius: 10px;
  padding: 7px 6px;
  background: ${COLORS.frame};
}
.cell-item + .cell-item { margin-top: 7px; }
.cell-label { font-size: 21px; font-weight: 700; color: ${COLORS.text}; line-height: 1.3; }
.cell-teacher { font-size: 18px; color: ${COLORS.muted}; margin-top: 3px; line-height: 1.25; }
.allday-row .allday-head { background: ${COLORS.gold}; line-height: 0; }
.allday-row .allday-cell {
  background: ${COLORS.allDay};
  text-align: right;
  padding: 12px 12px;
  vertical-align: top;
}
.allday-row .allday-cell.empty { background: ${COLORS.page}; }
.allday-group { padding: 2px 0; }
.allday-group + .allday-group {
  margin-top: 6px;
  padding-top: 8px;
  border-top: 1px solid ${COLORS.border};
}
.allday-label {
  display: block;
  font-size: 21px;
  font-weight: 700;
  color: ${COLORS.accentDark};
  margin-bottom: 4px;
}
.allday-teachers { font-size: 20px; color: ${COLORS.text}; line-height: 1.6; }
.list { margin-top: 20px; display: flex; flex-direction: column; gap: 14px; }
.list-row {
  display: flex;
  align-items: center;
  gap: 16px;
  background: ${COLORS.frame};
  border: 1px solid ${COLORS.border};
  border-radius: 14px;
  padding: 14px 18px;
}
.time-badge {
  flex: 0 0 auto;
  min-width: 96px;
  text-align: center;
  background: ${COLORS.accentSoft};
  color: ${COLORS.accentDark};
  font-size: 25px;
  font-weight: 700;
  padding: 8px 12px;
  border-radius: 10px;
  white-space: nowrap;
}
.time-badge.allday { background: ${COLORS.gold}; line-height: 0; padding: 12px; }
.kind-pill {
  font-size: 25px;
  font-weight: 700;
  padding: 8px 18px;
  border-radius: 999px;
  border: 1px solid ${COLORS.border};
  background: ${COLORS.accentSoft};
  color: ${COLORS.accentDark};
  white-space: nowrap;
}
.row-teacher {
  font-size: 25px;
  color: ${COLORS.text};
  margin-inline-start: auto;
  text-align: left;
}
.day-group {
  border: 2px solid ${COLORS.accent};
  border-radius: 16px;
  overflow: hidden;
}
.day-group-head {
  background: ${COLORS.accent};
  color: #ffffff;
  font-size: 27px;
  font-weight: 700;
  text-align: center;
  padding: 12px;
}
.day-group .list-row { border: 0; border-radius: 0; }
.day-group .list-row + .list-row { border-top: 1px solid ${COLORS.border}; }
.list-allday {
  border: 2px solid ${COLORS.gold};
  border-radius: 16px;
  overflow: hidden;
  background: ${COLORS.allDay};
}
.allday-banner { background: ${COLORS.gold}; text-align: center; padding: 10px; line-height: 0; }
.allday-body { padding: 16px 22px; }
.allday-body .allday-teachers { line-height: 1.7; }
.list-empty { text-align: center; color: ${COLORS.muted}; font-size: 26px; padding: 34px; }
.footer {
  margin-top: 26px;
  text-align: center;
  background: ${COLORS.accent};
  color: #ffffff;
  font-size: 26px;
  font-weight: 700;
  padding: 16px 28px;
  border-radius: 18px;
  box-shadow: inset 0 0 0 2px ${COLORS.goldSoft};
}
</style>
</head>
<body>
<div id="root">
  <div class="frame">
    <span class="corner tl">${CORNER_SVG}</span>
    <span class="corner tr">${CORNER_SVG}</span>
    <span class="corner bl">${CORNER_SVG}</span>
    <span class="corner br">${CORNER_SVG}</span>
    <div class="header">
      <div class="crescent">${CRESCENT_SVG}</div>
      <div class="title">${renderText(opts.title)}</div>
      ${subtitle}
      <div class="divider">${DIVIDER_SVG}</div>
    </div>
    ${opts.body}
    ${footer}
  </div>
</div>
</body>
</html>`;
}

// Weekly roster: the transposed grid (days as columns, times as rows).
export function weekRosterHtml(data: WeekRosterData): string {
  const times = collectTimes(data.days);
  const rows =
    times.map((t) => timeRow(t, data.days)).join('') + allDayRow(data.days);
  const table = data.days.length
    ? `<div class="table-wrap"><table>
      <thead>${headRow(data.days)}</thead>
      <tbody>${rows}</tbody>
    </table></div>`
    : '';
  return documentShell({
    title: data.title,
    subtitle: data.subtitle,
    footer: data.footer,
    width: ROSTER_WIDTH,
    body: table,
  });
}

// Day roster: a single day's sessions as a time-ordered list, with any all-day
// sessions grouped in a banner section at the bottom.
export function dayRosterHtml(data: DayRosterData): string {
  const { timed, allDay } = sortedSlots(data.slots);
  const rows = timed.map((s) => listRow(s, { showTeacher: true })).join('');
  const allDaySection = allDay.length
    ? `<div class="list-allday">
        <div class="allday-banner">${ALLDAY_MARKER}</div>
        <div class="allday-body">${allDayContent(allDay)}</div>
      </div>`
    : '';
  const empty =
    !timed.length && !allDay.length
      ? `<div class="list-empty">${renderText('لا توجد حلقات')}</div>`
      : '';
  const body = `<div class="list">${rows}${allDaySection}${empty}</div>`;
  return documentShell({
    title: data.title,
    subtitle: data.subtitle,
    footer: data.footer,
    width: LIST_WIDTH,
    body,
  });
}

// Teacher roster: one teacher's sessions across the week, grouped per day.
export function teacherRosterHtml(data: TeacherRosterData): string {
  const groups = data.days
    .map((d) => {
      const { timed, allDay } = sortedSlots(d.slots);
      const rows = [...timed, ...allDay]
        .map((s) => listRow(s, { showTeacher: false }))
        .join('');
      return `<div class="day-group">
        <div class="day-group-head">${renderText(d.day)}</div>
        ${rows}
      </div>`;
    })
    .join('');
  const body = `<div class="list">${
    groups || `<div class="list-empty">${renderText('لا توجد حلقات')}</div>`
  }</div>`;
  return documentShell({
    title: data.title,
    subtitle: data.subtitle,
    footer: data.footer,
    width: LIST_WIDTH,
    body,
  });
}
