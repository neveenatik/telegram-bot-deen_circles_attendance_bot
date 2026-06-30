require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');

// ─── Data layer (Supabase in prod, local files in dev) ────────────────────────
const {
  getMaster, saveMaster, getSession, saveSession, clearSession, archiveSession,
  getSessions, saveSessions, getCurrentSeries, saveCurrentSeries,
  getAwaiting, setAwaiting, delAwaiting,
} = require('./storage');

// ─── Guards & utils ───────────────────────────────────────────────────────────
async function isAdmin(ctx) {
  // Admin = Telegram group administrator or creator.
  // Admin commands have no effect in private DMs.
  if (ctx.chat?.type === 'private') return false;
  try {
    const member = await ctx.getChatMember(ctx.from.id);
    return ['administrator', 'creator'].includes(member.status);
  } catch {
    return false;
  }
}
async function isCreator(ctx) {
  if (ctx.chat?.type === 'private') return false;
  try {
    const member = await ctx.getChatMember(ctx.from.id);
    return member.status === 'creator';
  } catch {
    return false;
  }
}
const sortArabic = (arr) =>
  [...arr].sort((a, b) => a.localeCompare(b, 'ar'));

// ─── Shared Arabic text ───────────────────────────────────────────────────────
const TEXT = {
  adminOnly: '⛔ هذا الأمر متاح للمشرفين فقط.',
  creatorOnly: '⛔ هذا الأمر متاح لمنشئ المجموعة فقط.',
  noSessionActive: '⚠️ لا توجد حلقة نشطة.',
  sessionAlreadyActive: '⚠️ توجد حلقة نشطة بالفعل. أنهِها أولاً بـ /endsession',
  memberNotFound: '⚠️ العضو غير موجود.',
  invalidAddFormat: '⚠️ الصيغة الصحيحة:\n/addmember [معرّف المستخدم] | [الاسم]\nمثال: /addmember 123456789 | أحمد محمد',
  invalidRenameFormat: '⚠️ مثال:\n/renamemember الاسم القديم | الاسم الجديد',
  invalidStartFormat: '⚠️ مثال: /startsession اجتماع يونيو',
  invalidRemoveFormat: '⚠️ مثال: /removemember أحمد محمد',
  invalidUserId: '⚠️ معرّف المستخدم يجب أن يكون رقماً صحيحاً.',
  registrationPrompt: '📝 أرسل معرّف المستخدم والاسم بالصيغة:\n[معرّف تيليغرام] | [الاسم]\n\nمثال: 123456789 | أحمد محمد',
  emptyInput: '⚠️ الإدخال لا يمكن أن يكون فارغاً.',
  needRegistration: '⚠️ لم تُسجّل اسمك بعد.\nأرسل /register [اسمك] أولاً.',
  genericError: '⚠️ حدث خطأ. يرجى المحاولة لاحقاً.',
  sessionEnded: '_✅ الحلقة منتهية_',
  sessionJoinPrompt: '_سجّل حضورك باستخدام الأزرار أدناه:_',
  sessionRegistrationClosed: '_⛔ تم إيقاف تسجيل الحضور حالياً من قبل المشرف._',
  registrationStopped: '✅ تم إيقاف تسجيل الحضور. لن يتمكن الأعضاء من تغيير حالتهم الآن.',
  registrationAlreadyStopped: 'ℹ️ تسجيل الحضور متوقف بالفعل.',
  registrationClosedAlert: '⛔ تم إيقاف تسجيل الحضور حالياً.',
  noSeriesRecords: (s) => `⚠️ لا توجد سجلات في السلسلة الحالية (${s}).`,
  recordsHeader: (s, n) => `🗂️ سجلات السلسلة ${s} (${n})`,
  recordsLine: (i, s) => `#${i} | ${s.name} | ${new Date(s.endedAt || s.startedAt).toLocaleDateString('ar-EG', { timeZone: 'Africa/Cairo' })}`,
  invalidRecordIndex: '⚠️ رقم السجل غير صالح. استخدمي /records لمعرفة الأرقام.',
  invalidRemoveMemberRecordFormat: '⚠️ الصيغة الصحيحة:\n/removememberrecord [رقم السجل] | [اسم العضوة]',
  recordMemberNotFound: (name) => `⚠️ لا يوجد سجل للعضوة *${name}* داخل السجل المحدد.`,
  closeSeriesNeedsNoActiveSession: '⚠️ لا يمكن إغلاق السلسلة أثناء وجود حلقة نشطة. أنهِ الحلقة أولاً بـ /endsession.',
  closeSeriesDone: (from, to) => `✅ تم إغلاق السلسلة ${from} وبدء السلسلة ${to}.`,
  recordDeleted: (i) => `✅ تم حذف السجل #${i}.`,
  allRecordsDeleted: '✅ تم حذف جميع سجلات الحلقات المؤرشفة.',
  memberRecordDeleted: (name, i) => `✅ تم حذف سجل العضوة *${name}* من السجل #${i}.`,
  confirmPrompt: (action) => `⚠️ *تأكيد مطلوب*\n${action}\n\nاضغطي زر التأكيد أدناه.`,
  confirmNotFound: '⚠️ لا يوجد إجراء بانتظار التأكيد.',
  confirmExpired: '⚠️ انتهت صلاحية التأكيد. أعيدي تنفيذ الأمر.',
  confirmNotOwner: '⛔ لا يمكنك تأكيد إجراء طلبه مشرف آخر.',
  confirmCancelled: '✅ تم إلغاء الإجراء.',
  confirmButton: '✅ تأكيد التنفيذ',
  cancelButton: '↩️ إلغاء',
  emptyMembers: '📋 *القائمة فارغة*\nاستخدم الزر أدناه لإضافة أعضاء.',
  addMemberButton: '➕ إضافة عضوة جديد',
  refreshButton: '🔄 تحديث',
  backButton: '↩️ رجوع',
  deleteButton: '🗑️ حذف',
  renameButton: '✏️ تعديل الاسم',
  noNameFallback: 'بدون اسم',
  noSessionShort: '⚠️ لا توجد حلقة.',
  refreshed: '✅ تم التحديث',
  registeredSelf: (a) => `✅ تمت إضافتك وتسجيلك كـ "${a}"`,
  membersHeader: (n) => `👥 *قائمة الأعضاء (${n}):*\n\n`,
  manageHeader: (name) => `⚙️ *إدارة الحضور – ${name}*\n\nانقر على عضو لتعديل حالته أو علّم أنه تم النداء عليه:\n\n`,
  memberOptionsHeader: (name) => `🔧 *إدارة العضو:*\n${name}`,
  managePickHeader: (name, e, called) => `⚙️ *تعديل حالة:* ${name}\nالحالة الحالية: ${e}\nحالة النداء: ${called === 'responding' ? '👉 جاري الرد' : called === 'responded' ? '✅ حاضرة' : called === 'away' ? '📣 كان بعيداً عن الميكروفون' : ''}\n\nاختر الحالة الجديدة أو حالة النداء:`,
  renamePrompt: (name) => `✏️ اكتب الاسم الجديد بدلاً من *${name}*:`,
  myIdInfo: (displayName, id) => `🪪 بيانات الحساب (جاهزة للنسخ):\n\`${id} | ${displayName}\`\n\nأرسلي هذا السطر للمشرفة لإضافتك مباشرة.`,
  registerInfo: `📢 *طريقة التسجيل:*\n\n1. اكتبي /myid داخل المجموعة التي يوجد فيها البوت.\n2. انسخي السطر الذي يظهر بصيغة: \`[معرّف تيليغرام] | [الاسم]\`\n3. أرسليه للمشرفة ليتم إضافتك إلى قائمة المسجلات.`,
  statusNoSession: (n) => `📊 لا توجد حلقة نشطة حالياً.\nالأعضاء المسجّلون: ${n}`,
  statusReport: (c, total) => `📊 *حلقة: ${c.name}*\n✅ حاضرة: ${c.present}\n👂 مستمعة: ${c.listening}\n🔔 معتذرة: ${c.excused}\n⏳ لم تسجّل: ${c.pending}\n👥 الإجمالي: ${total}`,
  memberExists: (name) => `ℹ️ *${name}* موجود بالفعل.`,
  userIdLinked: (id) => `⚠️ المعرّف ${id} مرتبط بالفعل بعضو آخر.`,
  memberAdded: (name, id) => `✅ تمت إضافة *${name}* (معرّف: ${id}).`,
  memberNotInList: (name) => `⚠️ *${name}* غير موجود في القائمة.`,
  memberDeleted: (name) => `✅ تم حذف *${name}*.`,
  memberDeletedShort: (name) => `✅ تم حذف ${name}`,
  oldNameNotFound: (name) => `⚠️ *${name}* غير موجود.`,
  nameTaken: (name) => `⚠️ الاسم *${name}* مستخدم بالفعل.`,
  memberRenamed: (oldName, newName) => `✅ تم التعديل: *${oldName}* ← *${newName}*`,
  memberGone: (name) => `⚠️ العضو *${name}* لم يعد موجوداً.`,
  registeredAs: (a) => `✅ تم تسجيلك كـ "${a}"`,
  statusSet: (name, a) => `✅ ${name} ← ${a}`,
  inlinePromptAdd: '📝 أرسل معرّف المستخدم والاسم بالصيغة:\n[معرّف تيليغرام] | [الاسم]\n\nمثال: 123456789 | أحمد محمد',
  inlineInvalidAddFormat: '⚠️ الصيغة الصحيحة:\n[معرّف تيليغرام] | [الاسم]\nمثال: 123456789 | أحمد محمد',
  replyToPromptOnly: '↩️ من فضلك اكتب الرد على رسالة الإدخال نفسها.',
  report: (session, groups) => {
    let r = `📊 *تقرير حلقة "${session.name}":*\n\n`;
    if (groups.present.length)   r += `✅ *حاضرة (${groups.present.length}):*\n${groups.present.join('\n')}\n\n`;
    if (groups.listening.length) r += `👂 *مستمعة فقط (${groups.listening.length}):*\n${groups.listening.join('\n')}\n\n`;
    if (groups.excused.length)   r += `🔔 *معتذرة (${groups.excused.length}):*\n${groups.excused.join('\n')}\n\n`;
    if (groups.absent.length)    r += `❌ *غياب (${groups.absent.length}):*\n${groups.absent.join('\n')}`;
    return r;
  },
  help: (admin) =>
    `مرحباً! 👋 *بوت الحضور*\n\n` +
    `*للأعضاء:*\n` +
    `/myid – يستخدم داخل المجموعة للحصول على المعلومات الللازمة ليستطيع الأدمن إضافتك إلى قائمة المسجلات\n` +
    `` +
    (admin
      ? `\n\n*للمشرف:*\n` +
        `/status – ملخص حضور الحلقة الحالية\n` +
        `/members – إدارة قائمة الأعضاء (إضافة / حذف / تعديل)\n` +
        `/registerinfo – إرسال توضيح طريقة التسجيل للأعضاء\n` +
        `/addmember [معرّف] | [اسم] – إضافة عضو بمعرّف تيليغرام\n` +
        `/removemember [اسم] – حذف سريع\n` +
        `/renamemember [قديم] | [جديد] – تعديل اسم عضو\n` +
        `/startsession [اسم الحلقة] – بدء حلقة للمسجلات فقط\n` +
        `/startopensession [اسم الحلقة] – بدء حلقة مفتوحة لأي عضوة\n` +
        `/stopregistration – إيقاف تسجيل الحضور أثناء الحلقة\n` +
        `/resetseries – إعادة تعيين السلسلة الحالية والبدء بسلسلة جديدة (لمنشئ المجموعة)\n` +
        `/records – عرض سجلات السلسلة الحالية بالأرقام\n` +
        `/removerecord [رقم] – حذف سجل من السلسلة الحالية (بتأكيد، لمنشئ المجموعة)\n` +
        `/removememberrecord [رقم] | [اسم] – حذف سجل عضوة من سجل في السلسلة الحالية (بتأكيد، لمنشئ المجموعة)\n` +
        `/clearrecords – حذف كل السجلات المؤرشفة (بتأكيد، لمنشئ المجموعة)` +
        `\n` +
        `/endsession – إنهاء الحلقة وإغلاق تسجيل الحضور\n` +
        `/sessionmanage – تعديل حالات الحضور بشكل شخصي\n` +
        `/history – سجل عدد مرات الحضور والاعتذار والغياب لكل عضوة`
      : ''),
  attendance: {
    present:   { e: '✅', a: 'حاضرة' },
    listening: { e: '👂', a: 'مستمعة' },
    excused:   { e: '🔔', a: 'معتذرة' },
    absent:    { e: '❌', a: 'غياب بغير عذر' },
    pending:   { e: '⏳', a: 'لم يُسجّل بعد' },
  },
  statusButtons: {
    present: '✅ حاضرة',
    listening: '👂 مستمعة',
    excused: '🔔 معتذرة',
  },
  manageButtons: {
    present: '✅ تسجيل حضور',
    listening: '👂 مستمعة',
    excused: '🔔 معتذرة',
    absent: '❌ غياب',
    markCalling: '👉 جاري الرد',
    markResponded: '✅ حاضرة',
    markAway: '📣 مبتعدة',
    clearCalled: '↩️ إلغاء علامة النداء',
    back: '↩️ رجوع',
  },
  historyHeader: (n) =>
    `📊 سجل الحضور (${n} جلسة)\n📅 ${new Date().toLocaleDateString('ar-EG', { timeZone: 'Africa/Cairo' })}`,
  historyLine: (name, p, l, x, ab) =>
    `${name}\n  ✅ ${p} حاضرة | 👂 ${l} مستمعة | 🔔 ${x} معتذرة | ❌ ${ab} غياب`,
  historyEmpty: 'لا توجد جلسات مؤرشفة بعد.',
  sessionHeader: (name) => `📚 *حلقة: ${name}*`,
};
const st = (key) => (key && TEXT.attendance[key]) || TEXT.attendance.pending;
const calledState = (session, name) => session?.called?.[name] || null;
const calledIcon = (state) => (state === 'responding' ? '👉 ' : state === 'responded' ? '✅ ' : state === 'away' ? '📣 ' : '⏳ ');
const rawSessionNames = (session, master) => {
  if (session?.openRegistration) return Object.keys(session.attendance || {});
  return master.members.map(m => m.name);
};
const sessionNames = (session, master) => {
  return sortArabic(rawSessionNames(session, master));
};
const pendingConfirms = new Map();
const CONFIRM_TTL_MS = 10 * 60 * 1000;
const sessionSeries = (s) => Number.isInteger(s?.seriesId) && s.seriesId > 0 ? s.seriesId : 1;
const sessionsInSeries = (sessions, seriesId) => sessions.filter((s) => sessionSeries(s) === seriesId);
const newConfirmToken = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const setPendingConfirm = (userId, payload) => {
  const token = newConfirmToken();
  pendingConfirms.set(token, {
    token,
    userId: String(userId),
    expiresAt: Date.now() + CONFIRM_TTL_MS,
    ...payload,
  });
  return token;
};
const confirmKb = (token) => Markup.inlineKeyboard([
  [
    Markup.button.callback(TEXT.confirmButton, `cf:ok:${token}`),
    Markup.button.callback(TEXT.cancelButton, `cf:cancel:${token}`),
  ],
]);

