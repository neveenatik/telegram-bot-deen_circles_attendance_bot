// UI widgets: session, manage, members, etc.

import { TEXT, st } from './text.js';
import { sortArabic, formatPages, getFirstPage, logTelegramError } from './helpers.js';
import { Markup } from 'telegraf';

export const calledState = (session, name) => session?.called?.[name] || null;
export const calledIcon = (state) => (state === 'responding' ? '👉 ' : state === 'responded' ? '✅ ' : state === 'away' ? '📣 ' : '⏳ ');
const MEMBERS_PAGE_SIZE = 5;
const MANAGE_PAGE_SIZE = 5;

function scopedManageCallback(sessionType, action, ...parts) {
  const base = sessionType ? `sm:${sessionType}:${action}` : `sm:${action}`;
  return parts.length ? `${base}:${parts.join(':')}` : base;
}

function clampPage(page, totalPages) {
  if (!Number.isInteger(page) || page < 0) return 0;
  if (page >= totalPages) return Math.max(totalPages - 1, 0);
  return page;
}

export function membersPageOfIndex(index, pageSize = MEMBERS_PAGE_SIZE) {
  return Math.max(0, Math.floor(index / pageSize));
}

export function managePageOfIndex(index, pageSize = MANAGE_PAGE_SIZE) {
  return Math.max(0, Math.floor(index / pageSize));
}

export const rawSessionNames = (session, master) => {
  const attendanceKeys = Object.keys(session?.attendance || {});
  // Always preserve insertion order (time-added) for session display
  return attendanceKeys;
};

function sessionFooterText(session) {
  return session.active
    ? (session.registrationActive === false
        ? TEXT.sessionRegistrationClosed
        : session.pageList ? TEXT.pageListJoinPrompt
        : session.groupRecitation ? TEXT.groupRecitationJoinPrompt
        : TEXT.sessionJoinPrompt)
    : TEXT.sessionEnded;
}

function sessionLines(session, master) {
  const names = rawSessionNames(session, master);
  const renderedNames = session?.type === 'main' ? sortArabic(names) : names;
  const lines = [];
  for (const name of renderedNames) {
    const key = session.attendance[name] || null;
    const { e } = st(key);
    const callMark = calledIcon(calledState(session, name));
    if (session.pageList || session.groupRecitation) {
      const page = session.pages?.[name];
      if (page) {
        lines.push(`${e} ${callMark}${name} – ${formatPages(page)}`);
      } else {
        lines.push(`${e} ${callMark}${name}`);
      }
    } else if (session.type === 'registeredSecondary') {
      const verse = session.verses?.[name];
      lines.push(verse ? `${e} ${callMark}${name} – 🧾 ${verse}` : `${e} ${callMark}${name}`);
    } else {
      lines.push(`${e} ${callMark}${name}`);
    }
  }
  return lines;
}

function sessionSummaryLines(session, master) {
  const names = rawSessionNames(session, master);
  const summary = { present: 0, listening: 0, excused: 0, absent: 0, pending: 0 };

  for (const name of names) {
    const status = session.attendance?.[name];
    if (!status) summary.pending += 1;
    else if (summary[status] !== undefined) summary[status] += 1;
    else summary.absent += 1;
  }

  return [
    TEXT.sessionSummaryTotal(names.length),
    TEXT.sessionSummaryPresent(summary.present),
    TEXT.sessionSummaryListening(summary.listening),
    TEXT.sessionSummaryExcused(summary.excused),
    TEXT.sessionSummaryPending(summary.pending),
  ];
}

function buildSessionListTexts(session, master, maxLen = 3500) {
  const lines = sessionLines(session, master);
  if (!lines.length) {
    return [TEXT.sessionFollowupEmpty(session.name)];
  }

  const bodyMax = Math.max(800, maxLen - 120);
  const chunkBodies = [];
  let current = '';

  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line;
    if (next.length > bodyMax && current) {
      chunkBodies.push(current);
      current = line;
    } else {
      current = next;
    }
  }
  if (current) chunkBodies.push(current);

  const total = chunkBodies.length;
  return chunkBodies.map((body, i) => `${TEXT.sessionFollowupChunkHeader(session.name, i + 1, total)}\n\n${body}`);
}

export function sessionText(session, master) {
  const header = typeof TEXT.sessionHeader === 'function'
    ? TEXT.sessionHeader(session.name)
    : TEXT.sessionDefaultHeader(session.name);
  const footer = sessionFooterText(session);
  const summary = sessionSummaryLines(session, master).join('\n');
  const listInfo = TEXT.sessionListMessagesCount(
    Array.isArray(session.listMessageIds) && session.listMessageIds.length ? session.listMessageIds.length : 1
  );

  return `${header}\n\n${summary}\n${listInfo}\n\n${footer}`;
}

