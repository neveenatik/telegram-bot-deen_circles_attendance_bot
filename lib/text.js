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
  invalidAddHomeworkGroupFormat: '⚠️ الطريقة الصحيحة (أرسليه داخل الحلقة الرئيسية):\n/addhomeworkgroup [رقم مجموعة التكليف]\n\nمثال:\n/addhomeworkgroup -1001234567890',
  homeworkGroupAdded: (id) => `✅ تم ربط مجموعة التكليف \`${id}\` بالحلقة.\n\nانشري التكليف داخلها مع الوسم *#التكليف*، وسيتتبّع البوت تسليمات الطالبات ومراجعة المعلمات بإذن الله.`,
  homeworkGroupRemoved: '✅ تم إلغاء ربط مجموعة التكليف عن هذه الحلقة.',
  noHomeworkGroupLinked: '⚠️ لا توجد مجموعة تكليف مرتبطة بهذه الحلقة بعد.',
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
  // /manage hub — a single DM control panel that gates to the other admin
  // surfaces. Every button carries the originating group id so taps authorize
  // against that group even from the private chat.
  manageHub: {
    title: '🗂️ *لوحة الإدارة*\n\nاختاري القسم الذي تريدين إدارته:',
    membersButton: '👥 الطالبات',
    pendingButton: '⏳ طلبات الانضمام',
    historyButton: '🗂️ سجل الجلسات',
    teachersButton: '👩‍🏫 المعلمات',
    trainingGroupsButton: '🏷️ مجموعات التدريب',
    materialsButton: '📚 المواد التعليمية',
    homeworkButton: '📓 التكاليف',
    offlineButton: '🧑‍🏫 صفوف بدون مجموعة',
    backButton: '↩️ لوحة الإدارة',
    // The only strings the interactive editor can't borrow from TEXT.offline:
    // group teachers carry a Telegram userId, so the add prompt asks for it.
    // Add is role-first: pick one role, then paste `رقم الحساب | الاسم` lines.
    addTeacherPrompt:
      '✏️ اكتبي كل معلمة في سطر بالصيغة: *رقم الحساب | الاسم | النوع*\nالأنواع: courseteacher | trainingteacher | recitationteacher | homeworkteacher\nمثال:\n123456789 | أمل محمد | courseteacher',
    addTeacherPickRoleTitle: '➕ *إضافة معلمات*\n\nاختاري الدور أولاً، ثم أرسلي قائمة المعلمات:',
    addTeacherNamesPrompt: (roleLabel) =>
      `✏️ اكتبي كل معلمة في سطر بالصيغة: *رقم الحساب | الاسم*\nسيتم إضافتهن جميعاً كـ *${roleLabel}*.\nمثال:\n123456789 | أمل محمد\n\nيمكنكِ لاحقاً إضافة أدوار أخرى لأي معلمة من قائمتها.`,
    // Training-groups editor (online): each training group is a linked Telegram
    // group `{ groupId, name }`, so add/rename ask for id | name and callbacks
    // key on the unique groupId.
    trainingGroupsTitle: '🏷️ *مجموعات التدريب*',
    trainingGroupsManageHint: 'اضغطي على مجموعة لإدارتها، أو أضيفي مجموعة جديدة.',
    trainingGroupsEmptyHint: 'لا توجد مجموعات تدريب مضافة بعد. أضيفي واحدة عبر الزر بالأعلى.',
    addTrainingGroupButton: '➕ إضافة مجموعة تدريب',
    addTrainingGroupPrompt:
      '✏️ اكتبي مجموعة التدريب بالصيغة: *رقم المجموعة | الاسم*\nمثال:\n-1001234567890 | تدريب المجموعة الأولى',
    trainingGroupMenuTitle: (name) => `🏷️ *مجموعة التدريب: ${name}*\n\nاختاري إجراءً:`,
    trainingGroupStudentsButton: '👥 طالبات المجموعة',
    trainingGroupStudentsTitle: (name, count) => `👥 *طالبات ${name}* (${count})`,
    trainingGroupStudentsEmpty: '🤍 لا توجد طالبات في هذه المجموعة بعد.',
    renameTrainingGroupButton: '✏️ إعادة تسمية',
    renameTrainingGroupPrompt: (name) => `✏️ اكتبي الاسم الجديد لمجموعة التدريب *${name}*:`,
    removeTrainingGroupButton: '🗑️ حذف',
    removeTrainingGroupConfirm: (name) => `⚠️ هل تريدين حذف مجموعة التدريب *${name}*؟`,
    confirmRemoveTrainingGroupButton: '🗑️ تأكيد الحذف',
    trainingGroupMissing: '⚠️ مجموعة التدريب غير موجودة.',
    trainingGroupRemovedToast: (name) => `تم حذف ${name}`,
    trainingGroupRenamedToast: (name) => `تم تغيير الاسم إلى ${name}`,
  },
  // Teaching materials editor (shared by the /manage group hub and the offline
  // class hub). Files are stored as Telegram file_ids and resent on demand: the
  // group hub can push a material to the class group, the offline hub resends it
  // to the admin's own chat.
  materials: {
    title: '📚 *المواد التعليمية*',
    manageHint: 'اضغطي على درس لإدارته، أو أضيفي درساً جديداً.',
    empty: '🤍 لا توجد مواد تعليمية بعد. أضيفي أول درس عبر الزر بالأعلى، بارك الله فيكِ.',
    addButton: '➕ إضافة درس',
    // Multi-file upload session. The caption of the FIRST file becomes the
    // lesson title; every file after it is appended to the same lesson.
    addPrompt:
      '📎 أرسلي أول ملف (مستند، صورة، فيديو، أو مقطع صوتي) واكتبي *عنوان الدرس* في تعليق الملف (caption).\n\nيمكنكِ بعدها إرسال المزيد من الملفات لنفس الدرس، ثم اضغطي *إنهاء الإضافة*.',
    addMorePrompt: '📎 أرسلي ملفاً آخر لنفس الدرس، أو اضغطي *إنهاء الإضافة* في الأعلى.',
    // Adding files to an existing lesson (no title needed — it already has one).
    addFilePrompt: '📎 أرسلي ملفاً لإضافته إلى هذا الدرس. يمكنكِ إرسال عدة ملفات، ثم اضغطي *إنهاء الإضافة*.',
    noCaption: '⚠️ لم أجد عنواناً للدرس. أعيدي إرسال أول ملف مع كتابة العنوان في تعليق الملف (caption).',
    // Placeholder title for an album whose caption hasn't arrived yet (album
    // items are separate webhook calls); the captioned item back-fills the real
    // title, so this only lingers if the whole album was sent without a caption.
    albumFallbackTitle: '📚 درس جديد',
    unsupportedType: '⚠️ نوع الملف غير مدعوم. أرسلي مستنداً أو صورة أو فيديو أو مقطعاً صوتياً.',
    added: (title) => `✅ تمت إضافة الدرس: *${title}*`,
    fileAdded: (count) => `✅ أُضيف الملف (${count}). أرسلي المزيد أو اضغطي إنهاء الإضافة.`,
    sessionTitle: (title) => `📎 *جارٍ إضافة الملفات — ${title}*`,
    sessionCount: (count) => (count > 0
      ? `عدد الملفات حتى الآن: ${count}.\nأرسلي ملفاً آخر أو اضغطي إنهاء الإضافة.`
      : 'أرسلي أول ملف مع كتابة عنوان الدرس في التعليق، ثم يمكنكِ إضافة المزيد.'),
    doneButton: '✅ إنهاء الإضافة',
    sessionDone: (count) => `✅ تم حفظ الدرس (${count} ملف/ملفات).`,
    addFileButton: '➕ إضافة ملف',
    renameButton: '✏️ إعادة التسمية',
    renamePrompt: (title) => `✏️ أرسلي العنوان الجديد للدرس *${title}*.`,
    renamed: (title) => `✅ تم تغيير عنوان الدرس إلى *${title}*.`,
    fileCountLabel: (count) => `📎 ${count}`,
    itemMenuTitle: (title, count) => `📄 *${title}*\nعدد الملفات: ${count}\n\nاختاري إجراءً:`,
    sendToGroupButton: '📤 إرسال إلى المجموعة',
    sendToMeButton: '📥 إرسال إليّ',
    selectButton: '☑️ اختيار ملفات لإرسالها',
    selectTitle: (title) => `☑️ *اختيار ملفات — ${title}*`,
    selectHint: 'اضغطي على ملف لتحديده أو إلغائه، ثم اضغطي إرسال المحدد.',
    sendSelectedButton: '📤 إرسال المحدد',
    selectNone: '⚠️ لم تختاري أي ملف.',
    sentSelected: (count) => `✅ تم إرسال ${count} ملف/ملفات.`,
    fileFallback: (n) => `ملف ${n}`,
    sentToGroup: '✅ تم إرسال الدرس إلى المجموعة',
    sentToMe: '✅ تم إرسال الدرس إليكِ',
    sendFailed: '⚠️ تعذّر إرسال الدرس. حاولي مرة أخرى.',
    noFiles: '⚠️ لا توجد ملفات في هذا الدرس بعد.',
    manageFilesButton: '🗂️ إدارة/حذف الملفات',
    filesTitle: (title) => `🗂️ *ملفات الدرس — ${title}*`,
    filesHint: 'اضغطي على ملف أو أكثر لتحديده، ثم اعرضيه للمعاينة أو احذفيه.',
    previewSent: '✅ تم إرسال الملف للمعاينة.',
    previewSentMany: (count) => `✅ تم إرسال ${count} ملف/ملفات للمعاينة.`,
    previewSelectedButton: '👁️ معاينة المحدد',
    deleteSelectedButton: '🗑️ حذف المحدد',
    renameSelectedButton: '✏️ إعادة تسمية المحدد',
    selectOne: '⚠️ اختاري ملفاً واحداً فقط لإعادة التسمية.',
    fileRenamePrompt: (name) => `✏️ أرسلي الاسم الجديد للملف *${name}*.`,
    fileRenamed: (name) => `✅ تم تغيير اسم الملف إلى *${name}*.`,
    deleteFileButton: '🗑',
    fileRemoveConfirm: (name) => `⚠️ هل تريدين حذف الملف *${name}* من هذا الدرس؟`,
    filesRemoveConfirm: (names) => `⚠️ هل تريدين حذف هذه الملفات من الدرس؟\n${names}`,
    confirmRemoveFileButton: '🗑️ تأكيد حذف الملف',
    confirmRemoveFilesButton: '🗑️ تأكيد حذف المحدد',
    fileRemovedToast: 'تم حذف الملف.',
    filesRemovedToast: (count) => `تم حذف ${count} ملف/ملفات.`,
    cannotDeleteLastFile: '⚠️ هذا هو الملف الوحيد. احذفي الدرس كاملاً بدلاً من ذلك.',
    cannotDeleteAllFiles: '⚠️ لا يمكن حذف كل الملفات. احذفي الدرس كاملاً بدلاً من ذلك.',
    fileMissing: '⚠️ الملف غير موجود.',
    removeButton: '🗑️ حذف',
    removeConfirm: (title) => `⚠️ هل تريدين حذف الدرس *${title}* بكل ملفاته؟`,
    confirmRemoveButton: '🗑️ تأكيد الحذف',
    removedToast: (title) => `تم حذف ${title}`,
    missing: '⚠️ الدرس غير موجود.',
    caption: (title) => `📚 *${title}*`,
  },
  homework: {
    // The hashtag that turns a message in the linked homework group into a
    // tracked assignment post.
    tag: '#التكليف',
    defaultTitle: 'التكليف',
    title: '📓 *متابعة التكاليف*',
    empty:
      '🤍 لا توجد تكليفات بعد.\n\nاربطي مجموعة التكليف عبر /addhomeworkgroup، ثم انشري التكليف داخلها مع الوسم *#التكليف* ليبدأ التتبّع بإذن الله.',
    offlineEmpty: '🤍 لا توجد تكليفات بعد. أضيفي أول تكليف عبر الزر بالأعلى، بارك الله فيكِ.',
    listHint: 'اضغطي على تكليف لعرض تفاصيل التسليم والمراجعة.',
    itemTitle: (title) => `📓 *${title}*`,
    counts: (submitted, total, reviewed, resubmitted) =>
      `سلّمن: ${submitted}/${total} • روجِعت: ${reviewed}${resubmitted ? ` • أُعيد تسليمها: ${resubmitted}` : ''}`,
    legend: 'المفتاح: ✅ روجِعت • 🔁 أُعيد تسليمها • 📝 سُلِّمت • ⬜️ لم تُسلَّم',
    allSubmitted: '🎉 ما شاء الله، جميع الطالبات سلّمن هذا التكليف.',
    noStudents: 'لا توجد طالبات مسجّلات في الحلقة بعد.',
    tagButton: '🔔 تنبيه غير المسلِّمات',
    reportButton: '🖨️ تقرير التكاليف',
    reportEmpty: '🤍 لا توجد تكليفات لإعداد تقرير بعد.',
    reportFallbackName: 'الحلقة',
    reportHeader: (className) => `🖨️ *تقرير التكاليف — ${className}*`,
    reportItemHeader: (title, submitted, total, reviewed, resubmitted) =>
      `\n📓 *${title}*\nسلّمن: ${submitted}/${total} • روجِعت: ${reviewed} • أُعيد تسليمها: ${resubmitted}`,
    reportGeneratedToast: '✅ تم إعداد التقرير.',
    removeButton: '🗑️ حذف التكليف',
    removeConfirm: (title) => `⚠️ هل تريدين حذف التكليف *${title}*؟\n(لن تُحذف رسائل المجموعة، فقط سجل التتبّع)`,
    confirmRemoveButton: '🗑️ تأكيد الحذف',
    removedToast: (title) => `تم حذف ${title}`,
    renameButton: '✏️ تعديل العنوان',
    renamePrompt: (title) => `✏️ اكتبي العنوان الجديد للتكليف *${title}*.`,
    renamed: (title) => `✅ تم تحديث العنوان إلى: *${title}*`,
    renameEmpty: '⚠️ لم أستلم عنواناً. أعيدي المحاولة واكتبي العنوان الجديد.',
    missing: '⚠️ التكليف غير موجود.',
    noHomeworkGroupForTag: '⚠️ لا توجد مجموعة تكليف مرتبطة لإرسال التنبيه.',
    allTagged: '🎉 لا توجد طالبات متأخرات — الجميع سلّمن، ما شاء الله.',
    tagReminder: (title, mentions) =>
      `🔔 *تذكير محبّ بخصوص:* ${title}\n\nبانتظار تسليم كلٍّ من: ${mentions}\n\nوفّقكنّ الله وسدّد خطاكنّ 🤍`,
    tagDoneToast: (n) => `تم تنبيه ${n} طالبة`,
    // Offline manual tracking.
    addButton: '➕ إضافة تكليف',
    addPrompt: '✍️ اكتبي *عنوان التكليف* الذي تريدين متابعته.',
    added: (title) => `✅ تمت إضافة التكليف: *${title}*`,
    emptyTitle: '⚠️ لم أستلم عنواناً. أعيدي المحاولة واكتبي عنوان التكليف.',
    manageHint: 'اضغطي على اسم الطالبة لتبديل حالتها: ⬜️ ← 📝 ← ✅ ← 🔁.',
    toggleReviewHint: 'اضغطي على 📝/✅ بجانب الطالبة لتبديل حالة المراجعة.',
    reviewToggleButton: (marker, name) => `${marker} ${name}`,
    // Homework content (the teacher's assignment material: text body + media).
    contentLabel: (chars, files) => {
      const parts = [];
      if (chars) parts.push('📝 نص');
      if (files) parts.push(`📎 ${files} ملف`);
      return parts.length ? `المحتوى: ${parts.join(' • ')}` : 'لا يوجد محتوى بعد.';
    },
    setTextButton: '📝 نص التكليف',
    attachButton: '📎 إرفاق ملفات',
    viewContentButton: '📤 إرسال المحتوى لي',
    textPrompt: '✍️ اكتبي *نص التكليف* (تعليمات الواجب) وسيُحفظ للطالبات.',
    textSaved: '✅ تم حفظ نص التكليف.',
    textCleared: '✅ تم مسح نص التكليف.',
    attachPrompt: '📎 أرسلي ملفات التكليف (صورة/صوت/فيديو/مستند)، ملفاً تلو الآخر.',
    attachMorePrompt: '📎 أرسلي ملفاً آخر، أو اضغطي «تم» عند الانتهاء.',
    attachUnsupported: '⚠️ نوع الملف غير مدعوم. أرسلي صورة أو صوتاً أو فيديو أو مستنداً.',
    attachDoneButton: '✅ تم',
    attachCount: (n) => `📎 عدد الملفات المُرفقة: ${n}`,
    fileAdded: '✅ تمت إضافة الملف.',
    noContent: '⚠️ لا يوجد محتوى لهذا التكليف بعد.',
    contentCaption: (title) => `📓 *${title}*`,
    contentSentToast: '✅ تم إرسال المحتوى.',
    sendFailed: '⚠️ تعذّر الإرسال، حاولي لاحقاً.',
    // Teacher-side submissions inbox (student self-service DM submissions).
    submissionsButton: (n) => `📥 التسليمات (${n})`,
    submissionsTitle: (title) => `📥 *تسليمات: ${title}*`,
    submissionsEmpty: '🤍 لا توجد تسليمات من الطالبات بعد.',
    submissionItem: (marker, name) => `${marker} ${name}`,
    submissionDetail: (name, title) => `📥 *تسليم ${name}*\n📓 ${title}`,
    submissionText: (body) => `✍️ *الإجابة:*\n${body}`,
    submissionNoContent: 'لم تُرفق إجابة نصية.',
    replyButton: '✍️ رد ومراجعة',
    replyPrompt: '✍️ اكتبي ملاحظتك للطالبة (ستصلها في رسالة خاصة).',
    replySaved: '✅ تم حفظ الملاحظة وإشعار الطالبة.',
    replySavedNoNotify: '✅ تم حفظ الملاحظة (تعذّر إشعار الطالبة).',
    submissionSentToast: '📤 تم إرسال إجابة الطالبة إليكِ.',
    // Link a roster student's Telegram account (shown in her roster menu).
    linkStudentButton: '🔗 ربط حساب الطالبة',
    linkStudentText: (name, link) =>
      `🔗 *ربط حساب ${name}*\n\nشاركي هذا الرابط مع الطالبة لتفتحه، فيرتبط حسابها بالحلقة وتصلها تكاليفها:\n\n${link}`,
    linkStudentNoUsername: '⚠️ تعذّر إنشاء الرابط (لا يوجد اسم مستخدم للبوت).',
  },
  studentHomework: {
    title: '📓 *تكاليفي*',
    linkedToast: (name) => `أهلاً بكِ ${name} 🤍 تم ربط حسابك.`,
    linkFailed: '⚠️ تعذّر ربط الحساب. تأكدي من الرابط أو تواصلي مع معلمتك.',
    noClasses: '🤍 لا توجد حلقات مرتبطة بحسابك بعد.\n\nاطلبي من معلمتك رابط الانضمام لتصلك تكاليفك بإذن الله.',
    pickClass: 'اختاري الحلقة لعرض تكاليفها:',
    listTitle: (className) => `📓 *تكاليف ${className}*`,
    listEmpty: '🤍 لا توجد تكاليف بعد. وفّقكِ الله.',
    listHint: 'اضغطي على تكليف لعرضه وتسليمه.',
    itemTitle: (title) => `📓 *${title}*`,
    statusNone: '⬜️ لم تُسلَّم بعد',
    statusSubmitted: '📝 بانتظار المراجعة',
    statusReviewed: '✅ تمت المراجعة',
    statusResubmitted: '🔁 بانتظار إعادة المراجعة',
    myStatus: (label) => `حالتك: ${label}`,
    teacherReply: (reply) => `✍️ *ملاحظة معلمتك:*\n${reply}`,
    viewContentButton: '📖 عرض التكليف',
    submitButton: '📤 تسليم الواجب',
    resubmitButton: '🔁 إعادة التسليم',
    submitPrompt: '📤 أرسلي إجابتك الآن (نص أو صورة أو تسجيل صوتي أو ملف).',
    submitted: '✅ تم استلام تسليمك، جزاكِ الله خيراً.',
    resubmitted: '🔁 تم استلام إعادة تسليمك، بارك الله فيكِ.',
    noContent: '🤍 لا يوجد محتوى إضافي لهذا التكليف.',
    contentSentToast: '📖 تم إرسال التكليف إليكِ.',
    backToListButton: '⬅️ التكاليف',
    // Notifications.
    notifyStaffSubmit: (className, student, title) =>
      `📥 *تسليم جديد* — ${className}\n👤 ${student}\n📓 ${title}`,
    notifyStaffResubmit: (className, student, title) =>
      `🔁 *إعادة تسليم* — ${className}\n👤 ${student}\n📓 ${title}`,
    notifyStudentReply: (className, title, reply) =>
      `✍️ *ملاحظة معلمتك* على «${title}» — ${className}:\n\n${reply}`,
  },
  timetable: {
    // Weekday labels indexed 0=Sunday .. 6=Saturday (matches day_of_week).
    weekdays: ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'],
    hubButton: '🗓️ الجدول الأسبوعي',
    title: (className) => `🗓️ *جدول ${className} الأسبوعي*`,
    panelHint: 'المواعيد الأسبوعية للحلقات. اضغطي على موعد لإدارته، أو أضيفي موعداً جديداً.',
    empty: '🤍 لا توجد مواعيد بعد. أضيفي أول موعد أسبوعي بالأسفل، وفّقكِ الله.',
    addButton: '➕ إضافة موعد',
    weekViewButton: '📅 عرض الأسبوع',
    slotRow: (day, time, typeLabel, teacher) =>
      `${day} ${time} · ${typeLabel}${teacher ? ` — ${teacher}` : ''}`,
    allDayLabel: 'طوال اليوم',
    pickType: '🗂️ اختاري نوع الحلقة لهذا الموعد:',
    pickDay: '📆 اختاري اليوم، أو أضيفي عدة مواعيد دفعة واحدة:',
    timePrompt: '🕐 اكتبي وقت الموعد بنظام 24 ساعة، مثال: *17:30*',
    timeInvalid: '⚠️ صيغة الوقت غير صحيحة. اكتبيها هكذا: 17:30',
    slotAdded: '✅ تمت إضافة الموعد.',
    bulkButton: '⚡ إضافة عدة مواعيد دفعة واحدة',
    bulkPrompt: (typeLabel) =>
      '⚡ اكتبي كل موعد في سطر بالصيغة: *اليوم الوقت*\n' +
      `سيتم إضافتها جميعاً كـ *${typeLabel}*.\n\n` +
      'الأيام: الأحد، الإثنين، الثلاثاء، الأربعاء، الخميس، الجمعة، السبت\n' +
      'مثال:\nالأحد 10:00\nالثلاثاء 17:30\nالخميس 09:00',
    bulkPromptAllDay: (typeLabel) =>
      '⚡ اكتبي كل يوم في سطر مستقل (بدون وقت — النشاط يمتد طوال اليوم).\n' +
      `سيتم إضافتها جميعاً كـ *${typeLabel}*.\n\n` +
      'الأيام: الأحد، الإثنين، الثلاثاء، الأربعاء، الخميس، الجمعة، السبت\n' +
      'مثال:\nالأحد\nالثلاثاء\nالخميس',
    bulkAdded: (n) => `✅ تمت إضافة ${n} موعداً.`,
    bulkNone: '⚠️ لم يُضف أي موعد. تحققي من الصيغة: *اليوم الوقت*.',
    bulkFailedHeader: '⚠️ تعذّرت هذه الأسطر (تجاهُل):',
    slotMenuTitle: (day, time, typeLabel, teacher) =>
      `🗓️ *${day} — ${time}*\n${typeLabel}${teacher ? `\n👩‍🏫 ${teacher}` : ''}`,
    editDayButton: '📆 تغيير اليوم',
    editTimeButton: '🕐 تغيير الوقت',
    editDayTitle: '📆 اختاري اليوم الجديد لهذا الموعد:',
    slotUpdated: '✅ تم تعديل الموعد.',
    assignTeacherButton: '👩‍🏫 إسناد معلمة',
    pickTeacher: '👩‍🏫 اختاري المعلمة المسؤولة عن هذا الموعد:',
    noTeacherButton: '🚫 بدون معلمة',
    teacherAssigned: '✅ تم إسناد المعلمة.',
    teacherCleared: '✅ تم إلغاء إسناد المعلمة.',
    noTeachersYet: '⚠️ لا توجد معلمات مضافة بعد. أضيفيهن من قائمة المعلمات أولاً.',
    removeButton: '🗑️ حذف الموعد',
    removeConfirm: (day, time, typeLabel) =>
      `⚠️ هل تريدين حذف موعد *${typeLabel}* يوم ${day} (${time})؟`,
    confirmRemoveButton: '🗑️ تأكيد الحذف',
    removedToast: 'تم حذف الموعد',
    missing: '⚠️ الموعد غير موجود.',
    // Week view (per class + cross-class "my week").
    weekTitle: (className) => `📅 *أسبوع ${className}*`,
    myWeekTitle: '📅 *جدولي الأسبوعي*',
    weekEmpty: '🤍 لا توجد مواعيد في جدولكِ بعد.',
    dayHeader: (day) => `🗓️ *${day}*`,
    weekSlotLine: (time, typeLabel, teacher) =>
      `\`${time}\`  ${typeLabel}${teacher ? `  ·  👩‍🏫 ${teacher}` : ''}`,
    weekSlotLineAllDay: (allDayLabel, typeLabel, teacher) =>
      `\`${allDayLabel}\`  ${typeLabel}${teacher ? `  ·  👩‍🏫 ${teacher}` : ''}`,
    myWeekSlotLine: (time, className, typeLabel, teacher) =>
      `\`${time}\`  🏫 ${className} · ${typeLabel}${teacher ? ` · 👩‍🏫 ${teacher}` : ''}`,
    myWeekSlotLineTz: (time, tzLabel, className, typeLabel, teacher) =>
      `\`${time}\` _(${tzLabel})_  🏫 ${className} · ${typeLabel}${teacher ? ` · 👩‍🏫 ${teacher}` : ''}`,
    myWeekSlotLineAllDay: (allDayLabel, className, typeLabel, teacher) =>
      `\`${allDayLabel}\`  🏫 ${className} · ${typeLabel}${teacher ? ` · 👩‍🏫 ${teacher}` : ''}`,
    myWeekButton: '📅 جدولي الأسبوعي',
    myWeekCommandHint: 'أرسلي /myweek لعرض جدول أسبوعكِ عبر كل حلقاتكِ.',
    // ── Timezone ────────────────────────────────────────────────────────────
    // Curated IANA zones common to the audience; first entry is the default.
    timezones: [
      { id: 'Africa/Cairo', label: 'القاهرة (‏+2)' },
      { id: 'Asia/Riyadh', label: 'مكة المكرمة (‏+3)' },
      { id: 'Asia/Dubai', label: 'دبي/أبوظبي (‏+4)' },
      { id: 'Asia/Kuwait', label: 'الكويت (‏+3)' },
      { id: 'Asia/Qatar', label: 'الدوحة (‏+3)' },
      { id: 'Asia/Baghdad', label: 'بغداد (‏+3)' },
      { id: 'Asia/Amman', label: 'عمّان (‏+3)' },
      { id: 'Asia/Beirut', label: 'بيروت (‏+3)' },
      { id: 'Asia/Damascus', label: 'دمشق (‏+3)' },
      { id: 'Asia/Jerusalem', label: 'القدس (‏+3)' },
      { id: 'Africa/Khartoum', label: 'الخرطوم (‏+2)' },
      { id: 'Africa/Casablanca', label: 'الدار البيضاء (‏+1)' },
      { id: 'Africa/Algiers', label: 'الجزائر (‏+1)' },
      { id: 'Africa/Tunis', label: 'تونس (‏+1)' },
      { id: 'Europe/Istanbul', label: 'إسطنبول (‏+3)' },
      { id: 'Asia/Karachi', label: 'كراتشي (‏+5)' },
      { id: 'Asia/Jakarta', label: 'جاكرتا (‏+7)' },
      { id: 'Europe/London', label: 'لندن (‏+0)' },
    ],
    tzHeader: (label) => `🌍 التوقيت: *${label}*`,
    tzButton: '🌍 تغيير توقيت الحلقة',
    tzPickTitle: '🌍 اختاري المنطقة الزمنية للحلقة. تُدخل المواعيد وتُخزّن بهذا التوقيت.',
    tzUpdated: '✅ تم تحديث توقيت الحلقة.',
    allZonesButton: '🗺️ كل المناطق الزمنية',
    allZonesRegionTitle: '🗺️ اختاري المنطقة الجغرافية:',
    allZonesZoneTitle: (region) => `🗺️ *${region}* — اختاري المدينة/التوقيت:`,
    // Per-viewer display preferences (each viewer sees the week in her own way).
    viewTzHeader: (label) => `👁️ توقيت العرض: *${label}*`,
    viewTzAuto: 'حسب كل حلقة',
    viewTzButton: '🌍 توقيت العرض',
    viewTzPickTitle: '🌍 اختاري التوقيت الذي تُعرض به المواعيد لكِ. سيتم تحويل كل المواعيد إليه.',
    viewTzAutoButton: '↩️ حسب توقيت الحلقة',
    viewTzUpdated: '✅ تم تحديث توقيت العرض.',
    weekStartButton: '📅 بداية الأسبوع',
    weekStartPickTitle: '📅 اختاري اليوم الذي يبدأ به عرض أسبوعكِ:',
    weekStartUpdated: '✅ تم تحديث بداية الأسبوع.',
    // ── Share as image ───────────────────────────────────────────────────────
    shareButton: '📤 مشاركة كصورة',
    shareMenuTitle: '📤 اختاري ما تريدين مشاركته كصورة:',
    shareWeekButton: '📅 الأسبوع كامل',
    shareDayButton: '🗓️ يوم محدد',
    shareTeacherButton: '👩‍🏫 معلمة محددة',
    sharePickDay: '🗓️ اختاري اليوم الذي تريدين مشاركته:',
    sharePickTeacher: '👩‍🏫 اختاري المعلمة:',
    shareNoTeachers: '⚠️ لا توجد معلمات مُسندة إلى مواعيد بعد.',
    imageGenerating: '⏳ جاري توليد الصورة...',
    imageFailed: '⚠️ تعذّر توليد الصورة، حاولي مرة أخرى.',
    imageFooter: 'دائرة دين — نسأل الله التوفيق والسداد',
    imageSubtitle: (tzLabel) => `توقيت العرض: ${tzLabel}`,
    imageDayTitle: (className, day) => `${className} — ${day}`,
    imageTeacherTitle: (className, teacher) => `${className} — ${teacher}`,
  },
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
    main: '📘 حلقة أساسية',
    training: '🎓 تدريب',
    open: '📗 تسجيل مفتوح',
    registeredSecondary: '🧾 تصحيح التلاوة',
    personalRecitation: '📄 تلاوة فردية',
    groupRecitation: '📖 تلاوة جماعية',
    homeworkReview: '📓 مراجعة التكاليف',
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
  historyDeleteSessionButton: '🗑️ حذف الجلسة',
  historyDeleteSessionConfirmText: (name) =>
    `🗑️ *حذف الجلسة*\n\nهل أنتِ متأكدة من حذف الجلسة *${name}*؟\nسيتم حذف جميع بيانات الحضور الخاصة بها ولا يمكن التراجع عن ذلك.`,
  historyConfirmDeleteSessionButton: '🗑️ نعم، احذفيها',
  historySessionDeleted: (name) => `🗑️ تم حذف الجلسة *${name}*.`,
  recordsHeader: (s, n) => `🗂️ سجلات الدورة ${s} (${n})`,
  recordsLine: (i, s, tz = 'Africa/Cairo') => `#${i} | ${s.name} | ${new Date(s.endedAt || s.startedAt).toLocaleDateString('ar-EG', { timeZone: tz })}`,
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
    homeworkteacher: '📓 معلمة التكليف',
  },
  // Plural labels for the teachers category buttons (each opens that role's list).
  teacherCategoryLabel: {
    courseteacher: '👩‍🏫 معلمات الحلقة',
    trainingteacher: '📝 معلمات التدريب',
    recitationteacher: '🎙️ معلمات التلاوة',
    homeworkteacher: '📓 معلمات التكليف',
  },
  // A teacher may hold several roles at once; join their labels for display.
  teacherTypesLabel: (types) => {
    const list = Array.isArray(types) ? types : (types ? [types] : []);
    const labels = list.map((t) => TEXT.teacherTypeLabel[t] || t);
    return labels.length ? labels.join('، ') : '';
  },
  sessionReportTeacherLine: (name) => `👩‍🏫 المعلمة: *${name}*`,
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
  invalidAddTeacherFormat: '⚠️ الطريقة الصحيحة (كل معلمة في سطر):\n/addteacher [رقم الحساب] | [الاسم] | [النوع]\nالأنواع: courseteacher | trainingteacher | recitationteacher | homeworkteacher\nمثال:\n123456789 | أحمد محمد | courseteacher',
  invalidAddTeacherReplyFormat: '⚠️ لاستخدام هذا الأمر: اكتبي /addteacherreply [النوع] بالرد على رسالة المعلمة داخل المجموعة.\nمثال: /addteacherreply recitationteacher',
  invalidAddTeacherReplyTarget: '⚠️ لا يمكن إضافة حساب البوت كمعلمة.',
  invalidRemoveTeacherFormat: '⚠️ الصيغة الصحيحة (معلمة واحدة أو أكثر):\n/removeteacher [الاسم]\nأمثلة:\nأحمد محمد\nفاطمة علي',
  invalidAssignTeacherFormat: '⚠️ الصيغة الصحيحة (سطر لكل معلمة):\n/assignteacher [الاسم] | [النوع]\nالأنواع: courseteacher | trainingteacher | recitationteacher | homeworkteacher\nمثال:\nأحمد محمد | trainingteacher',
  invalidTeacherType: '⚠️ النوع غير صحيح. الأنواع المتاحة: courseteacher | trainingteacher | recitationteacher | homeworkteacher',
  teacherNameTaken: (name) => `⚠️ يوجد معلمة باسم "${name}" بالفعل.`,
  teacherUserIdTaken: (id) => `⚠️ رقم الحساب ${id} مضاف بالفعل لمعلمة أخرى.`,
  teacherNotFound: (name) => `⚠️ لم يُعثر على معلمة باسم "${name}".`,
  teacherAdded: (name, label) => `✅ تمت إضافة *${name}* كـ ${label}.`,
  teacherRemoved: (name) => `✅ تم حذف المعلمة *${name}*.`,
  teacherAssigned: (name, label) => `✅ تمت إضافة الدور ${label} للمعلمة *${name}*.`,
  invalidTagTeacherFormat: '⚠️ الصيغة الصحيحة: /tagteachers [نوع]\nالأنواع المتاحة: courseteacher | trainingteacher | recitationteacher | homeworkteacher',
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
    `/offline – إدارة صفوفك الخاصة وتسجيل الحضور بالمحادثة الخاصة دون إضافة البوت إلى مجموعة (يشمل المواد التعليمية)\n` +
    `` +
    (admin
      ? `\n\n*للمشرف*\n` +
        `\n*إدارة الحلقة*\n` +
        `/manage – لوحة الإدارة الموحّدة (تُفتح بالخاص): الطالبات والطلبات والسجلات والمعلمات ومجموعات التدريب والمواد التعليمية\n` +
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
        `/addhomeworkgroup [رقم المجموعة] – ربط مجموعة التكليف لتتبّع التسليمات (يُنشَر التكليف فيها بالوسم #التكليف)\n` +
        `/removehomeworkgroup – إلغاء ربط مجموعة التكليف\n` +
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
  historyHeader: (n, tz = 'Africa/Cairo') =>
    `📊 سجل الحضور (${n} جلسة)\n📅 ${new Date().toLocaleDateString('ar-EG', { timeZone: tz })}`,
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
    materialsButton: '📚 المواد التعليمية',
    homeworkButton: '📓 التكاليف',
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
    // Offline training groups: labels managed on the class home, plus per-student
    // assignment shown in her menu.
    trainingGroupsButton: '🏷️ مجموعات التدريب',
    trainingGroupsTitle: '🏷️ *مجموعات التدريب*',
    trainingGroupsManageHint: 'اضغطي على مجموعة لإدارتها، أو أضيفي مجموعة جديدة.',
    trainingGroupsEmptyHint: 'لا توجد مجموعات تدريب بعد. أضيفي واحدة عبر الزر بالأعلى.',
    addTrainingGroupButton: '➕ إضافة مجموعة تدريب',
    addTrainingGroupPrompt: '✏️ اكتبي اسم مجموعة التدريب في رسالة الرد.',
    trainingGroupAdded: (name) => `✅ تمت إضافة مجموعة التدريب *${name}*.`,
    trainingGroupDuplicate: '⚠️ لديكِ مجموعة تدريب بهذا الاسم بالفعل.',
    trainingGroupInvalidName: '⚠️ اسم مجموعة التدريب غير صالح. حاولي مرة أخرى.',
    trainingGroupMenuTitle: (name) => `🏷️ *مجموعة التدريب: ${name}*\n\nاختاري إجراءً:`,
    trainingGroupStudentsButton: '👥 طالبات المجموعة',
    trainingGroupStudentsTitle: (name, count) => `👥 *طالبات ${name}* (${count})`,
    trainingGroupStudentsEmpty: '🤍 لا توجد طالبات في هذه المجموعة بعد.',
    renameTrainingGroupButton: '✏️ تعديل الاسم',
    renameTrainingGroupPrompt: (old) => `✏️ اكتبي الاسم الجديد لمجموعة التدريب *${old}* في رسالة الرد.`,
    trainingGroupRenamed: (name) => `✅ تم تغيير اسم مجموعة التدريب إلى *${name}*.`,
    removeTrainingGroupButton: '🗑️ حذف',
    removeTrainingGroupConfirm: (name) =>
      `⚠️ هل أنتِ متأكدة من حذف مجموعة التدريب *${name}*؟\nسيتم إلغاء ربط الطالبات بها.`,
    confirmRemoveTrainingGroupButton: '🗑️ نعم، احذفيها',
    trainingGroupRemoved: (name) => `✅ تم حذف مجموعة التدريب *${name}*.`,
    trainingGroupNotFound: '⚠️ لم يُعثر على مجموعة التدريب هذه.',
    assignTrainingButton: (name) => (name ? `🏷️ مجموعة التدريب: ${name}` : '🏷️ ربط بمجموعة تدريب'),
    pickTrainingGroupTitle: (name) => `🏷️ *اختاري مجموعة التدريب للطالبة ${name}:*`,
    noTrainingGroupsToAssign: '⚠️ أضيفي مجموعة تدريب أولاً من لوحة الصف.',
    unassignTrainingButton: '🧹 إلغاء الربط',
    studentTrainingAssigned: (name) => `✅ تم ربط الطالبة بمجموعة *${name}*.`,
    studentTrainingUnassigned: '✅ تم إلغاء ربط الطالبة بمجموعة التدريب.',
    renamePrompt: (old) => `✏️ اكتبي الاسم الجديد للصف *${old}* في رسالة الرد.`,
    renamed: (name) => `✅ تم تغيير اسم الصف إلى *${name}*.`,
    teachersTitle: '👩‍🏫 *المعلمات*',
    teachersEmpty: '🤍 لا توجد معلمات مضافة بعد.',
    teachersManageHint: 'اختاري فئة لعرض معلماتها، أو أضيفي معلمة جديدة.',
    teacherCategoryOther: '🗂️ بدون دور محدد',
    teacherCategoryTitle: (label) => `${label}`,
    teacherCategoryHint: 'اضغطي على اسم المعلمة لتعديل اسمها أو أدوارها أو حذفها.',
    teacherCategoryEmpty: '🤍 لا توجد معلمات في هذه الفئة بعد.',
    addTeacherButton: '➕ إضافة معلمة',
    addTeacherPrompt:
      '✏️ اكتبي كل معلمة في سطر بالصيغة: *الاسم | النوع*\nالأنواع: courseteacher | trainingteacher | recitationteacher | homeworkteacher\nمثال:\nأمل محمد | courseteacher',
    addTeacherPickRoleTitle: '➕ *إضافة معلمات*\n\nاختاري الدور أولاً، ثم أرسلي أسماء المعلمات:',
    addTeacherNamesPrompt: (roleLabel) =>
      `✏️ اكتبي اسم كل معلمة في سطر مستقل (أو مفصولة بفاصلة).\nسيتم إضافتهن جميعاً كـ *${roleLabel}*.\n\nيمكنكِ لاحقاً إضافة أدوار أخرى لأي معلمة من قائمتها.`,
    teachersAdded: (n) => `✅ تمت إضافة ${n} معلمة.`,
    teacherMenuTitle: (name, typeLabel) =>
      `👩‍🏫 *${name}*\nالأدوار الحالية: *${typeLabel}*\n\nماذا تريدين أن تفعلي؟`,
    renameTeacherButton: '✏️ تعديل الاسم',
    changeTeacherTypeButton: '🔀 تعديل الأدوار',
    removeTeacherButton: '🗑️ حذف المعلمة',
    renameTeacherPrompt: (old) => `✏️ اكتبي الاسم الجديد للمعلمة *${old}* في رسالة الرد.`,
    teacherRenamed: (name) => `✅ تم تغيير اسم المعلمة إلى *${name}*.`,
    pickTeacherTypeTitle: (name) => `🔀 *اختاري أدوار المعلمة ${name}* (يمكن اختيار أكثر من دور):`,
    teacherTypeChanged: (typeLabel) => `✅ تم تحديث الأدوار: *${typeLabel}*.`,
    teacherNeedsRole: '⚠️ يجب أن يكون للمعلمة دور واحد على الأقل.',
    removeTeacherConfirm: (name) =>
      `⚠️ هل أنتِ متأكدة من حذف المعلمة *${name}*؟\nستبقى إسناداتها في الجلسات السابقة محفوظة.`,
    confirmRemoveTeacherButton: '🗑️ نعم، احذفيها',
    teacherRemoved: (name) => `✅ تم حذف المعلمة *${name}*.`,
    teacherNotFound: '⚠️ لم يُعثر على هذه المعلمة.',
    newSessionTitle: '➕ *جلسة جديدة*\n\nاختاري نوع الجلسة:',
    pickSessionType: 'اختاري نوع الجلسات لعرضها:',
    sessionsByTypeTitle: (name, typeLabel) => `🗂️ *جلسات ${name}* — ${typeLabel}`,
    sessionTypeRow: (label, count) => `${label} (${count})`,
    sessionCreated: (name) => `✅ تم إنشاء الجلسة *${name}*. يمكنكِ الآن تسجيل الحضور.`,
    sessionsListTitle: (name) => `🗂️ *جلسات ${name}*`,
    sessionsEmpty: '🤍 لا توجد جلسات بعد.',
    sessionRow: (name, teacher) => (teacher ? `${name} — ${teacher}` : name),
    openEditorButton: '⚙️ إدارة الجلسة',
    assignTeacherButton: '👩‍🏫 إسناد معلمة',
    sessionReportButton: '📄 تقرير الجلسة',
    allSessionsButton: '📋 كل الجلسات',
    allSessionsTitle: (name) => `📋 *كل جلسات ${name}*`,
    allSessionRow: (recordIndex, typeLabel, name, date) => `${recordIndex}. ${typeLabel} · ${name} | ${date}`,
    deleteSessionButton: '🗑️ حذف الجلسة',
    deleteSessionConfirm: (name) => `⚠️ هل تريدين حذف الجلسة *${name}* نهائياً؟\n(سيُحذف سجل الحضور الخاص بها ولا يمكن التراجع)`,
    confirmDeleteSessionButton: '🗑️ تأكيد الحذف',
    sessionDeletedToast: (name) => `تم حذف الجلسة ${name}`,
    sessionDeleteFailed: '⚠️ تعذّر حذف الجلسة، حاولي لاحقاً.',
    pickTeacherTitle: '👩‍🏫 اختاري المعلمة المسؤولة عن هذه الجلسة:',
    noTeacherButton: '🚫 بدون معلمة',
    teacherAssigned: (name) => `✅ تم إسناد الجلسة إلى *${name}*.`,
    teacherCleared: '✅ تم إلغاء إسناد المعلمة.',
    noTeachersYet: '⚠️ لا توجد معلمات مضافة بعد. أضيفيهن من قائمة المعلمات أولاً.',

    // ── Delegation (co-managers) ──────────────────────────────────────────────
    rootChooserTitle: '🗂️ *الوضع دون اتصال*\n\nاختاري ما تريدين عرضه:',
    sharedClassesButton: '🤝 صفوف شاركنني بها',
    sharedClassesTitle: '🤝 *صفوف شاركنني بها*',
    noSharedClasses: '🤍 لا توجد صفوف شاركنكِ بها بعد.',
    managersButton: '👥 المشرفات',
    managersTitle: (name) => `👥 *مشرفات ${name}*`,
    managersEmpty: '🤍 لم تتم إضافة أي مشرفة بعد.\nيمكنكِ مشاركة إدارة الصف مع أخوات موثوقات.',
    managersHint: 'اضغطي على اسم المشرفة لتعديل صلاحيتها أو إزالتها.',
    addManagerButton: '➕ إضافة مشرفة',
    roleOperator: 'مُشرِفة',
    roleAssistant: 'مساعِدة',
    roleLabel: (role) => (role === 'assistant' ? 'مساعِدة' : 'مُشرِفة'),
    managerRow: (name, role) =>
      `${name} — ${role === 'assistant' ? 'مساعِدة' : 'مُشرِفة'}`,
    pickManagerRoleTitle:
      '👥 *اختاري صلاحية المشرفة:*\n\n• *مُشرِفة*: إدارة كاملة (الجلسات، الطالبات، المعلمات، الحضور، التقارير) عدا تعديل اسم الصف وإدارة المشرفات.\n• *مساعِدة*: تسجيل الحضور في الجلسات القائمة والتقارير فقط.',
    addManagerIdPrompt: (roleLabel) =>
      `✏️ أرسلي المعرّف الرقمي للأخت التي تريدين إضافتها كـ *${roleLabel}* في رسالة الرد.\nيمكنها الحصول على معرّفها بإرسال /myid للبوت.`,
    managerAdded: (name, roleLabel) => `✅ تمت إضافة *${name}* كـ *${roleLabel}* بإذن الله.`,
    managerSelfNotAllowed: '⚠️ لا يمكنكِ إضافة نفسكِ كمشرفة.',
    invalidManagerId: '⚠️ المعرّف غير صالح. أرسلي رقمًا صحيحًا فقط.',
    managerMenuTitle: (name, roleLabel) => `👥 *${name}*\nالصلاحية الحالية: *${roleLabel}*`,
    makeOperatorButton: '⬆️ ترقية إلى مُشرِفة',
    makeAssistantButton: '⬇️ تخفيض إلى مساعِدة',
    renameManagerButton: '✏️ تعديل الاسم',
    renameManagerPrompt: (name) =>
      `✏️ أرسلي الاسم الجديد للمشرفة *${name}* في رسالة الرد.`,
    managerRenamed: (name) => `✅ تم تعديل الاسم إلى *${name}*.`,
    removeManagerButton: '🗑️ إزالة المشرفة',
    managerRoleChanged: (roleLabel) => `✅ تم تغيير الصلاحية إلى *${roleLabel}*.`,
    removeManagerConfirm: (name) =>
      `⚠️ هل أنتِ متأكدة من إزالة *${name}* من إدارة هذا الصف؟`,
    confirmRemoveManagerButton: '🗑️ نعم، أزيليها',
    managerRemoved: (name) => `✅ تمت إزالة *${name}* من إدارة الصف.`,
    managerNameRequired: '⚠️ الرجاء إرسال اسم صحيح.',
    managerNotFound: '⚠️ لم يُعثر على هذه المشرفة.',
    inviteManagerButton: '📨 دعوة للانضمام',
    // Forwardable invitation the owner shares with a delegate. `link` is a deep
    // link that opens the bot DM and drops her straight into her shared classes.
    managerInvitation: (className, roleLabel, link) => {
      const steps = link
        ? `1️⃣ افتحي هذا الرابط وابدئي المحادثة مع البوت:\n[👈 اضغطي هنا لفتح البوت](${link})\n2️⃣ ثم اختاري «🤝 صفوف شاركنني بها».`
        : '1️⃣ افتحي محادثة مع البوت وأرسلي /offline\n2️⃣ ثم اختاري «🤝 صفوف شاركنني بها».';
      return (
        `📨 *دعوة لإدارة صف «${className}»*\n\n` +
        `السلام عليكِ ورحمة الله 🌸\n` +
        `تمّت دعوتكِ للمساعدة في إدارة صف «${className}» بصفة *${roleLabel}* بإذن الله.\n\n` +
        `للبدء:\n${steps}\n\n` +
        `جزاكِ الله خيراً 🤍`
      );
    },
    inviteSentHint: '📨 تم إنشاء الدعوة أدناه — أعيدي توجيهها للأخت المعنيّة.',
    cloneClassButton: '📑 نسخ الصف إلى صفوفي',
    classCloned: (name, students, teachers) =>
      `✅ تم نسخ الصف إلى *${name}* بإذن الله.\nنُقلت ${students} طالبة و ${teachers} معلمة. (لا يشمل النسخ سجلات الحضور.)`,
    classClonedToast: '✅ تم نسخ الصف إلى صفوفكِ.',
    cloneFailed: '⚠️ تعذّر نسخ الصف. حاولي مرة أخرى.',
  },
};


export const st = (key) => (key && TEXT.attendance[key]) || TEXT.attendance.pending;