async function executePendingConfirm(pending) {
  if (pending.action === 'closeSeries') {
    if (await getSession()) return { text: TEXT.closeSeriesNeedsNoActiveSession };
    const from = await getCurrentSeries();
    const to = from + 1;
    await saveCurrentSeries(to);
    return { text: TEXT.closeSeriesDone(from, to) };
  }

  if (pending.action === 'removeRecord') {
    const all = await getSessions();
    if (pending.absoluteIndex < 0 || pending.absoluteIndex >= all.length)
      return { text: TEXT.invalidRecordIndex };
    all.splice(pending.absoluteIndex, 1);
    await saveSessions(all);
    return { text: TEXT.recordDeleted(pending.recordIndex) };
  }

  if (pending.action === 'removeMemberRecord') {
    const all = await getSessions();
    const target = all[pending.absoluteIndex];
    if (!target) return { text: TEXT.invalidRecordIndex };
    if (!target.attendance || !(pending.name in target.attendance))
      return { text: TEXT.recordMemberNotFound(pending.name), parse_mode: 'Markdown' };

    delete target.attendance[pending.name];
    if (target.called && pending.name in target.called) delete target.called[pending.name];
    all[pending.absoluteIndex] = target;
    await saveSessions(all);
    return { text: TEXT.memberRecordDeleted(pending.name, pending.recordIndex), parse_mode: 'Markdown' };
  }

  if (pending.action === 'clearRecords') {
    await saveSessions([]);
    return { text: TEXT.allRecordsDeleted };
  }

  return { text: TEXT.confirmNotFound };
}

