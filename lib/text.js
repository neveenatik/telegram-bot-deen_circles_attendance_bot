// All Arabic text strings for the bot
// UI messages, prompts, buttons, reports

import { formatPages, getFirstPage } from './helpers.js';
import * as participants from './sessionParticipants.js';
import { requiresRegistrationApproval } from './sessionTypes.js';

// Helper for Arabic alphabetical comparison
function compareArabic(a, b) {
  return a.localeCompare(b, 'ar');
}

// Helper to sort page-based entries by page number, then alphabetically
function sortByPageThenName(groups) {
  for (const group of Object.values(groups)) {
    group.sort((a, b) => {
      const pageDiff = getFirstPage(a[1]) - getFirstPage(b[1]);
      return pageDiff !== 0 ? pageDiff : compareArabic(a[0], b[0]);
    });
  }
}

// Helper to sort names alphabetically (for non-page reports)
function sortNamesAlphabetically(arr) {
  return [...arr].sort((a, b) => compareArabic(a, b));
}

// Order roster members by their stable list number (ascending); anyone without
// a number sorts last, alphabetically. Reports use this so rows match the roster
// order the teacher knows rather than the alphabet.
function sortByListNumber(session, arr) {
  return [...arr].sort((a, b) => {
    const la = participants.getListNumber(session, a);
    const lb = participants.getListNumber(session, b);
    if (la == null && lb == null) return compareArabic(a, b);
    if (la == null) return 1;
    if (lb == null) return -1;
    return la - lb;
  });
}

// Walk-in guests (participants with no memberId) are reported in their own
// trailing section so an accidental tap never mixes into the official roster
// results. A guest still in the live pending queue is tagged with ⏳ so admins
// know she is awaiting approval; dismissed walk-ins leave no trace and stay
// untagged.
const GUESTS_TITLE = 'زائرات (غير مسجّلات)';

function isGuestName(session, name) {
  return Boolean(participants.get(session, name)?.isGuest);
}

function pendingSuffix(name, opts) {
  return opts?.isPending && opts.isPending(name) ? ' ⏳ قيد الموافقة' : '';
}

// Attestations a student affirms when self-registering for a recitation-correction
// (registeredSecondary) session. The two common commitments are always affirmed and
// shown once; the main-session line differs by which button she taps. Shared by the
// widget footer and the on-register alert so the wording never drifts.
const RECITE_COMMON_POINTS = [
  '• استمعتُ للشيخ قبل المشاركة فى الحلقه.',
  '• لم أشارك بعد في حلقة تصحيح تلاوة هذا الأسبوع.',
];
const RECITE_MAIN_YES_LINE = '• حضرتُ الحلقة الأساسية مع المعلمه نهى عيد.';
const RECITE_MAIN_NO_LINE = '• لم أحضر الحلقة الأساسية هذا الأسبوع.';