async function syncSessionListMessages(telegram, session, master) {
  const texts = buildSessionListTexts(session, master);
  const existing = Array.isArray(session.listMessageIds) ? [...session.listMessageIds] : [];
  const nextIds = [...existing];

  const sharedOpts = { parse_mode: 'Markdown' };
  const common = Math.min(existing.length, texts.length);

  for (let i = 0; i < common; i += 1) {
    try {
      await telegram.editMessageText(session.chatId, existing[i], undefined, texts[i], sharedOpts);
    } catch (e) {
      logTelegramError('widgets.syncSessionListMessages.edit', e, {
        chatId: String(session.chatId || ''),
        messageId: existing[i],
        sessionType: session?.type || null,
      });
    }
  }

  if (texts.length > existing.length) {
    for (let i = existing.length; i < texts.length; i += 1) {
      try {
        const sent = await telegram.sendMessage(session.chatId, texts[i], sharedOpts);
        nextIds.push(sent.message_id);
      } catch (e) {
        logTelegramError('widgets.syncSessionListMessages.send', e, {
          chatId: String(session.chatId || ''),
          sessionType: session?.type || null,
          index: i,
        });
      }
    }
  }

  if (existing.length > texts.length) {
    const stale = existing.slice(texts.length);
    nextIds.length = texts.length;
    for (const msgId of stale) {
      try {
        await telegram.deleteMessage(session.chatId, msgId);
      } catch (err) {
        logTelegramError('widgets.syncSessionListMessages.deleteStale', err, {
          chatId: String(session.chatId || ''),
          messageId: msgId,
          sessionType: session?.type || null,
        });
      }
    }
  }

  const changed = JSON.stringify(existing) !== JSON.stringify(nextIds);
  session.listMessageIds = nextIds;
  return changed;
}

export const sessionKb = (active, registrationActive = true, allowPublicRegistration = false) =>
  active && registrationActive
    ? Markup.inlineKeyboard([
        [
          Markup.button.callback(TEXT.statusButtons.present,   'a:present'),
          Markup.button.callback(TEXT.statusButtons.listening, 'a:listening'),
          ...(!allowPublicRegistration ? [Markup.button.callback(TEXT.statusButtons.excused, 'a:excused')] : []),
        ],
        [Markup.button.callback(TEXT.refreshButton, 'a:refresh')],
      ])
    : Markup.inlineKeyboard([]);

export async function refreshSessionWidget(telegram, session, master, persistSession) {
  if (!session?.messageId) return;
  try {
    await telegram.editMessageText(
      session.chatId, session.messageId, undefined,
      sessionText(session, master),
      { parse_mode: 'Markdown', ...sessionKb(session.active, session.registrationActive !== false, session.allowPublicRegistration) }
    );
  } catch (e) {
    logTelegramError('widgets.refreshSessionWidget.editMainMessage', e, {
      chatId: String(session.chatId || ''),
      messageId: session.messageId,
      sessionType: session?.type || null,
    });
  }

  const changed = await syncSessionListMessages(telegram, session, master);
  if (changed && typeof persistSession === 'function') {
    try {
      await persistSession(session);
    } catch (e) {
      console.error(JSON.stringify({
        level: 'error',
        event: 'widgets_refresh_session_widget_persist_failed',
        message: e?.message || String(e),
        chatId: String(session.chatId || ''),
        sessionType: session?.type || null,
        at: new Date().toISOString(),
      }));
    }
  }
}

export async function refreshManageWidget(ctx, session, master, page = 0, sessionType = null) {
  try {
    await ctx.editMessageText(manageText(session, master, page), { parse_mode: 'Markdown', ...manageKb(session, master, page, sessionType) });
  } catch (e) {
    if (!e.message?.includes('message is not modified')) throw e;
  }
}

export function editSessionPickerText(activeSessions = []) {
  if (!activeSessions.length) return TEXT.noSessionActive;
  return TEXT.editSessionPickerText;
}

export function editSessionPickerKb(activeSessions = []) {
  const rows = activeSessions.map(({ type, session }) => [
    Markup.button.callback(TEXT.editSessionPickerButton(session?.name || type), `sm:choose:${type}`),
  ]);
  rows.push([Markup.button.callback(TEXT.closeButton, 'msg:dismiss')]);
  return Markup.inlineKeyboard(rows);
}

// ─── Members Widget
export function membersText(master, page = 0) {
  if (!master.members.length)
    return TEXT.emptyMembers;

  const sorted = sortArabic(master.members.map(m => m.name));
  const totalPages = Math.max(1, Math.ceil(sorted.length / MEMBERS_PAGE_SIZE));
  const safePage = clampPage(page, totalPages);
  const start = safePage * MEMBERS_PAGE_SIZE;
  const paged = sorted.slice(start, start + MEMBERS_PAGE_SIZE);

  return (
    TEXT.membersHeader(master.members.length) +
    `${TEXT.pageIndicator(safePage + 1, totalPages)}\n\n` +
    paged.map((n, i) => `${start + i + 1}. ${n}`).join('\n')
  );
}