// ─── ① SESSION WIDGET ─────────────────────────────────────────────────────────
function sessionText(session, master) {
  const names = sessionNames(session, master);
  const header = typeof TEXT.sessionHeader === 'function'
    ? TEXT.sessionHeader(session.name)
    : `📚 *حلقة: ${session.name}*`;
  let t = `${header}\n\n`;
  for (const name of names) {
    const key = session.attendance[name] || null;
    const { e, a } = st(key);
    const callMark = calledIcon(calledState(session, name));
    t += key ? `${e} ${callMark}${name} – ${a}\n` : `${e} ${callMark}${name}\n`;
  }
  t += `\n`;
  t += session.active
    ? (session.registrationOpen === false ? TEXT.sessionRegistrationClosed : TEXT.sessionJoinPrompt)
    : TEXT.sessionEnded;
  return t;
}

const sessionKb = (active, registrationOpen = true) =>
  active && registrationOpen
    ? Markup.inlineKeyboard([[
        Markup.button.callback(TEXT.statusButtons.present, 'a:present'),
        Markup.button.callback(TEXT.statusButtons.listening, 'a:listening'),
        Markup.button.callback(TEXT.statusButtons.excused, 'a:excused'),
      ]])
    : Markup.inlineKeyboard([]);

async function refreshSessionWidget(telegram, session, master) {
  if (!session?.messageId) return;
  try {
    await telegram.editMessageText(
      session.chatId, session.messageId, undefined,
      sessionText(session, master),
      { parse_mode: 'Markdown', ...sessionKb(session.active, session.registrationOpen !== false) }
    );
  } catch (e) {
    if (!e.message?.includes('message is not modified'))
      console.error('refreshSessionWidget:', e.message);
  }
}