export const TEXT = {
  adminOnly: '⛔ هذا الأمر متاح للمشرفين فقط.',
  creatorOnly: '⛔ هذا الأمر متاح لمنشئ المجموعة فقط.',
  noSessionActive: '⚠️ لا توجد قائمة نشطة.',
  sessionAlreadyActive: '⚠️ توجد قائمة نشطة بالفعل. أنهِها أولاً بـ /stoplist',
  memberNotFound: '⚠️ العضو غير موجود.',
  invalidAddFormat: '⚠️ الطريقة الصحيحة لإضافة طالبة أو أكثر:\n/addstudent [رقم الحساب] | [الاسم]\nأمثلة:\n123456789 | فاطمة محمد\n987654321 | عائشة علي',
  invalidRenameFormat: '⚠️ الطريقة الصحيحة لتعديل الاسم (كل تعديل في سطر):\n/renamestudent [الاسم الحالي] | [الاسم الجديد]\nأمثلة:\nفاطمة القديم | فاطمة الجديد\nعائشة القديم | عائشة الجديد',
  invalidStartFormat: '⚠️ مثال: /startlist اجتماع يونيو',
  invalidPageListFormat: '⚠️ مثال: /startpagelist جلسة قراءة يونيو',
  invalidRemoveFormat: '⚠️ أسهل طريقة للحذف هي عبر /students.\n\nويمكنك استخدام الأمر الاحتياطي بهذا الشكل:\n/removestudent [الاسم أو رقم الحساب]\nأمثلة:\nفاطمة محمد\n123456789\nعائشة علي, 987654321',
  invalidAddTrainingGroupFormat: '⚠️ الطريقة الصحيحة:\n/addtraininggroup [رقم المجموعة] | [اسم المجموعة]\n\nمثال:\n/addtraininggroup -1001234567890 | تدريب المجموعة الأولى',
  invalidRemoveTrainingGroupFormat: '⚠️ الطريقة الصحيحة:\n/removetraininggroup [رقم المجموعة]\n\nمثال:\n/removetraininggroup -1001234567890',
  invalidTrainingGroupId: '⚠️ رقم مجموعة التدريب غير صحيح. مثال: -1001234567890',
  invalidUserId: '⚠️ رقم الحساب يجب أن يكون أرقاماً فقط.',
  emptyInput: '⚠️ الإدخال لا يمكن أن يكون فارغاً.',
  needRegistration: '⚠️ هذه الحلقة للمسجّلات فقط.\nاسمك غير موجود حالياً في القائمة، تواصلي مع المشرفة بارك الله فيكِ.',
  genericError: '⚠️ عذراً، حصل خلل بسيط. حاولي مرة أخرى بعد قليل.',
  sessionEnded: '_✅ الحلقة منتهية_',
  sessionJoinPrompt: '_حياكِ الله، سجّلي حضورك بالضغط على الخيار المناسب بالأسفل:_',
  pageListJoinPrompt: '_حياكِ الله، سجّلي حضورك لتحصلي على صفحتكِ تلقائياً:_',
  pageAssigned: (name, page) => `✅ ${name} — صفحة ${page}`,
  alreadyHasPage: (page) => `ℹ️ بارك الله فيكِ، صفحتكِ في هذه الجلسة هي ${page} بالفعل.`,
  sessionRegistrationClosed: '_⛔ تم إيقاف تسجيل الحضور حالياً من المشرفة._',
  registrationStopped: '✅ تم إيقاف تسجيل الحضور. لن يتمكن الأعضاء من تغيير حالتهم الآن.',
  registrationAlreadyStopped: 'ℹ️ تسجيل الحضور متوقف بالفعل.',
  registrationClosedAlert: '⛔ تسجيل الحضور متوقف حالياً. جزاكِ الله خيراً.',
  sessionSummaryTotal: (count) => `👥 الإجمالي: ${count}`,
  sessionSummaryPresent: (count) => `✅ حاضرة: ${count}`,
  sessionSummaryListening: (count) => `👂 مستمعة: ${count}`,
  sessionSummaryExcused: (count) => `🔔 معتذرة: ${count}`,
  sessionSummaryPending: (count) => `⏳ لم تُسجّل: ${count}`,
  sessionFollowupEmpty: (name) => `📋 *متابعة الحضور — ${name}*\n\n— لا توجد أسماء حتى الآن —`,
  sessionFollowupChunkHeader: (name, page, total) => `📋 *متابعة الحضور — ${name}* (${page}/${total})`,
  sessionDefaultHeader: (name) => `📚 *قائمة: ${name}*`,
  sessionListMessagesCount: (count) => `📄 رسائل القائمة: ${count}`,
  editSessionPickerText: '⚙️ *اختيار القائمة للتعديل*\n\nاضغطي على القائمة المطلوبة لفتح لوحة التعديل.',
  editSessionPickerButton: (name) => `🗂️ ${name}`,
  panelSentToDm: '✉️ أرسلتُ لكِ لوحة تعديل الحضور في محادثتنا الخاصة. تابعي التعديل هناك بإذن الله.',
  startBotInDmNudge: (link) =>
    link
      ? `🔒 لكي أرسل لكِ لوحة التعديل في الخاص، افتحي محادثة معي أولاً بالضغط على الرابط ثم زر «ابدأ»، وبعدها أعيدي الأمر:\n\n${link}`
      : '🔒 لكي أرسل لكِ لوحة التعديل في الخاص، افتحي محادثة خاصة معي واضغطي «ابدأ»، ثم أعيدي الأمر هنا.',
  manageMemberButton: (name) => `🔧 ${name}`,
  pageIndicator: (page, totalPages) => `📄 صفحة ${page}/${totalPages}`,
  noSeriesRecords: (s) => `⚠️ لا توجد سجلات في الدورة الحالية (${s}).`,
  historyHomeText: (series, count) =>
    `🗂️ *سجلات الدورة ${series}*\n` +
    `عدد السجلات: ${count}\n\n` +
    `اختاري الإجراء:\n` +
    `• عرض التقرير النصي الكامل\n` +
    `• تعديل سجل جلسة مؤرشفة`,
  historyShowReportButton: '📄 عرض التقرير',
  historyEditSessionsButton: '✏️ تعديل السجلات',
  historyReportSent: '✅ تم إرسال التقرير',
  reportGenerated: '✅ تم إنشاء التقرير',
  historyTypeTitle: {
    main: '📘 حلقات المسجلات الأساسية',
    training: '🎓 حلقات التدريب',
    open: '📗 حلقات التسجيل العام',
    registeredSecondary: '🧾 حلقات تصحيح التلاوة',
    personalRecitation: '📄 حلقات التلاوة الفردية',
    groupRecitation: '📖 حلقات التلاوة الجماعية',
    other: '🗂️ أخرى',
  },
  historyEditSessionsText: (series, count, page, totalPages) =>
    `✏️ *تعديل سجلات الدورة ${series}*\n` +
    `عدد السجلات: ${count}\n` +
    `📄 صفحة ${page}/${totalPages}\n\n` +
    `اختاري اسم الجلسة لفتح لوحة التعديل.`,
  historyEditTypesText: (series, count) =>
    `✏️ *تعديل سجلات الدورة ${series}*\n` +
    `عدد السجلات: ${count}\n\n` +
    `اختاري نوع الحلقة لعرض جلساتها.`,
  historySessionEditorHeader: (recordIndex) => `✏️ *تعديل السجل #${recordIndex}*`,
  historySessionEditorEmpty: '— لا توجد أسماء داخل هذا السجل —',
  historyBackToSessionsButton: '↩️ الجلسات',
  historyBackToHomeButton: '🏠 القائمة',
  historyReportButton: '📋 طباعة التقرير',
  historyEditTitleButton: '✏️ تعديل العنوان',
  historyEditVersesButton: '🧾 تعديل الآيات',
  historyStatusButtons: {
    present: '✅ حاضرة',
    listening: '👂 مستمعة',
    excused: '🔔 معتذرة',
    absent: '❌ غائبة',
    pending: '⏳ بدون حالة',
  },
  historyEditMemberStatusText: (name, statusLabel) =>
    `✏️ *تعديل حالة العضوة*\n\n${name}\nالحالة الحالية: ${statusLabel}\n\nاختاري الحالة الجديدة:`,
  historyReciteMainButtons: {
    attended: '✅ حضرت الأساسية',
    notAttended: '📝 لم تحضر الأساسية',
  },
  historyReciteBackupButtons: {
    on: '⏳ احتياطي',
    off: '📋 أساسي',
  },
  historyReciteFlagsText: (mainLabel, backupLabel) =>
    `الحلقة الأساسية: ${mainLabel}\nنوع التسجيل: ${backupLabel}`,
  historyReciteMainUnset: '— غير محدد —',
  historyVerseListHeader: (recordIndex) => `🧾 *تعديل آيات السجل #${recordIndex}*`,
  historyVerseListHint: 'اختاري طالبة لتعديل آيتها. (الحاضرات والمستمعات فقط)',
  historyVerseListEmpty: '— لا توجد طالبات حاضرات أو مستمعات في هذا السجل —',
  historyStatusUpdated: (name, statusLabel) => `✅ ${name} ← ${statusLabel}`,
  historyEditTitlePrompt: (currentName) => `✏️ أرسلي العنوان الجديد للجلسة بدلاً من *${currentName}*:`,
  historyTitleEdited: (oldName, newName) => `✅ تم تعديل عنوان الجلسة: *${oldName}* ← *${newName}*`,
  recordsHeader: (s, n) => `🗂️ سجلات الدورة ${s} (${n})`,
  recordsLine: (i, s) => `#${i} | ${s.name} | ${new Date(s.endedAt || s.startedAt).toLocaleDateString('ar-EG', { timeZone: 'Africa/Cairo' })}`,
  invalidRecordIndex: '⚠️ رقم السجل غير صالح. استخدمي /classhistory لمعرفة الأرقام.',
  invalidSeriesNumber: '⚠️ رقم الدورة غير صالح. استخدمي رقماً أكبر من صفر.',
  invalidRemoveMemberRecordFormat: '⚠️ الصيغة الصحيحة:\n/removestudentrecord [رقم السجل] | [اسم العضوة]',
  recordNotFoundForEdit: '⚠️ تعذر العثور على السجل المطلوب للتعديل. أعيدي طلب /classhistory ثم حاولي مرة أخرى.',
  invalidSortNamesFormat: '⚠️ الصيغة الصحيحة:\n/sortnames اسم1 | اسم2 | اسم3\nويمكن أيضاً استخدام الفاصلة , أو كل اسم في سطر، مع دعم الترقيم مثل 1- اسم.\n\nيمكن بدء السطر بـ add وسيتم تجاهلها:\n/sortnames add اسم1 | اسم2\n\nللتجميع عبر عدة رسائل:\n/sortnames start ثم /sortnames add ... ثم /sortnames done\nوللإلغاء: /sortnames cancel',
  recordMemberNotFound: (name) => `⚠️ لا يوجد سجل للعضوة *${name}* داخل السجل المحدد.`,
  closeSeriesNeedsNoActiveSession: '⚠️ لا يمكن إغلاق الدورة أثناء وجود قائمة نشطة. أنهِ القائمة أولاً بـ /stoplist.',
  closeSeriesConfirmAction: (current) => `إغلاق الدورة الحالية ${current} وبدء دورة جديدة`,
  closeSeriesDone: (from, to) => `✅ تم إغلاق الدورة ${from} وبدء دورة ${to}.`,
  removeRecordConfirmAction: (index) => `حذف السجل #${index}`,
  removeMemberRecordConfirmAction: (name, index) => `حذف سجل ${name} من السجل #${index}`,
  recordDeleted: (i) => `✅ تم حذف السجل #${i}.`,
  memberRecordDeleted: (name, i) => `✅ تم حذف سجل العضوة *${name}* من السجل #${i}.`,
  confirmPrompt: (action) => `⚠️ *تأكيد مطلوب*\n${action}\n\nاضغطي زر التأكيد أدناه.`,
  confirmNotFound: '⚠️ لا يوجد إجراء بانتظار التأكيد.',
  confirmExpired: '⚠️ انتهت صلاحية التأكيد. أعيدي تنفيذ الأمر.',
  confirmNotOwner: '⛔ لا يمكنك تأكيد إجراء طلبه مشرف آخر.',
  confirmCancelled: '✅ تم إلغاء الإجراء.',
  confirmButton: '✅ تأكيد التنفيذ',
  cancelButton: '↩️ إلغاء',
  hiddenManageList: '✅ تم إخفاء لوحة التعديل.',
  sortedNamesHeader: (n) => `🔤 الأسماء بعد الترتيب (${n}):`,
  sortedNamesContinue: '🔤 متابعة الأسماء المرتبة:',
  sortnamesStartCollect: '📝 بدأ تجميع الأسماء للترتيب.\nأرسلي الدفعة التالية باستخدام /sortnames add ...\nوعند الانتهاء: /sortnames done\nوللإلغاء: /sortnames cancel',
  sortnamesNoPendingCollect: '⚠️ لا يوجد تجميع نشط حالياً. ابدئي بـ /sortnames start',
  sortnamesCollectCancelled: '✅ تم إلغاء تجميع الأسماء.',
  sortnamesEmptyChunk: '⚠️ لم يتم العثور على أسماء في هذه الدفعة.',
  sortnamesChunkAdded: (added, total) => `✅ تمت إضافة ${added} اسم/أسماء. المجموع الحالي: ${total}.`,
  emptyMembers: '📋 *القائمة فارغة*\nاستخدم الزر أدناه لإضافة أعضاء.',
  addMemberButton: '➕ إضافة عضوة جديد',
  addTrainingGroupButton: '🏷️ إدارة مجموعات التدريب',
  refreshButton: '🔄 تحديث',
  editListButton: '✏️ تعديل الحضور',
  // "Stop list" freezes registration (same behaviour as /freezelist); "stop
  // session" ends the session entirely (the former single إنهاء القائمة button).
  freezeListButton: '⏸️ إيقاف القائمة',
  stopSessionButton: '🛑 إنهاء الجلسة',
  backButton: '↩️ رجوع',
  deleteButton: '🗑️ حذف',
  renameButton: '✏️ تعديل الاسم',
  assignTrainingButton: '🏷️ ربط تدريب',
  unassignTrainingButton: '🧹 إلغاء ربط التدريب',
  closeButton: '✕ إغلاق',
  sendConfirmationButton: '📨 إرسال تأكيد القبول',
  confirmationSent: '✅ تم إرسال التأكيد',
  noMembersToConfirm: 'لا توجد طالبات مسجلات.',
  allMembersAlreadyConfirmed: '✅ تم إرسال التأكيد لجميع الطالبات مسبقًا.',
  addMemberError: '❌ حدث خطأ أثناء إضافة الطالبة',
  addStudentButton: (name) => `➕ ${name}`,
  addTeacherButton: '👩‍🏫 إضافة كمعلمة',
  dismissStudentButton: '🗑️ تجاهل',
  confirmDismissButton: '✅ تأكيد التجاهل',
  tagPendingButton: '📢 تنبيه المعلقين',
  navigationPrevButton: '⬅️',
  navigationNextButton: '➡️',
  pendingPageHeader: (page, totalPages) => `📄 صفحة ${page}/${totalPages}`,
  teacherTypeLabel: {
    courseteacher: '👩‍🏫 معلمة الحلقة',
    trainingteacher: '📝 معلمة التدريب',
    recitationteacher: '🎙️ معلمة التلاوة',
  },
  noNameFallback: 'بدون اسم',
  noSessionShort: '⚠️ لا توجد قائمة.',
  refreshed: '✅ تم التحديث',
  refreshedWithChanges: (added, removed) => `✅ تم التحديث (${added} مضافة، ${removed} محذوفة)`,
  sessionClosingDua: `جزاكن الله خيراً يا غاليات، وبارك في هذا المجلس.\n\n` +
    `نسأل الله أن يتقبل منكن، وأن يجعل ما حضرتن وسمعتن في ميزان حسناتكن، وأن يرزقنا وإياكن الإخلاص والقبول.\n\n` +
    `*كفارة المجلس:*\n` +
    `سبحانك اللهم وبحمدك، أشهد أن لا إله إلا أنت، أستغفرك وأتوب إليك.`,
  registeredSelf: (a) => `✅ تمت إضافتك وتسجيلك كـ "${a}"`,
  reciteConfirmButton: '✅ حضرتُ الحلقة الأساسية وأُسجّل',
  reciteConfirmNoMainButton: '📝 لم أحضر الحلقة الأساسية وأُسجّل',
  // Backup (reserve) registration buttons, shown only when the recitation list is
  // frozen so late students can still sign up in case a slot opens.
  reciteBackupButton: '✅ حضرتُ الأساسية — تسجيل احتياطي',
  reciteBackupNoMainButton: '📝 لم أحضر الأساسية — تسجيل احتياطي',
  // Short tag appended to a student's line in the recitation list when she
  // registered while declaring she did NOT attend the main session.
  reciteNoMainTag: '⚠️ لم تحضر الأساسية',
  // Sub-header rendered above the reserve (backup) sign-ups, which are listed as
  // their own section below the main recitation queue.
  reciteBackupSectionHeader: '⏳ *الاحتياط (عند توفّر مكان):*',
  // Decorative frame for the live recitation-correction (registeredSecondary) list.
  // The list messages are sent with Markdown parse mode, so single-* bold is safe.
  // The divider is prefixed with an RLM (U+200F) so it anchors flush-right with the
  // surrounding RTL text instead of drifting to the left edge.
  reciteListRlmDivider: '\u200F🔸〰️🔸〰️🔸〰️🔸〰️🔸〰️🔸',

  reciteListHeader: (name) =>
    `✨🕊️ *بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ* 🕊️✨\n\n` +
    `🌸🤍 *أهلاً بكنّ يا فَرَاشَاتِ الْقُرْآنِ وَمَنَابِيعَ النُّورِ* 🤍🌸\n\n` +
    `السلام عليكم ورحمة الله وبركاته حبيباتي الغاليات في حلقة "${name}" 📖✨\n\n` +
    `يقول الله تعالى: ﴿وَرَتِّلِ الْقُرْآنَ تَرْتِيلًا﴾، وهنيئاً لقلوبكنّ التي اختارها الله لتُرتّل آياتِه 🌿 الجهدُ الذي تبذلْنَه في الحفظِ والتكرارِ رِفعةٌ لكنّ في الدارَين، ونورٌ يسعى بين أيديكنّ يومَ القيامةِ بإذن الله 👑\n\n` +
    `🌟 قَافِلَةُ مُضِيئَاتِ التِّلاوة 🌟`,
  reciteListFooterDecor:
    `بانتظارِ همّتِكنّ العاليةِ يا صاحباتِ الهِمم، جعل اللهُ القرآنَ العظيمَ ربيعَ قلوبكنّ 🤲🌿\n\n`,
  reciteAttestationFooter:
    `📿 للتسجيل في تصحيح التلاوة، بالضغط على الزر المناسب فإنكِ تُؤكِّدين:\n` +
    RECITE_COMMON_POINTS.join('\n') +
    `\n\nثم اختاري ما ينطبق عليكِ:\n` +
    `✅ إذا حضرتِ الحلقة الأساسية مع المعلمه نهى عيد.\n` +
    `📝 إذا لم تحضري الحلقة الأساسية هذا الأسبوع.`,
  // Footer shown when the recitation list is frozen: primary registration is over
  // but a reserve (backup) spot can still be requested via the two buttons.
  reciteBackupFooter:
    `⛔ انتهى التسجيل الأساسي. يمكنكِ التسجيل كاحتياطي (عند توفّر مكان) بالضغط على الزر المناسب، وبذلك تُؤكِّدين:\n` +
    RECITE_COMMON_POINTS.join('\n') +
    `\n\nثم اختاري ما ينطبق عليكِ:\n` +
    `✅ إذا حضرتِ الحلقة الأساسية مع المعلمه نهى عيد.\n` +
    `📝 إذا لم تحضري الحلقة الأساسية هذا الأسبوع.`,
  // Blocking popup shown right after a student self-registers, so she can't miss
  // that her tap affirmed the attestations (footer text is easy to skip).
  reciteAttestationAlert:
    `✅ تم تسجيلكِ.\nبتسجيلكِ أكّدتِ:\n${RECITE_MAIN_YES_LINE}\n` +
    RECITE_COMMON_POINTS.join('\n'),
  reciteAttestationNoMainAlert:
    `✅ تم تسجيلكِ.\nبتسجيلكِ أكّدتِ:\n${RECITE_MAIN_NO_LINE}\n` +
    RECITE_COMMON_POINTS.join('\n'),
  // Backup-registration variants of the confirmation popup: they make clear she is
  // on the reserve list (not guaranteed a slot) while restating what she affirmed.
  reciteBackupAlert:
    `⏳ سُجّلتِ كاحتياطي (عند توفّر مكان).\nأكّدتِ:\n${RECITE_MAIN_YES_LINE}\n` +
    RECITE_COMMON_POINTS.join('\n'),
  reciteBackupNoMainAlert:
    `⏳ سُجّلتِ كاحتياطي (عند توفّر مكان).\nأكّدتِ:\n${RECITE_MAIN_NO_LINE}\n` +
    RECITE_COMMON_POINTS.join('\n'),
  // Shown when a student who already secured a primary slot taps a reserve button:
  // her guaranteed spot outranks the reserve list, so the tap is a no-op.
  reciteBackupAlreadyRegisteredAlert:
    '✅ أنتِ مسجّلة بالفعل في القائمة الأساسية، ولا حاجة للتسجيل كاحتياطي.',
  membersHeader: (n) => `👥 *قائمة الأعضاء (${n}):*\n\n`,
  manageHeader: (name) => `⚙️ *إدارة الحضور – ${name}*\n\nانقر على عضو لتعديل حالته أو علّم أنه تم النداء عليه:\n\n`,
  memberOptionsHeader: (name) => `🔧 *إدارة العضو:*\n${name}`,
  managePickHeader: (name, e, called, showCall = true) => showCall
    ? `⚙️ *تعديل حالة:* ${name}\nالحالة الحالية: ${e}\nحالة النداء: ${called === 'responding' ? '👉 جاري الرد' : called === 'responded' ? '✅ حاضرة' : called === 'away' ? '📣 كان بعيداً عن الميكروفون' : ''}\n\nاختر الحالة الجديدة أو حالة النداء:`
    : `⚙️ *تعديل حالة:* ${name}\nالحالة الحالية: ${e}\n\nاختر الحالة الجديدة:`,
  renamePrompt: (name) => `✏️ اكتب الاسم الجديد بدلاً من *${name}*:`,
  myIdInfo: '🪪 حياكِ الله، هذا رقم حسابك في تيليغرام. أرسلي السطر التالي للمشرفة لتضيفك بسهولة:',
  groupIdPrivateChat: '⚠️ استخدمي هذا الأمر داخل المجموعة التي تريدين معرفة رقمها يا غالية.',
  groupIdInfo: (groupId) => `🆔 *رقم هذه المجموعة:*\n\`${groupId}\`\n\nانسخيه ثم أضيفيه في المجموعة الرئيسية عبر:\n\`/addtraininggroup ${groupId} | اسم المجموعة\``,
  registerWidgetText: `📢 *طلب الانضمام لقائمة المسجلات*\n\nالسلام عليكن ورحمة الله وبركاته يا غاليات.\n\nللتسجيل يكفي أن تضغطي الزر أدناه مرة واحدة فقط.\n\nبعدها يصل طلبك إلى المشرفات، ثم يراجعن الطلب ويقبلنه أو يؤجلنه.\n\nإذا ظهر لك أن الطلب تم إرساله، فانتظري فقط ولا تحتاجين أي خطوة أخرى.`,
  registerWidgetButton: '📝 طلب التسجيل',
  registerWidgetCloseButton: '✕ إغلاق التسجيل',
  registerWidgetClosed: '✅ تم إغلاق رسالة التسجيل.',
  registerInGroupOnly: '⚠️ هذا الزر يعمل داخل المجموعة فقط يا غالية.',
  registerRequestSubmitted: '✅ تم إرسال طلب التسجيل بنجاح. انتظري مراجعة المشرفة، بارك الله فيكِ.',
  registerRequestUpdated: '✅ تم تحديث طلبك بنجاح، جزاكِ الله خيراً.',
  registerRequestAlreadyMember: 'ℹ️ أنتِ مسجّلة بالفعل في القائمة، حياكِ الله.',
  statusNoSession: (groupId, n) => `📊 لا توجد قائمة نشطة حالياً.\n🆔 معرّف المجموعة: \`${groupId}\`\nالأعضاء المسجّلون: ${n}`,
  statusReport: (c, total) => `📊 *قائمة: ${c.name}*\n✅ حاضرة: ${c.present}\n👂 مستمعة: ${c.listening}\n🔔 معتذرة: ${c.excused}\n⏳ لم تسجّل: ${c.pending}\n👥 الإجمالي: ${total}`,
  memberExists: (name) => `ℹ️ *${name}* موجود بالفعل.`,
  userIdLinked: (id) => `⚠️ المعرّف ${id} مرتبط بالفعل بعضو آخر.`,
  memberAdded: (name, id) => `✅ تمت إضافة *${name}* (معرّف: ${id}).`,
  memberAdmittedConfirmation: (name) => `✅ *تم قبول طلبك يا ${name}*\n\nأهلاً وسهلاً بكِ في مجموعتنا، حفظكِ الله وجزاكِ خيراً.\n\nنسأل الله تعالى أن:\n• يجعل تعلّمك في هذه المجموعة نوراً يضيء طريقك\n• يبارك في وقتك وعلمك وسعيك\n• يجعل ما تتعلمينه حجة لك لا عليك\n• يجمعنا على خيرٍ وطاعة لله\n\nبارك الله فيكِ وكتب لكِ النفع والبركة 🌙`,
  memberAdmittedConfirmationBatch: `أهلاً وسهلاً بكِ في مجموعتنا، حفظكِ الله وجزاكِ خيراً.\n\nنسأل الله تعالى أن:\n• يجعل تعلّمك في هذه المجموعة نوراً يضيء طريقك\n• يبارك في وقتك وعلمك وسعيك\n• يجعل ما تتعلمينه حجة لك لا عليك\n• يجمعنا على خيرٍ وطاعة لله\n\nبارك الله فيكِ وكتب لكِ النفع والبركة 🌙`,
  batchConfirmationHeader: '✅ *تم قبولكِ في مجموعتنا*',
  batchConfirmationAlert: (count) => `✅ تم إرسال التأكيد ل ${count} طالبة في المجموعة`,
  tagPendingNotice: (mentions) => `📢 ${mentions}\n\nحياكن الله يا غاليات، نذكركن بتحسين أسماؤكن في تيليغرام حتى تتمكن المشرفة من التعرف عليكن بسهولة وقبول طلباتكن.\n\nنسأل الله أن يسهل الأمور ويجعلكن من طالبات العلم الصالحات الراغبات في رضا الله تعالى. 🤍`,
  memberNotInList: (name) => `⚠️ *${name}* غير موجود في القائمة.`,
  memberDeleted: (name) => `✅ تم حذف *${name}*.`,
  memberDeletedShort: (name) => `✅ تم حذف ${name}`,
  oldNameNotFound: (name) => `⚠️ *${name}* غير موجود.`,
  nameTaken: (name) => `⚠️ الاسم *${name}* مستخدم بالفعل.`,
  memberRenamed: (oldName, newName) => `✅ تم التعديل: *${oldName}* ← *${newName}*`,
  memberGone: (name) => `⚠️ العضو *${name}* لم يعد موجوداً.`,
  trainingStudentNotFoundInSource: (selector) => `⚠️ لم يتم العثور على طالبة في المجموعة الحالية بالقيمة: *${selector}*.`,
  trainingStudentAlreadyAssigned: (name) => `ℹ️ الطالبة *${name}* مضافة مسبقاً في مجموعة التدريب.`,
  trainingStudentNotFoundInTraining: (selector) => `⚠️ لا توجد طالبة في مجموعة التدريب بهذه القيمة: *${selector}*.`,
  assignTrainingGroupPrompt: (name) => `🏷️ لاختيار مجموعة تدريب للطالبة *${name}*، اضغطي على المجموعة المناسبة من الأزرار أدناه.`,
  unassignTrainingGroupPrompt: (name) => `🧹 الطالبة *${name}* مرتبطة حالياً بمجموعة تدريب.\nاضغطي الزر أدناه لإلغاء الربط.`,
  trainingGroupsHeader: (count) => `🏷️ *مجموعات التدريب (${count})*`,
  trainingGroupsEmpty: '⚠️ لا توجد مجموعات تدريب مضافة بعد.\nأضيفي أولاً عبر /addtraininggroup [رقم المجموعة] | [اسم المجموعة].',
  trainingGroupAdded: (name, groupId) => `✅ تمت إضافة مجموعة التدريب *${name}* (\`${groupId}\`).`,
  trainingGroupRemoved: (name, groupId) => `✅ تم حذف مجموعة التدريب *${name}* (\`${groupId}\`).`,
  trainingGroupNotFound: (groupId) => `⚠️ لا توجد مجموعة تدريب بهذا الرقم: \`${groupId}\`.`,
  trainingAssignedFromWidget: (name, groupId) => `✅ تم ربط *${name}* بمجموعة التدريب \`${groupId}\` بنجاح.`,
  trainingUnassignedFromWidget: (name, groupId) => `✅ تم إلغاء ربط *${name}* من مجموعة التدريب \`${groupId}\`.`,
  trainingStudentsListHeader: (groupId, count) => `👥 *طالبات مجموعة التدريب (${count})*\nالمجموعة: \`${groupId}\``,
  pendingStudentsHeader: (count) => `📝 *طلبات التسجيل المعلّقة (${count}):*`,
  pendingStudentsEmpty: '📝 لا توجد طلبات تسجيل معلّقة حالياً.',
  pendingStudentNotFound: '⚠️ طلب التسجيل هذا لم يعد موجوداً.',
  pendingStudentDismissConfirm: (name) => `⚠️ تأكيد تجاهل طلب *${name}*.`,
  pendingStudentDismissed: (name) => `🗑️ تم تجاهل طلب *${name}*.`,
  pendingStudentAddedAsTeacher: (name, label) => `✅ تمت إضافة *${name}* كـ ${label}.`,
  pendingStudentNameTaken: (name) => `⚠️ يوجد طلب معلّق آخر بالاسم *${name}*.`,
  pendingStudentRenamed: (oldName, newName) => `✏️ تم تعديل الاسم: *${oldName}* ← *${newName}*.`,
  pendingRegistrationRenamePrompt: (name) => `✏️ أرسلي الاسم الجديد لطلب التسجيل الخاص بـ *${name}* بالرد على هذه الرسالة.`,
  noStudentsToRemove: 'ℹ️ لا توجد طالبات مسجلات لحذفهن.',
  allStudentsRemoved: (count) => `✅ تم حذف جميع الطالبات المسجلات (${count}).`,
  registeredAs: (a) => `✅ تم تسجيلك كـ "${a}"، بارك الله فيكِ`,
  statusSet: (name, a) => `✅ ${name} ← ${a}`,
  sessionListTruncated: (n) => `… وتم إخفاء ${n} اسم/أسماء لتجاوز حد الرسالة.`,
  inlinePromptAdd: '📝 اكتبي طالبة واحدة أو أكثر بهذا الشكل (بالرد على هذه الرسالة):\n[رقم الحساب في تيليغرام] | [الاسم]\n\nأمثلة:\n123456789 | أحمد محمد\n987654321 | فاطمة علي\n\nيمكنك الفصل بسطر جديد أو فاصلة.',
  inlineInvalidAddFormat: '⚠️ اكتبي البيانات بهذا الشكل:\n[رقم الحساب في تيليغرام] | [الاسم]\n\nأمثلة:\n123456789 | أحمد محمد\n987654321 | فاطمة علي\n\nيمكنك الفصل بسطر جديد أو فاصلة.',
  replyToPromptOnly: '↩️ فضلاً اكتبي الرد على نفس الرسالة المطلوبة حتى يصل بشكل صحيح.',
  addGuestPrompt: '📝 اكتب اسم الضيفة لإضافتها إلى هذه القائمة:',
  guestExistsInSession: (name) => `⚠️ الاسم *${name}* موجود بالفعل في هذه القائمة.`,
  guestAddedToSession: (name) => `✅ تمت إضافة الضيفة *${name}* إلى القائمة الحالية.`,
  editPagePrompt: (name) => `📄 أدخلي رقم الصفحة أو نطاق الصفحات لـ *${name}* (1-604):\nأمثلة: 5 أو 3-5 أو 2,4,6`,
  invalidPageNumber: '⚠️ أدخل رقماً واحداً (3)، نطاقاً (3-5)، أو قائمة (2,4,6). جميع الأرقام يجب أن تكون بين 1 و 604.',
  pageEditedSuccess: (name, page) => `✅ تم تعديل صفحة *${name}* إلى ${page}.`,
  editVersePrompt: (name) => `🧾 أدخلي رقم الآية أو المقطع لـ *${name}*:\nأمثلة: 12 أو 12-18 أو البقرة 1-5`,
  invalidVerseInput: '⚠️ أدخلي بيانات آية صحيحة (<اسم السورة> <رقم الآية>-<رقم الآية>).',
  verseEditedSuccess: (name, verse) => `✅ تم تعديل آية *${name}* إلى: ${verse}.`,
  invalidStartGroupRecitationFormat: '⚠️ مثال: /startgrouprecitation جلسة التلاوة الجماعية',
  editSessionNamePrompt: (currentName) => `✏️ أرسلي اسم القائمة الجديد بدلاً من *${currentName}*:`,
  sessionNameEdited: (oldName, newName) => `✅ تم تعديل اسم القائمة: *${oldName}* ← *${newName}*`,
  emptyTeachers: '📋 لا توجد معلمات مضافة بعد.',
  invalidAddTeacherFormat: '⚠️ الطريقة الصحيحة (كل معلمة في سطر):\n/addteacher [رقم الحساب] | [الاسم] | [النوع]\nالأنواع: courseteacher | trainingteacher | recitationteacher\nمثال:\n123456789 | أحمد محمد | courseteacher',
  invalidAddTeacherReplyFormat: '⚠️ لاستخدام هذا الأمر: اكتبي /addteacherreply [النوع] بالرد على رسالة المعلمة داخل المجموعة.\nمثال: /addteacherreply recitationteacher',
  invalidAddTeacherReplyTarget: '⚠️ لا يمكن إضافة حساب البوت كمعلمة.',
  invalidRemoveTeacherFormat: '⚠️ الصيغة الصحيحة (معلمة واحدة أو أكثر):\n/removeteacher [الاسم]\nأمثلة:\nأحمد محمد\nفاطمة علي',
  invalidAssignTeacherFormat: '⚠️ الصيغة الصحيحة (سطر لكل معلمة):\n/assignteacher [الاسم] | [النوع]\nالأنواع: courseteacher | trainingteacher | recitationteacher\nمثال:\nأحمد محمد | trainingteacher',
  invalidTeacherType: '⚠️ النوع غير صحيح. الأنواع المتاحة: courseteacher | trainingteacher | recitationteacher',
  teacherNameTaken: (name) => `⚠️ يوجد معلمة باسم "${name}" بالفعل.`,
  teacherUserIdTaken: (id) => `⚠️ رقم الحساب ${id} مضاف بالفعل لمعلمة أخرى.`,
  teacherNotFound: (name) => `⚠️ لم يُعثر على معلمة باسم "${name}".`,
  teacherAdded: (name, label) => `✅ تمت إضافة *${name}* كـ ${label}.`,
  teacherRemoved: (name) => `✅ تم حذف المعلمة *${name}*.`,
  teacherAssigned: (name, label) => `✅ تم تحديث نوع *${name}* إلى ${label}.`,
  invalidTagTeacherFormat: '⚠️ الصيغة الصحيحة: /tagteachers [نوع]\nالأنواع المتاحة: courseteacher | trainingteacher | recitationteacher',
  noTeachersOfType: (label) => `⚠️ لا توجد معلمات من نوع ${label}.`,
  groupRecitationJoinPrompt: '_سجّلي حضورك لتحصلي على صفحتكِ من التلاوة الجماعية:_',
  pageAssignedGroupRecitation: (name, page) => `✅ ${name} — صفحة ${page}`,
  groupRecitationReport: (session, opts = {}) => {
    // Group rostered members by attendance status; walk-in guests are split into
    // their own section (see GUESTS_TITLE) so they never inflate the roll.
    const groups = { present: [], listening: [], excused: [] };
    const guests = [];
    for (const p of participants.list(session)) {
      if (p.page === undefined) continue;
      const status = p.status || 'listening';
      if (p.isGuest) { guests.push([p.name, p.page, status]); continue; }
      if (status === 'present') groups.present.push([p.name, p.page]);
      else if (status === 'listening') groups.listening.push([p.name, p.page]);
      else if (status === 'excused') groups.excused.push([p.name, p.page]);
    }
    
    // Sort each group by page, then alphabetically by name
    sortByPageThenName(groups);
    guests.sort((a, b) => (getFirstPage(a[1]) - getFirstPage(b[1])) || compareArabic(a[0], b[0]));
    
    const totalCount = groups.present.length + groups.listening.length + groups.excused.length + guests.length;
    if (!totalCount) return `📖 *تقرير التلاوة الجماعية "${session.name}":*\n\nلم يُسجّل أحد.`;
    
    let r = `📖 *تقرير التلاوة الجماعية "${session.name}" (${totalCount} طالبة):*\n\n`;
    
    if (groups.present.length) {
      r += `✅ *قراءة (${groups.present.length}):*\n`;
      r += groups.present.map(([name, page]) => `📄 ${formatPages(page)} — ${participants.label(session, name)}`).join('\n');
      r += '\n\n';
    }
    
    if (groups.listening.length) {
      r += `👂 *مستمعة (${groups.listening.length}):*\n`;
      r += groups.listening.map(([name, page]) => `📄 ${formatPages(page)} — ${participants.label(session, name)}`).join('\n');
      r += '\n\n';
    }
    
    if (groups.excused.length) {
      r += `🔔 *معتذرة (${groups.excused.length}):*\n`;
      r += groups.excused.map(([name]) => `${participants.label(session, name)}`).join('\n');
      r += '\n\n';
    }
    
    if (guests.length) {
      r += `👥 *${GUESTS_TITLE} (${guests.length}):*\n`;
      r += guests.map(([name, page, status]) => `${st(status).e} 📄 ${formatPages(page)} — ${participants.label(session, name)}${pendingSuffix(name, opts)}`).join('\n');
    }
    
    return r.trimEnd();
  },
  report: (session, groups, opts = {}) => {
    const rosterOnly = (arr) => sortByListNumber(session, arr.filter((n) => !isGuestName(session, n)));
    const labelLines = (arr) => arr.map((n) => participants.label(session, n)).join('\n');

    const present = rosterOnly(groups.present);
    const listening = rosterOnly(groups.listening);
    const excused = rosterOnly(groups.excused);
    const absent = rosterOnly(groups.absent);
    // Guests can appear under any live status but are never counted as absent.
    const guests = sortNamesAlphabetically(
      [...groups.present, ...groups.listening, ...groups.excused].filter((n) => isGuestName(session, n)),
    );

    const sections = [`📊 *تقرير قائمة "${session.name}":*`];
    if (present.length) sections.push(`✅ *حاضرة (${present.length}):*\n${labelLines(present)}`);
    if (listening.length) sections.push(`👂 *مستمعة فقط (${listening.length}):*\n${labelLines(listening)}`);
    if (excused.length) sections.push(`🔔 *معتذرة (${excused.length}):*\n${labelLines(excused)}`);
    // Absent is reported only for admin-authorized (roster-attendance) lists.
    if (requiresRegistrationApproval(session.type) && absent.length) sections.push(`❌ *غياب (${absent.length}):*\n${labelLines(absent)}`);
    if (guests.length) {
      const lines = guests.map((n) => `${st(participants.getStatus(session, n)).e} ${participants.label(session, n)}${pendingSuffix(n, opts)}`).join('\n');
      sections.push(`👥 *${GUESTS_TITLE} (${guests.length}):*\n${lines}`);
    }
    return sections.join('\n\n');
  },
  secondaryReport: (session, opts = {}) => {
    // participants.list() is already ordered by registration time; keep that
    // order so the report mirrors the live recitation queue.
    const present = participants.list(session).filter((p) => p.status === 'present');
    const roster = present.filter((p) => !p.isGuest);
    const guests = present.filter((p) => p.isGuest);

    if (!present.length) {
      return `🧾 *تقرير حلقة تصحيح التلاوة "${session.name}":*\n\nلا توجد طالبات حاضرات.`;
    }

    const sections = [`🧾 *تقرير حلقة تصحيح التلاوة "${session.name}" (${present.length} طالبة):*`];
    if (roster.length) {
      const lines = roster.map((p) => `${participants.label(session, p.name)} — ${p.verse || '—'}`).join('\n');
      sections.push(`✅ *حاضرات:*\n${lines}`);
    }
    if (guests.length) {
      const lines = guests.map((p) => `${participants.label(session, p.name)} — ${p.verse || '—'}${pendingSuffix(p.name, opts)}`).join('\n');
      sections.push(`👥 *${GUESTS_TITLE} (${guests.length}):*\n${lines}`);
    }
    return sections.join('\n\n');
  },
  pageListReport: (session, opts = {}) => {
    // Group rostered members by attendance status; walk-in guests are split into
    // their own section (see GUESTS_TITLE) so they never inflate the roll.
    const groups = { present: [], listening: [], excused: [] };
    const guests = [];
    for (const p of participants.list(session)) {
      if (p.page === undefined) continue;
      const status = p.status || 'listening';
      if (p.isGuest) { guests.push([p.name, p.page, status]); continue; }
      if (status === 'present') groups.present.push([p.name, p.page]);
      else if (status === 'listening') groups.listening.push([p.name, p.page]);
      else if (status === 'excused') groups.excused.push([p.name, p.page]);
    }
    
    // Sort each group by page, then alphabetically by name
    sortByPageThenName(groups);
    guests.sort((a, b) => (getFirstPage(a[1]) - getFirstPage(b[1])) || compareArabic(a[0], b[0]));
    
    const totalCount = groups.present.length + groups.listening.length + groups.excused.length + guests.length;
    if (!totalCount) return `📖 *تقرير قائمة "${session.name}":*\n\nلم يُسجّل أحد.`;
    
    let r = `📖 *تقرير قائمة "${session.name}" (${totalCount} طالبة):*\n\n`;
    
    if (groups.present.length) {
      r += `✅ *قراءة (${groups.present.length}):*\n`;
      r += groups.present.map(([name, page]) => `📄 ${formatPages(page)} — ${participants.label(session, name)}`).join('\n');
      r += '\n\n';
    }
    
    if (groups.listening.length) {
      r += `👂 *مستمعة (${groups.listening.length}):*\n`;
      r += groups.listening.map(([name, page]) => `📄 ${formatPages(page)} — ${participants.label(session, name)}`).join('\n');
      r += '\n\n';
    }
    
    if (groups.excused.length) {
      r += `🔔 *معتذرة (${groups.excused.length}):*\n`;
      r += groups.excused.map(([name]) => `${participants.label(session, name)}`).join('\n');
      r += '\n\n';
    }
    
    if (guests.length) {
      r += `👥 *${GUESTS_TITLE} (${guests.length}):*\n`;
      r += guests.map(([name, page, status]) => `${st(status).e} 📄 ${formatPages(page)} — ${participants.label(session, name)}${pendingSuffix(name, opts)}`).join('\n');
    }
    
    return r.trimEnd();
  },
  help: (admin) =>
    `السلام عليكن ورحمة الله وبركاته 👋 *بوت الحضور*\n\n` +
    `*للأعضاء*\n` +
    `/help – عرض المساعدة\n` +
    `الأفضل: اضغطي زر "طلب التسجيل" الذي ترسله المشرفة داخل المجموعة\n` +
    `/myid – خيار احتياطي لعرض رقم حسابك للتسجيل اليدوي\n` +
    `` +
    (admin
      ? `\n\n*للمشرف*\n` +
        `\n*إدارة الحلقة*\n` +
        `/status – ملخص حالة المجموعة\n` +
        `/startlist [اسم] – بدء قائمة للحلقة الرئيسية للمسجلات\n` +
        `/starttraininglist [اسم] – بدء جلسة حضور في مجموعة التدريب (تستخدم القائمة الخاصة بالمجموعة)\n` +
        `/startopenlist [اسم] – بدء قائمة مفتوحة لأي طالبة\n` +
        `/startsecondarylist [اسم] – بدء قائمة تصحيح التلاوة: تسجيل ذاتي بإقرار حضور الحلقة الأساسية، ومع التجميد يُتاح تسجيل احتياطي\n` +
        `/startpersonalrecitation [اسم] – بدء ختمة فردية وتعيين صفحات تلقائياً\n` +
        `/startgrouprecitation [اسم] – بدء ختمة جماعية متسلسلة (صفحة واحدة لكل حاضرة)\n` +
        `/freezelist – تجميد تسجيل الحضور (في قوائم تصحيح التلاوة يبقى التسجيل الاحتياطي متاحاً)\n` +
        `/editlist – تعديل حالات الحضور بشكل فردي\n` +
        `/stoplist – إنهاء الجلسة\n` +
        `\n*إدارة الطالبات*\n` +
        `/students – إدارة قائمة طالبات المجموعة الخاصة (الطريقة الموصى بها)\n` +
        `/register – إرسال رسالة فيها زر "طلب التسجيل"\n` +
        `/pendingstudents – مراجعة طلبات التسجيل وقبولها أو تجاهلها (تشمل الضيوف الذين سجّلوا أنفسهم في قائمة حضور)\n` +
        `/addstudent [معرّف] | [اسم] – إضافة طالبة أو أكثر\n` +
        `/removestudent [اسم أو معرّف] – حذف احتياطي لطالبة أو أكثر\n` +
        `/listtrainingstudents [رقم المجموعة] – عرض طالبات مجموعة التدريب\n` +
        `/groupid – عرض رقم هذه المجموعة (استخدميه داخل مجموعة التدريب)\n` +
        `/addtraininggroup [رقم المجموعة] | [الاسم] – إضافة مجموعة تدريب للاختيار السريع\n` +
        `/removetraininggroup [رقم المجموعة] – حذف مجموعة تدريب من القائمة\n` +
        `/listtraininggroups – عرض مجموعات التدريب المضافة\n` +
        `/removestudents – حذف جميع الطالبات المسجلات (لمنشئ المجموعة، مع تأكيد)\n` +
        `/renamestudent [قديم] | [جديد] – تعديل اسم طالبة أو أكثر\n` +
        `/tagstudents – الإشارة إلى جميع الطالبات المسجلات\n` +
        `\n*إدارة المعلمات*\n` +
        `/addteacher [معرّف] | [اسم] | [نوع] – إضافة معلمة أو أكثر\n` +
        `/addteacherreply [نوع] – إضافة معلمة مباشرة بالرد على رسالتها داخل المجموعة\n` +
        `/assignteacher [اسم] | [نوع] – تغيير نوع معلمة أو أكثر\n` +
        `/listteachers – عرض قائمة المعلمات\n` +
        `/removeteacher [اسم] – حذف معلمة أو أكثر\n` +
        `/tagteachers [نوع] – الإشارة إلى المعلمات حسب النوع\n` +
        `\n*السجلات والدورات*\n` +
        `/classhistory [دورة] – عرض سجلات الدورة الحالية أو دورة محددة\n` +
        `/studentshistory [دورة] – تقرير لكل طالبة: حضور الحلقة الرئيسية + التدريب + آخر آية\n` +
        `/removeclassrecord [رقم] – حذف سجل حلقة من الدورة الحالية (بتأكيد، لمنشئ المجموعة)\n` +
        `/removestudentrecord [رقم] | [اسم] – حذف سجل طالبة من سجل في الدورة الحالية (بتأكيد، لمنشئ المجموعة)\n` +
        `/newclass – بدء دورة جديدة مع إبقاء الأرشيف السابق (لمنشئ المجموعة)\n` +
        `\n*أدوات إضافية*\n` +
        `/sortnames [أسماء] – ترتيب فوري (| أو , أو سطر جديد)\n` +
        `/sortnames start ثم add ثم done – تجميع وفرز عبر عدة رسائل\n` +
        `/feedback [رسالتك] – إرسال مشكلة أو اقتراح (بدون إظهار اسمك)\n`
      : ''),
  attendance: {
    present: { e: '✅', a: 'حاضرة' },
    listening: { e: '👂', a: 'مستمعة' },
    excused: { e: '🔔', a: 'معتذرة' },
    absent: { e: '❌', a: 'غياب بغير عذر' },
    pending: { e: '⏳', a: 'لم يُسجّل بعد' },
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
    addGuest: '➕ إضافة ضيفة',
    editPage: '📄 تعديل الصفحة',
    editVerse: '🧾 تعديل الآية',
    editSessionName: '✏️ تعديل اسم القائمة',
    hide: '🙈 إخفاء',
    markCalling: '👉 جاري الرد',
    markResponded: '✅ حاضرة',
    markAway: '📣 مبتعدة',
    clearCalled: '↩️ إلغاء علامة النداء',
    back: '↩️ رجوع',
  },
  historyHeader: (n) =>
    `📊 سجل الحضور (${n} جلسة)\n📅 ${new Date().toLocaleDateString('ar-EG', { timeZone: 'Africa/Cairo' })}`,
  historyLine: (name, main, training, verse = '—') => {
    const fmt = (t) => `✅ ${t.present} | 👂 ${t.listening} | 🔔 ${t.excused} | ❌ ${t.absent}`;
    const trainingLine = training?.groupName
      ? `\n  🏷️ *${training.groupName}:* ${fmt(training)}`
      : '';
    return `*${name}*\n  📘 الحلقة الرئيسية: ${fmt(main)}${trainingLine}\n  🧾 آخر آية: ${verse}`;
  },
  historyEmpty: 'لا توجد جلسات مؤرشفة بعد.',
  sessionHeader: (name) => `📚 *قائمة: ${name}*`,
  feedbackUsageHelp: `
📧 *إرسال ملاحظة أو مشكلة (بدون إظهار اسمك)*

*اكتبي بهذا الشكل:*
\`/feedback [رسالتك هنا]\`

*أمثلة واضحة:*
\`/feedback عند استخدام /editlist لا يتم حفظ الحالة\`
\`/feedback بعد /startlist لا تظهر أزرار الحضور\`

*لأفضل نتيجة:* اكتبي ماذا فعلتِ وماذا ظهر لكِ وما الذي كنتِ تتوقعينه.

✅ تُرسل الرسالة بدون اسمك ومع وقت الإرسال فقط
`.trim(),
  feedbackThankYou: '✅ شكراً! تم إرسال رسالتك بنجاح (مجهول الهوية)',
  feedbackError: '❌ حدث خطأ. يرجى المحاولة لاحقاً',
  contactNotConfigured: '⚠️ خدمة التواصل غير مفعّلة حالياً',
  offline: {
    chooserTitle: '🗂️ *الوضع دون اتصال*\n\nمن هنا يمكنكِ إدارة صفوفك وتسجيل الحضور بنفسك دون الحاجة لإضافة البوت إلى مجموعة.',
    myClassesButton: '👩‍🏫 صفوفي',
    newClassButton: '➕ صف جديد',
    myClassesTitle: '👩‍🏫 *صفوفي*',
    noClasses: '🤍 لا توجد صفوف بعد. أنشئي صفكِ الأول للبدء.',
    createPrompt: '✏️ اكتبي اسم الصف الجديد في رسالة الرد.',
    created: (name) => `✅ تم إنشاء الصف *${name}* بإذن الله.`,
    duplicate: '⚠️ لديكِ صف بهذا الاسم بالفعل.',
    invalidName: '⚠️ اسم الصف غير صالح. حاولي مرة أخرى.',
    notFound: '⚠️ لم يُعثر على هذا الصف.',
    classHome: (name) => `🗂️ *${name}*\n\nاختاري ما تريدين إدارته:`,
    rosterButton: '📋 الطالبات',
    sessionsButton: '🗂️ الجلسات',
    newSessionButton: '➕ جلسة جديدة',
    teachersButton: '👩‍🏫 المعلمات',
    reportButton: '📊 تقرير الصف',
    renameClassButton: '✏️ تعديل اسم الصف',
    rosterTitle: (name, count) => `📋 *طالبات ${name}* (${count})`,
    rosterEmpty: '🤍 لا توجد طالبات بعد. أضيفي أسماءهن للبدء.',
    addStudentsButton: '➕ إضافة طالبات',
    addStudentsPrompt: '✏️ اكتبي أسماء الطالبات، كل اسم في سطر، في رسالة الرد.',
    studentsAdded: (added, skipped) =>
      skipped > 0
        ? `✅ تمت إضافة ${added} طالبة (${skipped} مكررة تم تجاهلها).`
        : `✅ تمت إضافة ${added} طالبة.`,
    noStudentsAdded: '⚠️ لم تتم إضافة أي طالبة (ربما كانت الأسماء مكررة).',
    rosterManageHint: 'اضغطي على اسم الطالبة لتعديل اسمها أو حذفها.',
    studentMenuTitle: (name, listNumber) =>
      `👩‍🎓 *${name}*${listNumber != null ? ` (رقم ${listNumber})` : ''}\n\nماذا تريدين أن تفعلي؟`,
    renameStudentButton: '✏️ تعديل الاسم',
    removeStudentButton: '🗑️ حذف الطالبة',
    renameStudentPrompt: (old) => `✏️ اكتبي الاسم الجديد للطالبة *${old}* في رسالة الرد.`,
    studentRenamed: (name) => `✅ تم تغيير اسم الطالبة إلى *${name}*.`,
    removeStudentConfirm: (name) =>
      `⚠️ هل أنتِ متأكدة من حذف الطالبة *${name}*؟\nسيبقى سجل حضورها السابق محفوظًا.`,
    confirmRemoveStudentButton: '🗑️ نعم، احذفيها',
    studentRemoved: (name) => `✅ تم حذف الطالبة *${name}*.`,
    studentNotFound: '⚠️ لم يُعثر على هذه الطالبة.',
    renamePrompt: (old) => `✏️ اكتبي الاسم الجديد للصف *${old}* في رسالة الرد.`,
    renamed: (name) => `✅ تم تغيير اسم الصف إلى *${name}*.`,
    teachersTitle: '👩‍🏫 *المعلمات*',
    teachersEmpty: '🤍 لا توجد معلمات مضافة بعد.',
    addTeacherButton: '➕ إضافة معلمة',
    addTeacherPrompt:
      '✏️ اكتبي كل معلمة في سطر بالصيغة: *الاسم | النوع*\nالأنواع: courseteacher | trainingteacher | recitationteacher\nمثال:\nأمل محمد | courseteacher',
    teachersAdded: (n) => `✅ تمت إضافة ${n} معلمة.`,
    newSessionTitle: '➕ *جلسة جديدة*\n\nاختاري نوع الجلسة:',
    pickSessionType: 'اختاري نوع الجلسات لعرضها:',
    sessionsByTypeTitle: (name, typeLabel) => `🗂️ *جلسات ${name}* — ${typeLabel}`,
    sessionTypeRow: (label, count) => `${label} (${count})`,
    sessionCreated: (name) => `✅ تم إنشاء الجلسة *${name}*. يمكنكِ الآن تسجيل الحضور.`,
    sessionsListTitle: (name) => `🗂️ *جلسات ${name}*`,
    sessionsEmpty: '🤍 لا توجد جلسات بعد.',
    sessionRow: (name, teacher) => (teacher ? `${name} — ${teacher}` : name),
    openEditorButton: '📝 تسجيل الحضور',
    assignTeacherButton: '👩‍🏫 إسناد معلمة',
    sessionReportButton: '📄 تقرير الجلسة',
    pickTeacherTitle: '👩‍🏫 اختاري المعلمة المسؤولة عن هذه الجلسة:',
    noTeacherButton: '🚫 بدون معلمة',
    teacherAssigned: (name) => `✅ تم إسناد الجلسة إلى *${name}*.`,
    teacherCleared: '✅ تم إلغاء إسناد المعلمة.',
    noTeachersYet: '⚠️ لا توجد معلمات مضافة بعد. أضيفيهن من قائمة المعلمات أولاً.',
  },
};


export const st = (key) => (key && TEXT.attendance[key]) || TEXT.attendance.pending;