export function membersKb(master, page = 0) {
  const sorted = sortArabic(master.members.map(m => m.name));
  const totalPages = Math.max(1, Math.ceil(sorted.length / MEMBERS_PAGE_SIZE));
  const safePage = clampPage(page, totalPages);
  const start = safePage * MEMBERS_PAGE_SIZE;
  const paged = sorted.slice(start, start + MEMBERS_PAGE_SIZE);

  const rows = paged.map((name, i) => [
    Markup.button.callback(TEXT.manageMemberButton(name), `mb:pick:${start + i}`),
  ]);

  if (totalPages > 1) {
    rows.push([
      ...(safePage > 0 ? [Markup.button.callback(TEXT.navigationPrevButton, `mb:page:${safePage - 1}`)] : []),
      Markup.button.callback(TEXT.pageIndicator(safePage + 1, totalPages), 'mb:noop'),
      ...(safePage < totalPages - 1 ? [Markup.button.callback(TEXT.navigationNextButton, `mb:page:${safePage + 1}`)] : []),
    ]);
  }

  rows.push([Markup.button.callback(TEXT.addMemberButton, 'mb:add')]);
  if (master.members && master.members.length > 0) {
    rows.push([Markup.button.callback(TEXT.sendConfirmationButton, 'mb:sendconfirmations')]);
  }
  rows.push([Markup.button.callback(TEXT.closeButton, 'msg:dismiss')]);
  return Markup.inlineKeyboard(rows);
}

export function memberOptionsKb(idx, page = 0, assignedTrainingGroupName = null) {
  const hasAssignedTraining = Boolean(assignedTrainingGroupName);
  const trainingButtonText = hasAssignedTraining
    ? `${TEXT.unassignTrainingButton}: ${assignedTrainingGroupName}`
    : TEXT.assignTrainingButton;
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(TEXT.renameButton, `mb:ren:${idx}`),
      Markup.button.callback(TEXT.deleteButton, `mb:del:${idx}`),
    ],
    [Markup.button.callback(trainingButtonText, `mb:atrain:${idx}:${page}`)],
    [Markup.button.callback(TEXT.sendConfirmationButton, `mb:sendconfirm:${idx}:${page}`)],
    [Markup.button.callback(TEXT.backButton, `mb:back:${page}`)],
  ]);
}

// ─── Session Manage Widget
export function manageText(session, master, page = 0) {
  const names = rawSessionNames(session, master);
  const totalPages = Math.max(1, Math.ceil(names.length / MANAGE_PAGE_SIZE));
  const safePage = clampPage(page, totalPages);
  const start = safePage * MANAGE_PAGE_SIZE;
  const paged = names.slice(start, start + MANAGE_PAGE_SIZE);

  let t = TEXT.manageHeader(session.name);
  t += `${TEXT.pageIndicator(safePage + 1, totalPages)}\n\n`;
  for (const name of paged) {
    const { e, a } = st(session.attendance[name] || null);
    const callMark = calledIcon(calledState(session, name));
    if (session.type === 'registeredSecondary') {
      const verse = session.verses?.[name];
      t += verse
        ? `${e} ${callMark}${name} – ${a} | 🧾 ${verse}\n`
        : `${e} ${callMark}${name} – ${a}\n`;
    } else {
      t += `${e} ${callMark}${name} – ${a}\n`;
    }
  }
  return t;
}

export function manageKb(session, master, page = 0, sessionType = null) {
  const names = rawSessionNames(session, master);
  const totalPages = Math.max(1, Math.ceil(names.length / MANAGE_PAGE_SIZE));
  const safePage = clampPage(page, totalPages);
  const start = safePage * MANAGE_PAGE_SIZE;
  const paged = names.slice(start, start + MANAGE_PAGE_SIZE);

  const rows = paged.map((name, i) => {
    const { e } = st(session.attendance[name] || null);
    return [Markup.button.callback(`${e} ${name}`, scopedManageCallback(sessionType, 'pick', start + i))];
  });

  if (totalPages > 1) {
    rows.push([
      ...(safePage > 0 ? [Markup.button.callback(TEXT.navigationPrevButton, scopedManageCallback(sessionType, 'page', safePage - 1))] : []),
      Markup.button.callback(TEXT.pageIndicator(safePage + 1, totalPages), scopedManageCallback(sessionType, 'noop')),
      ...(safePage < totalPages - 1 ? [Markup.button.callback(TEXT.navigationNextButton, scopedManageCallback(sessionType, 'page', safePage + 1))] : []),
    ]);
  }

  rows.push([
    Markup.button.callback(TEXT.manageButtons.addGuest, scopedManageCallback(sessionType, 'addguest')),
    Markup.button.callback(TEXT.manageButtons.editSessionName, scopedManageCallback(sessionType, 'editname', safePage)),
  ]);
  rows.push([
    Markup.button.callback(TEXT.refreshButton, scopedManageCallback(sessionType, 'refresh', safePage)),
    Markup.button.callback(TEXT.manageButtons.hide, scopedManageCallback(sessionType, 'hide')),
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
export const dismissKb = () => Markup.inlineKeyboard([[Markup.button.callback(TEXT.closeButton, 'msg:dismiss')]]);