async function refreshManageWidget(ctx, session, master) {
  try {
    await ctx.editMessageText(manageText(session, master), { parse_mode: 'Markdown', ...manageKb(session, master) });
  } catch (e) {
    if (!e.message?.includes('message is not modified')) throw e;
  }
}

// ─── ② MEMBERS WIDGET ────────────────────────────────────────────────────────
function membersText(master) {
  if (!master.members.length)
    return TEXT.emptyMembers;
  const sorted = sortArabic(master.members.map(m => m.name));
  return (
    TEXT.membersHeader(master.members.length) +
    sorted.map((n, i) => `${i + 1}. ${n}`).join('\n')
  );
}

function membersKb(master) {
  const sorted = sortArabic(master.members.map(m => m.name));
  const rows = sorted.map((name, i) => [
    Markup.button.callback(`🔧 ${name}`, `mb:pick:${i}`),
  ]);
  rows.push([Markup.button.callback(TEXT.addMemberButton, 'mb:add')]);
  return Markup.inlineKeyboard(rows);
}

function memberOptionsKb(idx) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(TEXT.renameButton, `mb:ren:${idx}`),
      Markup.button.callback(TEXT.deleteButton, `mb:del:${idx}`),
    ],
    [Markup.button.callback(TEXT.backButton, 'mb:back')],
  ]);
}

// ─── ③ SESSION MANAGE WIDGET ─────────────────────────────────────────────────
function manageText(session, master) {
  const names = sessionNames(session, master);
  let t = TEXT.manageHeader(session.name);
  for (const name of names) {
    const { e, a } = st(session.attendance[name] || null);
    const callMark = calledIcon(calledState(session, name));
    t += `${e} ${callMark}${name} – ${a}\n`;
  }
  return t;
}

function manageKb(session, master) {
  const names = sessionNames(session, master);
  const rows = names.map((name, i) => {
    const { e } = st(session.attendance[name] || null);
    return [Markup.button.callback(`${e} ${name}`, `sm:pick:${i}`)];
  });
  rows.push([Markup.button.callback(TEXT.refreshButton, 'sm:refresh')]);
  return Markup.inlineKeyboard(rows);
}

// ─── BOT ──────────────────────────────────────────────────────────────────────
const bot = new Telegraf(process.env.BOT_TOKEN);

bot.start(async (ctx) => {
  if (!await isAdmin(ctx)) return ctx.reply(TEXT.adminOnly);
  return ctx.replyWithMarkdown(TEXT.help(true));
});
bot.help(async (ctx)  => ctx.replyWithMarkdown(TEXT.help(await isAdmin(ctx))));

// ─── /myid ────────────────────────────────────────────────────────────────────
bot.command('myid', (ctx) => {
  const displayName = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ') || ctx.from.username || TEXT.noNameFallback;
  ctx.reply(TEXT.myIdInfo(displayName, ctx.from.id));
});

// ─── /registerinfo ────────────────────────────────────────────────────────────
bot.command('registerinfo', async (ctx) => {
  if (!await isAdmin(ctx)) return ctx.reply(TEXT.adminOnly);

  ctx.replyWithMarkdown(TEXT.registerInfo);
});

// ─── /status ──────────────────────────────────────────────────────────────────
bot.command('status', async (ctx) => {
  if (!await isAdmin(ctx)) return ctx.reply(TEXT.adminOnly);
  const session = await getSession();
  const master  = await getMaster();
  if (!session)
    return ctx.reply(TEXT.statusNoSession(master.members.length));

  const counts = { present: 0, listening: 0, excused: 0, pending: 0 };
  const names = rawSessionNames(session, master);
  for (const name of names) {
    const k = session.attendance[name] || 'pending';
    counts[k] = (counts[k] || 0) + 1;
  }
  ctx.replyWithMarkdown(
    TEXT.statusReport({ name: session.name, ...counts }, names.length)
  );
});

// ─── /members ─────────────────────────────────────────────────────────────────
bot.command('members', async (ctx) => {
  if (!await isAdmin(ctx)) return ctx.reply(TEXT.adminOnly);
  const master = await getMaster();
  ctx.replyWithMarkdown(membersText(master), membersKb(master));
});

// ─── /addmember ───────────────────────────────────────────────────────────────
bot.command('addmember', async (ctx) => {
  if (!await isAdmin(ctx)) return ctx.reply(TEXT.adminOnly);
  const args  = ctx.message.text.split(' ').slice(1).join(' ');
  const parts = args.split('|').map(s => s.trim());
  if (parts.length !== 2 || !parts[0] || !parts[1])
    return ctx.reply(TEXT.invalidAddFormat);

  const [rawId, name] = parts;
  if (!/^\d+$/.test(rawId))
    return ctx.reply(TEXT.invalidUserId);
  const userId = rawId;

  const master = await getMaster();
  if (master.members.find(m => m.name === name))
    return ctx.reply(TEXT.memberExists(name), { parse_mode: 'Markdown' });
  if (master.members.find(m => m.userId === userId))
    return ctx.reply(TEXT.userIdLinked(userId));

  master.members.push({ userId, name });
  await saveMaster(master);

  const session = await getSession();
  if (session) {
    session.attendance[name] = null;
    if (session.called) session.called[name] = null;
    await saveSession(session);
    await refreshSessionWidget(bot.telegram, session, master);
  }
  ctx.reply(TEXT.memberAdded(name, userId), { parse_mode: 'Markdown' });
});

// ─── /removemember ────────────────────────────────────────────────────────────
bot.command('removemember', async (ctx) => {
  if (!await isAdmin(ctx)) return ctx.reply(TEXT.adminOnly);
  const name = ctx.message.text.split(' ').slice(1).join(' ').trim();
  if (!name) return ctx.reply(TEXT.invalidRemoveFormat);

  const master = await getMaster();
  const idx = master.members.findIndex(m => m.name === name);
  if (idx === -1)
    return ctx.reply(TEXT.memberNotInList(name), { parse_mode: 'Markdown' });

  master.members.splice(idx, 1);
  await saveMaster(master);

  const session = await getSession();
  if (session) {
    delete session.attendance[name];
    await saveSession(session);
    await refreshSessionWidget(bot.telegram, session, master);
  }
  ctx.reply(TEXT.memberDeleted(name), { parse_mode: 'Markdown' });
});

