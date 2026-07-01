// UI widgets: session, manage, members, etc.

import { TEXT, st } from './text.js';
import { sortArabic, formatPages, getFirstPage } from './helpers.js';
import { Markup } from 'telegraf';

export const calledState = (session, name) => session?.called?.[name] || null;
export const calledIcon = (state) => (state === 'responding' ? '👉 ' : state === 'responded' ? '✅ ' : state === 'away' ? '📣 ' : '⏳ ');

export const rawSessionNames = (session, master) => {
  const attendanceKeys = Object.keys(session?.attendance || {});
  // Always preserve insertion order (time-added) for session display
  return attendanceKeys;
};

export const sessionNames = (session, master) => {
  return rawSessionNames(session, master);
};

export function sessionText(session, master) {
  const names = sessionNames(session, master);
  const header = typeof TEXT.sessionHeader === 'function'
    ? TEXT.sessionHeader(session.name)
    : `📚 *قائمة: ${session.name}*`;
  let t = `${header}\n\n`;

  for (const name of names) {
    const key = session.attendance[name] || null;
    const { e, a } = st(key);
    const callMark = calledIcon(calledState(session, name));
    if (session.pageList || session.groupRecitation) {
      const page = session.pages?.[name];
      if (page) {
        t += `${e} ${callMark}${name} – ${formatPages(page)}\n`;
      } else {
        t += `${e} ${callMark}${name}\n`;
      }
    } else {
      t += key ? `${e} ${callMark}${name} – ${a}\n` : `${e} ${callMark}${name}\n`;
    }
  }

  t += `\n`;
  t += session.active
    ? (session.registrationActive === false
        ? TEXT.sessionRegistrationClosed
        : session.pageList ? TEXT.pageListJoinPrompt
        : session.groupRecitation ? TEXT.groupRecitationJoinPrompt
        : TEXT.sessionJoinPrompt)
    : TEXT.sessionEnded;
  return t;
}

export const sessionKb = (active, registrationActive = true, allowPublicRegistration = false) =>
  active && registrationActive
    ? Markup.inlineKeyboard([[
        Markup.button.callback(TEXT.statusButtons.present,   'a:present'),
        Markup.button.callback(TEXT.statusButtons.listening, 'a:listening'),
        ...(!allowPublicRegistration ? [Markup.button.callback(TEXT.statusButtons.excused, 'a:excused')] : []),
      ]])
    : Markup.inlineKeyboard([]);

export async function refreshSessionWidget(telegram, session, master) {
  if (!session?.messageId) return;
  try {
    await telegram.editMessageText(
      session.chatId, session.messageId, undefined,
      sessionText(session, master),
      { parse_mode: 'Markdown', ...sessionKb(session.active, session.registrationActive !== false, session.allowPublicRegistration) }
    );
  } catch (e) {
    if (!e.message?.includes('message is not modified'))
      console.error('refreshSessionWidget:', e.message);
  }
}

export async function refreshManageWidget(ctx, session, master) {
  try {
    await ctx.editMessageText(manageText(session, master), { parse_mode: 'Markdown', ...manageKb(session, master) });
  } catch (e) {
    if (!e.message?.includes('message is not modified')) throw e;
  }
}

// ─── Members Widget
export function membersText(master) {
  if (!master.members.length)
    return TEXT.emptyMembers;
  const sorted = sortArabic(master.members.map(m => m.name));
  return (
    TEXT.membersHeader(master.members.length) +
    sorted.map((n, i) => `${i + 1}. ${n}`).join('\n')
  );
}

export function membersKb(master) {
  const sorted = sortArabic(master.members.map(m => m.name));
  const rows = sorted.map((name, i) => [
    Markup.button.callback(`🔧 ${name}`, `mb:pick:${i}`),
  ]);
  rows.push([Markup.button.callback(TEXT.addMemberButton, 'mb:add')]);
  rows.push([Markup.button.callback('✕ إغلاق', 'msg:dismiss')]);
  return Markup.inlineKeyboard(rows);
}

export function memberOptionsKb(idx) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(TEXT.renameButton, `mb:ren:${idx}`),
      Markup.button.callback(TEXT.deleteButton, `mb:del:${idx}`),
    ],
    [Markup.button.callback(TEXT.backButton, 'mb:back')],
  ]);
}

// ─── Session Manage Widget
export function manageText(session, master) {
  const names = sessionNames(session, master);
  let t = TEXT.manageHeader(session.name);
  for (const name of names) {
    const { e, a } = st(session.attendance[name] || null);
    const callMark = calledIcon(calledState(session, name));
    t += `${e} ${callMark}${name} – ${a}\n`;
  }
  return t;
}

export function manageKb(session, master) {
  const names = sessionNames(session, master);
  const rows = names.map((name, i) => {
    const { e } = st(session.attendance[name] || null);
    return [Markup.button.callback(`${e} ${name}`, `sm:pick:${i}`)];
  });
  rows.push([Markup.button.callback(TEXT.manageButtons.addGuest, 'sm:addguest')]);
  rows.push([
    Markup.button.callback(TEXT.refreshButton, 'sm:refresh'),
    Markup.button.callback(TEXT.manageButtons.hide, 'sm:hide'),
  ]);
  return Markup.inlineKeyboard(rows);
}

// ─── Confirmation Keyboard
export const confirmKb = (token) => Markup.inlineKeyboard([
  [
    Markup.button.callback(TEXT.confirmButton, `cf:ok:${token}`),
    Markup.button.callback(TEXT.cancelButton, `cf:cancel:${token}`),
  ],
]);

// ─── Dismissible result message keyboard (generic close button)
export const dismissKb = () => Markup.inlineKeyboard([[Markup.button.callback('✕ إغلاق', 'msg:dismiss')]]);