// ─── /renamemember ────────────────────────────────────────────────────────────
bot.command('renamemember', async (ctx) => {
  if (!await isAdmin(ctx)) return ctx.reply(TEXT.adminOnly);
  const args  = ctx.message.text.split(' ').slice(1).join(' ');
  const parts = args.split('|').map(s => s.trim());
  if (parts.length !== 2 || !parts[0] || !parts[1])
    return ctx.reply(TEXT.invalidRenameFormat);

  const [oldName, newName] = parts;
  const master = await getMaster();

  const entry = master.members.find(m => m.name === oldName);
  if (!entry)
    return ctx.reply(TEXT.oldNameNotFound(oldName), { parse_mode: 'Markdown' });
  if (master.members.find(m => m.name === newName))
    return ctx.reply(TEXT.nameTaken(newName), { parse_mode: 'Markdown' });

  entry.name = newName;
  await saveMaster(master);

  const session = await getSession();
  if (session && oldName in session.attendance) {
    session.attendance[newName] = session.attendance[oldName];
    delete session.attendance[oldName];
    await saveSession(session);
    await refreshSessionWidget(bot.telegram, session, master);
  }
  ctx.reply(TEXT.memberRenamed(oldName, newName), { parse_mode: 'Markdown' });
});

// ─── /startsession & /startopensession ───────────────────────────────────────
async function startSession(ctx, openRegistration) {
  if (!await isAdmin(ctx)) return ctx.reply(TEXT.adminOnly);
  if (await getSession())
    return ctx.reply(TEXT.sessionAlreadyActive);

  const name = ctx.message.text.split(' ').slice(1).join(' ').trim();
  if (!name) return ctx.reply(TEXT.invalidStartFormat);

  const master = await getMaster();
  const currentSeries = await getCurrentSeries();
  const attendance = openRegistration
    ? {}
    : Object.fromEntries(master.members.map((m) => [m.name, null]));

  const session = {
    name,
    startedAt: new Date().toISOString(),
    startedBy: ctx.from.id,
    seriesId: currentSeries,
    chatId:    ctx.chat.id,
    messageId: null,
    active:    true,
    registrationOpen: true,
    openRegistration,
    attendance,
    called: {},
  };

  const sent = await ctx.replyWithMarkdown(sessionText(session, master), sessionKb(true, true));
  session.messageId = sent.message_id;
  await saveSession(session);

  try { await ctx.pinChatMessage(sent.message_id, { disable_notification: true }); } catch (_) {}
}

bot.command('startsession',     (ctx) => startSession(ctx, false)); // registered only
bot.command('startopensession', (ctx) => startSession(ctx, true));  // any member

// ─── /stopregistration ───────────────────────────────────────────────────────
bot.command('stopregistration', async (ctx) => {
  if (!await isAdmin(ctx)) return ctx.reply(TEXT.adminOnly);
  const session = await getSession();
  if (!session) return ctx.reply(TEXT.noSessionActive);
  if (session.registrationOpen === false)
    return ctx.reply(TEXT.registrationAlreadyStopped);

  session.registrationOpen = false;
  await saveSession(session);

  const master = await getMaster();
  await refreshSessionWidget(bot.telegram, session, master);
  ctx.reply(TEXT.registrationStopped);
});

// ─── Series and records management (admin, with confirm) ─────────────────────
async function resetSeriesCommand(ctx) {
  if (!await isCreator(ctx)) return ctx.reply(TEXT.creatorOnly);
  if (await getSession()) return ctx.reply(TEXT.closeSeriesNeedsNoActiveSession);

  const current = await getCurrentSeries();
  const token = setPendingConfirm(ctx.from.id, { action: 'closeSeries', current });
  return ctx.replyWithMarkdown(
    TEXT.confirmPrompt(`إغلاق السلسلة ${current} وبدء سلسلة جديدة`),
    confirmKb(token)
  );
}

bot.command('resetseries', resetSeriesCommand);
// Backward-compatible alias; hidden from docs/commands.
bot.command('closeseries', resetSeriesCommand);

bot.command('records', async (ctx) => {
  if (!await isAdmin(ctx)) return ctx.reply(TEXT.adminOnly);
  const all = await getSessions();
  const currentSeries = await getCurrentSeries();
  const scoped = sessionsInSeries(all, currentSeries);
  if (!scoped.length) return ctx.reply(TEXT.noSeriesRecords(currentSeries));

  const lines = scoped.map((s, i) => TEXT.recordsLine(i + 1, s));
  return ctx.reply(`${TEXT.recordsHeader(currentSeries, scoped.length)}\n\n${lines.join('\n')}`);
});

bot.command('removerecord', async (ctx) => {
  if (!await isCreator(ctx)) return ctx.reply(TEXT.creatorOnly);
  const raw = ctx.message.text.split(' ').slice(1).join(' ').trim();
  const idx = parseInt(raw, 10);
  if (!Number.isInteger(idx) || idx < 1) return ctx.reply(TEXT.invalidRecordIndex);

  const all = await getSessions();
  const currentSeries = await getCurrentSeries();
  const scopedAbs = all
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => sessionSeries(s) === currentSeries);
  const picked = scopedAbs[idx - 1];
  if (!picked) return ctx.reply(TEXT.invalidRecordIndex);

  const token = setPendingConfirm(ctx.from.id, {
    action: 'removeRecord',
    absoluteIndex: picked.i,
    recordIndex: idx,
  });
  return ctx.replyWithMarkdown(TEXT.confirmPrompt(`حذف السجل #${idx}`), confirmKb(token));
});

bot.command('removememberrecord', async (ctx) => {
  if (!await isCreator(ctx)) return ctx.reply(TEXT.creatorOnly);
  const raw = ctx.message.text.split(' ').slice(1).join(' ').trim();
  const parts = raw.split('|').map((s) => s.trim());
  if (parts.length !== 2 || !parts[0] || !parts[1])
    return ctx.reply(TEXT.invalidRemoveMemberRecordFormat);

  const idx = parseInt(parts[0], 10);
  const name = parts[1];
  if (!Number.isInteger(idx) || idx < 1) return ctx.reply(TEXT.invalidRecordIndex);

  const all = await getSessions();
  const currentSeries = await getCurrentSeries();
  const scopedAbs = all
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => sessionSeries(s) === currentSeries);
  const picked = scopedAbs[idx - 1];
  if (!picked) return ctx.reply(TEXT.invalidRecordIndex);
  if (!picked.s.attendance || !(name in picked.s.attendance))
    return ctx.reply(TEXT.recordMemberNotFound(name), { parse_mode: 'Markdown' });

  const token = setPendingConfirm(ctx.from.id, {
    action: 'removeMemberRecord',
    absoluteIndex: picked.i,
    recordIndex: idx,
    name,
  });
  return ctx.replyWithMarkdown(
    TEXT.confirmPrompt(`حذف سجل ${name} من السجل #${idx}`),
    confirmKb(token)
  );
});

bot.command('clearrecords', async (ctx) => {
  if (!await isCreator(ctx)) return ctx.reply(TEXT.creatorOnly);
  const token = setPendingConfirm(ctx.from.id, { action: 'clearRecords' });
  return ctx.replyWithMarkdown(TEXT.confirmPrompt('حذف جميع السجلات المؤرشفة'), confirmKb(token));
});

bot.action(/^cf:(ok|cancel):([A-Z0-9]{6})$/, async (ctx) => {
  if (!await isCreator(ctx))
    return ctx.answerCbQuery(TEXT.creatorOnly, { show_alert: true });

  const mode = ctx.match[1];
  const token = ctx.match[2];
  const pending = pendingConfirms.get(token);
  if (!pending)
    return ctx.answerCbQuery(TEXT.confirmNotFound, { show_alert: true });
  if (pending.userId !== String(ctx.from.id))
    return ctx.answerCbQuery(TEXT.confirmNotOwner, { show_alert: true });
  if (pending.expiresAt < Date.now()) {
    pendingConfirms.delete(token);
    return ctx.answerCbQuery(TEXT.confirmExpired, { show_alert: true });
  }

  if (mode === 'cancel') {
    pendingConfirms.delete(token);
    await ctx.editMessageText(TEXT.confirmCancelled);
    return ctx.answerCbQuery();
  }

  pendingConfirms.delete(token);
  const result = await executePendingConfirm(pending);
  await ctx.editMessageText(result.text, result.parse_mode ? { parse_mode: result.parse_mode } : undefined);
  return ctx.answerCbQuery();
});

// ─── /endsession ──────────────────────────────────────────────────────────────
bot.command('endsession', async (ctx) => {
  if (!await isAdmin(ctx)) return ctx.reply(TEXT.adminOnly);
  const session = await getSession();
  if (!session) return ctx.reply(TEXT.noSessionActive);

  const master = await getMaster();

  // Everyone who never responded becomes absent.
  // In open sessions, this applies only to participants present in this session.
  const absentBase = rawSessionNames(session, master);
  for (const name of absentBase) {
    if (!session.attendance[name]) session.attendance[name] = 'absent';
  }
  session.active  = false;
  session.endedAt = new Date().toISOString();
  session.endedBy = ctx.from.id;

  await refreshSessionWidget(bot.telegram, session, master);

  try { await ctx.unpinChatMessage(session.messageId); } catch (_) {}

  await archiveSession(session);
  await clearSession();

  const groups = { present: [], listening: [], excused: [], absent: [] };
  const reportNames = sessionNames(session, master);
  for (const n of reportNames) {
    const k = session.attendance[n] || 'absent';
    (groups[k] || groups.absent).push(n);
  }

  ctx.replyWithMarkdown(TEXT.report(session, groups));
});

// ─── /sessionmanage ───────────────────────────────────────────────────────────
bot.command('sessionmanage', async (ctx) => {
  if (!await isAdmin(ctx)) return ctx.reply(TEXT.adminOnly);
  const session = await getSession();
  if (!session) return ctx.reply(TEXT.noSessionActive);
  const master = await getMaster();
  ctx.replyWithMarkdown(manageText(session, master), manageKb(session, master));
});

bot.command('history', async (ctx) => {
  if (!await isAdmin(ctx)) return ctx.reply(TEXT.adminOnly);
  const all = await getSessions();
  const currentSeries = await getCurrentSeries();
  const sessions = sessionsInSeries(all, currentSeries);
  if (!sessions.length) return ctx.reply(TEXT.historyEmpty);
  const master  = await getMaster();
  const tally   = {};
  for (const name of master.members.map(m => m.name)) {
    tally[name] = { present: 0, listening: 0, excused: 0, absent: 0 };
  }
  for (const s of sessions) {
    for (const [name, key] of Object.entries(s.attendance || {})) {
      if (tally[name] && key in tally[name]) tally[name][key]++;
    }
  }
  const lines = sortArabic(Object.keys(tally)).map((name) => {
    const t = tally[name];
    return TEXT.historyLine(name, t.present, t.listening, t.excused, t.absent);
  });
  ctx.reply(`${TEXT.historyHeader(sessions.length)}\n\n${lines.join('\n\n')}`);
});

// ══════════════════════════════════════════════════════════════════════════════
// CALLBACK HANDLERS
// ══════════════════════════════════════════════════════════════════════════════

// ─── Members widget: pick a member ────────────────────────────────────────────
bot.action(/^mb:pick:(\d+)$/, async (ctx) => {
  if (!await isAdmin(ctx))
    return ctx.answerCbQuery(TEXT.adminOnly, { show_alert: true });

  const master = await getMaster();
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

// ─── Members widget: delete member ────────────────────────────────────────────
bot.action(/^mb:del:(\d+)$/, async (ctx) => {
  if (!await isAdmin(ctx))
    return ctx.answerCbQuery(TEXT.adminOnly, { show_alert: true });

  const master = await getMaster();
  const sorted = sortArabic(master.members.map(m => m.name));
  const i      = parseInt(ctx.match[1], 10);
  const name   = sorted[i];
  if (!name) return ctx.answerCbQuery(TEXT.memberNotFound, { show_alert: true });

  master.members.splice(master.members.findIndex(m => m.name === name), 1);
  await saveMaster(master);

  const session = await getSession();
  if (session) {
    delete session.attendance[name];
    if (session.called) delete session.called[name];
    await saveSession(session);
    await refreshSessionWidget(bot.telegram, session, master);
  }

  await ctx.editMessageText(membersText(master), { parse_mode: 'Markdown', ...membersKb(master) });
  ctx.answerCbQuery(TEXT.memberDeletedShort(name));
});

// ─── Members widget: rename prompt ────────────────────────────────────────────
bot.action(/^mb:ren:(\d+)$/, async (ctx) => {
  if (!await isAdmin(ctx))
    return ctx.answerCbQuery(TEXT.adminOnly, { show_alert: true });

  const master = await getMaster();
  const sorted = sortArabic(master.members.map(m => m.name));
  const i      = parseInt(ctx.match[1], 10);
  const name   = sorted[i];
  if (!name) return ctx.answerCbQuery(TEXT.memberNotFound, { show_alert: true });

  await ctx.answerCbQuery();
  const msgId = ctx.callbackQuery.message.message_id;
  await setAwaiting(String(ctx.from.id), {
    action: 'rename',
    chatId: ctx.chat.id,
    msgId,
    oldName: name,
    promptMsgId: null,
    awaitingPrompt: true,
  });
  const prompt = await ctx.reply(TEXT.renamePrompt(name), {
    parse_mode: 'Markdown',
    reply_markup: {
      force_reply: true,
      input_field_placeholder: 'الاسم الجديد',
      selective: true,
    },
  });
  await setAwaiting(String(ctx.from.id), {
    action: 'rename',
    chatId: ctx.chat.id,
    msgId,
    oldName: name,
    promptMsgId: prompt.message_id,
    awaitingPrompt: false,
  });
});

// ─── Members widget: back to list ─────────────────────────────────────────────
bot.action('mb:back', async (ctx) => {
  if (!await isAdmin(ctx))
    return ctx.answerCbQuery(TEXT.adminOnly, { show_alert: true });
  const master = await getMaster();
  await ctx.editMessageText(membersText(master), { parse_mode: 'Markdown', ...membersKb(master) });
  ctx.answerCbQuery();
});

// ─── Members widget: add member prompt ────────────────────────────────────────
bot.action('mb:add', async (ctx) => {
  if (!await isAdmin(ctx))
    return ctx.answerCbQuery(TEXT.adminOnly, { show_alert: true });

  await ctx.answerCbQuery();
  const msgId = ctx.callbackQuery.message.message_id;
  await setAwaiting(String(ctx.from.id), {
    action: 'add',
    chatId: ctx.chat.id,
    msgId,
    promptMsgId: null,
    awaitingPrompt: true,
  });
  const prompt = await ctx.reply(TEXT.inlinePromptAdd, {
    reply_markup: {
      force_reply: true,
      input_field_placeholder: '123456789 | أحمد محمد',
      selective: true,
    },
  });
  await setAwaiting(String(ctx.from.id), {
    action: 'add',
    chatId: ctx.chat.id,
    msgId,
    promptMsgId: prompt.message_id,
    awaitingPrompt: false,
  });
});

// ─── Attendance widget: member records own status ─────────────────────────────
bot.action(/^a:(present|listening|excused)$/, async (ctx) => {
  const session = await getSession();
  if (!session?.active)
    return ctx.answerCbQuery(TEXT.noSessionActive, { show_alert: true });
  if (session.registrationOpen === false)
    return ctx.answerCbQuery(TEXT.registrationClosedAlert, { show_alert: true });

  const master = await getMaster();
  const uid    = String(ctx.from.id);
  const member = master.members.find(m => m.userId === uid);
  if (!member) {
    if (!session.openRegistration)
      return ctx.answerCbQuery(TEXT.needRegistration, { show_alert: true });

    const name = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ')
      || ctx.from.username || TEXT.noNameFallback;
    master.members.push({ userId: uid, name });
    await saveMaster(master);
    session.attendance[name] = ctx.match[1];
    await saveSession(session);
    await refreshSessionWidget(bot.telegram, session, master);
    return ctx.answerCbQuery(TEXT.registeredSelf(st(ctx.match[1]).a));
  }

  const newStatus = ctx.match[1];
  session.attendance[member.name] = newStatus;
  await saveSession(session);
  await refreshSessionWidget(bot.telegram, session, master);
  ctx.answerCbQuery(TEXT.registeredAs(st(newStatus).a));
});

// ─── Session manage: pick member to override ──────────────────────────────────
bot.action(/^sm:pick:(\d+)$/, async (ctx) => {
  if (!await isAdmin(ctx))
    return ctx.answerCbQuery(TEXT.adminOnly, { show_alert: true });

  const session = await getSession();
  if (!session) return ctx.answerCbQuery(TEXT.noSessionShort, { show_alert: true });

  const master = await getMaster();
  const names  = sessionNames(session, master);
  const i      = parseInt(ctx.match[1], 10);
  const name   = names[i];
  if (!name) return ctx.answerCbQuery(TEXT.memberNotFound, { show_alert: true });

  const { e } = st(session.attendance[name] || null);
  const callState = calledState(session, name);

  await ctx.editMessageText(
    TEXT.managePickHeader(name, e, callState),
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback(TEXT.manageButtons.present,   `sm:set:${i}:present`),
          Markup.button.callback(TEXT.manageButtons.listening, `sm:set:${i}:listening`),
        ],
        [
          Markup.button.callback(TEXT.manageButtons.excused, `sm:set:${i}:excused`),
          Markup.button.callback(TEXT.manageButtons.absent,  `sm:set:${i}:absent`),
        ],
        [
          Markup.button.callback(TEXT.manageButtons.markCalling, `sm:call:${i}:responding`),
          Markup.button.callback(TEXT.manageButtons.markResponded, `sm:call:${i}:responded`),
        ],
        [
          Markup.button.callback(TEXT.manageButtons.markAway, `sm:call:${i}:away`),
        ],
        [
          Markup.button.callback(TEXT.manageButtons.clearCalled, `sm:call:${i}:clear`),
        ],
        [Markup.button.callback(TEXT.manageButtons.back, 'sm:back')],
      ]),
    }
  );
  ctx.answerCbQuery();
});

// ─── Session manage: mark/unmark called member ───────────────────────────────
bot.action(/^sm:call:(\d+):(responding|responded|away|clear)$/, async (ctx) => {
  if (!await isAdmin(ctx))
    return ctx.answerCbQuery(TEXT.adminOnly, { show_alert: true });

  const session = await getSession();
  if (!session) return ctx.answerCbQuery(TEXT.noSessionShort, { show_alert: true });

  const master = await getMaster();
  const names  = sessionNames(session, master);
  const i      = parseInt(ctx.match[1], 10);
  const name   = names[i];
  if (!name) return ctx.answerCbQuery(TEXT.memberNotFound, { show_alert: true });
  const state = ctx.match[2];

  if (!session.called) session.called = {};
  session.called[name] = state === 'clear' ? null : state;
  await saveSession(session);
  await refreshSessionWidget(bot.telegram, session, master);

  await refreshManageWidget(ctx, session, master);
  ctx.answerCbQuery(
    state === 'responding' ? `👉 ${name} الآن قيد الرد.`
      : state === 'responded' ? `✅ تم تعليم ${name} بأنها حاضرة.`
      : state === 'away' ? `📣 تم تعليم ${name} بأنها كانت بعيدة عن الميكروفون.`
      : `↩️ أزيلت علامة النداء عن ${name}.`
  );
});

// ─── Session manage: apply status ─────────────────────────────────────────────
bot.action(/^sm:set:(\d+):(present|listening|excused|absent)$/, async (ctx) => {
  if (!await isAdmin(ctx))
    return ctx.answerCbQuery(TEXT.adminOnly, { show_alert: true });

  const session = await getSession();
  if (!session) return ctx.answerCbQuery(TEXT.noSessionShort, { show_alert: true });

  const master = await getMaster();
  const names  = sessionNames(session, master);
  const i      = parseInt(ctx.match[1], 10);
  const name   = names[i];
  const status = ctx.match[2];
  if (!name) return ctx.answerCbQuery(TEXT.memberNotFound, { show_alert: true });

  session.attendance[name] = status;
  await saveSession(session);
  await refreshSessionWidget(bot.telegram, session, master);

  await refreshManageWidget(ctx, session, master);
  ctx.answerCbQuery(TEXT.statusSet(name, st(status).a));
});

// ─── Session manage: back / refresh ───────────────────────────────────────────
bot.action('sm:back', async (ctx) => {
  await ctx.answerCbQuery();
  const session = await getSession();
  if (!session) return;
  const master = await getMaster();
  await refreshManageWidget(ctx, session, master);
});

bot.action('sm:refresh', async (ctx) => {
  const session = await getSession();
  if (!session) return ctx.answerCbQuery(TEXT.noSessionShort, { show_alert: true });
  const master = await getMaster();
  await refreshManageWidget(ctx, session, master);
  ctx.answerCbQuery(TEXT.refreshed);
});

// ══════════════════════════════════════════════════════════════════════════════
// TEXT HANDLER — catches awaiting admin input (add / rename)
// ══════════════════════════════════════════════════════════════════════════════
bot.on('text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;

  const uid     = String(ctx.from.id);
  const pending = await getAwaiting(uid);
  if (!pending) return;

  if (pending.awaitingPrompt && !pending.promptMsgId) {
    return ctx.reply('⏳ جاري تجهيز رسالة الإدخال، من فضلك انتظري لحظة ثم أرسلي الرد على الرسالة نفسها.');
  }

  if (pending.promptMsgId) {
    const replyId = ctx.message.reply_to_message?.message_id;
    if (replyId !== pending.promptMsgId)
      return ctx.reply(TEXT.replyToPromptOnly);
  }

  await delAwaiting(uid);
  const input = ctx.message.text.trim();
  if (!input) return ctx.reply(TEXT.emptyInput);

  const master = await getMaster();

  if (pending.action === 'add') {
    const parts = input.split('|').map(s => s.trim());
    if (parts.length !== 2 || !parts[0] || !parts[1])
      return ctx.reply(TEXT.inlineInvalidAddFormat);

    const [rawId, newName] = parts;
    if (!/^\d+$/.test(rawId))
      return ctx.reply(TEXT.invalidUserId);
    const userId = rawId;

    if (master.members.find(m => m.name === newName))
      return ctx.reply(TEXT.memberExists(newName), { parse_mode: 'Markdown' });
    if (master.members.find(m => m.userId === userId))
      return ctx.reply(TEXT.userIdLinked(userId));

    master.members.push({ userId, name: newName });
    await saveMaster(master);

    const session = await getSession();
    if (session) {
      session.attendance[newName] = null;
      await saveSession(session);
      await refreshSessionWidget(bot.telegram, session, master);
    }

    ctx.reply(TEXT.memberAdded(newName, userId), { parse_mode: 'Markdown' });
    bot.telegram.editMessageText(
      pending.chatId, pending.msgId, undefined,
      membersText(master),
      { parse_mode: 'Markdown', ...membersKb(master) }
    ).catch(() => {});
  }

  if (pending.action === 'rename') {
    const { oldName } = pending;
    const newName = input;

    if (master.members.find(m => m.name === newName))
      return ctx.reply(TEXT.nameTaken(newName), { parse_mode: 'Markdown' });

    const entry = master.members.find(m => m.name === oldName);
    if (!entry)
      return ctx.reply(TEXT.memberGone(oldName), { parse_mode: 'Markdown' });

    entry.name = newName;
    await saveMaster(master);

    const session = await getSession();
    if (session && oldName in session.attendance) {
      session.attendance[newName] = session.attendance[oldName];
      delete session.attendance[oldName];
      if (session.called && oldName in session.called) {
        session.called[newName] = session.called[oldName];
        delete session.called[oldName];
      }
      await saveSession(session);
      await refreshSessionWidget(bot.telegram, session, master);
    }

    ctx.reply(TEXT.memberRenamed(oldName, newName), { parse_mode: 'Markdown' });
    bot.telegram.editMessageText(
      pending.chatId, pending.msgId, undefined,
      membersText(master),
      { parse_mode: 'Markdown', ...membersKb(master) }
    ).catch(() => {});
  }
});

// ─── Error handler ────────────────────────────────────────────────────────────
bot.catch((err, ctx) => {
  console.error('Bot error:', err?.message);
  ctx?.reply(TEXT.genericError).catch(() => {});
});

// ─── Launch ───────────────────────────────────────────────────────────────────
// On Vercel/serverless the bot runs via webhook (see api/telegram.js).
// Locally (or on a long-running host) it uses long-polling.
if (require.main === module && !process.env.VERCEL) {
  bot.launch().then(() => console.log('✅ Bot is running...'));
  process.once('SIGINT',  () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

module.exports = bot;
