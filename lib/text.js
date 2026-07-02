// All Arabic text strings for the bot
// UI messages, prompts, buttons, reports

import { formatPages, getFirstPage } from './helpers.js';

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

export const TEXT = {
  adminOnly: '⛔ هذا الأمر متاح للمشرفين فقط.',
  creatorOnly: '⛔ هذا الأمر متاح لمنشئ المجموعة فقط.',
  noSessionActive: '⚠️ لا توجد قائمة نشطة.',
  sessionAlreadyActive: '⚠️ توجد قائمة نشطة بالفعل. أنهِها أولاً بـ /stoplist',
  memberNotFound: '⚠️ العضو غير موجود.',
  invalidAddFormat: '⚠️ الصيغة الصحيحة (طالبة واحدة أو أكثر):\n/addstudent [معرّف] | [الاسم]\nأمثلة:\n123456789 | فاطمة محمد\n987654321 | عائشة علي',
  invalidRenameFormat: '⚠️ الصيغة الصحيحة (سطر لكل تعديل):\n/renamestudent [قديم] | [جديد]\nأمثلة:\nفاطمة القديم | فاطمة الجديد\nعائشة القديم | عائشة الجديد',
  invalidStartFormat: '⚠️ مثال: /startlist اجتماع يونيو',
  invalidPageListFormat: '⚠️ مثال: /startpagelist جلسة قراءة يونيو',
  invalidRemoveFormat: '⚠️ الصيغة الصحيحة (طالبة واحدة أو أكثر):\n/removestudent [الاسم]\nأمثلة:\nفاطمة محمد\nعائشة علي',
  invalidUserId: '⚠️ معرّف المستخدم يجب أن يكون رقماً صحيحاً.',
  emptyInput: '⚠️ الإدخال لا يمكن أن يكون فارغاً.',
  needRegistration: '⚠️ هذه الجلسة مخصصة للمسجّلات فقط.\nاسمك غير موجود في القائمة، تواصلي مع المشرف.',
  genericError: '⚠️ حدث خطأ. يرجى المحاولة لاحقاً.',
  sessionEnded: '_✅ الحلقة منتهية_',
  sessionJoinPrompt: '_سجّل حضورك باستخدام الأزرار أدناه:_',
  pageListJoinPrompt: '_سجّلي حضورك لتحصلي على صفحتكِ تلقائياً:_',
  pageAssigned: (name, page) => `✅ ${name} — صفحة ${page}`,
  alreadyHasPage: (page) => `ℹ️ لديكِ بالفعل صفحة ${page} في هذه الجلسة.`,
  sessionRegistrationClosed: '_⛔ تم إيقاف تسجيل الحضور حالياً من قبل المشرف._',
  registrationStopped: '✅ تم إيقاف تسجيل الحضور. لن يتمكن الأعضاء من تغيير حالتهم الآن.',
  registrationAlreadyStopped: 'ℹ️ تسجيل الحضور متوقف بالفعل.',
  registrationClosedAlert: '⛔ تم إيقاف تسجيل الحضور حالياً.',
  noSeriesRecords: (s) => `⚠️ لا توجد سجلات في السلسلة الحالية (${s}).`,
  recordsHeader: (s, n) => `🗂️ سجلات السلسلة ${s} (${n})`,
  recordsLine: (i, s) => `#${i} | ${s.name} | ${new Date(s.endedAt || s.startedAt).toLocaleDateString('ar-EG', { timeZone: 'Africa/Cairo' })}`,
  invalidRecordIndex: '⚠️ رقم السجل غير صالح. استخدمي /classhistory لمعرفة الأرقام.',
  invalidSeriesNumber: '⚠️ رقم الدورة غير صالح. استخدمي رقماً أكبر من صفر.',
  invalidRemoveMemberRecordFormat: '⚠️ الصيغة الصحيحة:\n/removestudentrecord [رقم السجل] | [اسم العضوة]',
  invalidSortNamesFormat: '⚠️ الصيغة الصحيحة:\n/sortnames اسم1 | اسم2 | اسم3\nويمكن أيضاً استخدام الفاصلة , أو كل اسم في سطر، مع دعم الترقيم مثل 1- اسم.\n\nللتجميع عبر عدة رسائل:\n/sortnames start ثم /sortnames add ... ثم /sortnames done',
  recordMemberNotFound: (name) => `⚠️ لا يوجد سجل للعضوة *${name}* داخل السجل المحدد.`,
  closeSeriesNeedsNoActiveSession: '⚠️ لا يمكن إغلاق الدورة أثناء وجود قائمة نشطة. أنهِ القائمة أولاً بـ /stoplist.',
  closeSeriesDone: (from, to) => `✅ تم إغلاق الدورة ${from} وبدء دورة ${to}.`,
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
  refreshButton: '🔄 تحديث',
  backButton: '↩️ رجوع',
  deleteButton: '🗑️ حذف',
  renameButton: '✏️ تعديل الاسم',
  noNameFallback: 'بدون اسم',
  noSessionShort: '⚠️ لا توجد قائمة.',
  refreshed: '✅ تم التحديث',
  registeredSelf: (a) => `✅ تمت إضافتك وتسجيلك كـ "${a}"`,
  membersHeader: (n) => `👥 *قائمة الأعضاء (${n}):*\n\n`,
  manageHeader: (name) => `⚙️ *إدارة الحضور – ${name}*\n\nانقر على عضو لتعديل حالته أو علّم أنه تم النداء عليه:\n\n`,
  memberOptionsHeader: (name) => `🔧 *إدارة العضو:*\n${name}`,
  managePickHeader: (name, e, called) => `⚙️ *تعديل حالة:* ${name}\nالحالة الحالية: ${e}\nحالة النداء: ${called === 'responding' ? '👉 جاري الرد' : called === 'responded' ? '✅ حاضرة' : called === 'away' ? '📣 كان بعيداً عن الميكروفون' : ''}\n\nاختر الحالة الجديدة أو حالة النداء:`,
  renamePrompt: (name) => `✏️ اكتب الاسم الجديد بدلاً من *${name}*:`,
  myIdInfo: '🪪 بيانات حسابك — أرسلي الرسالة التالية للمشرفة لإضافتك:',
  registerInfo: `📢 *طريقة التسجيل:*\n\n1. اكتبي /myid داخل المجموعة التي يوجد فيها البوت.\n2. انسخي السطر الذي يظهر بصيغة: \`[معرّف تيليغرام] | [الاسم]\`\n3. أرسليه للمشرفة ليتم إضافتك إلى قائمة المسجلات.`,
  statusNoSession: (n) => `📊 لا توجد قائمة نشطة حالياً.\nالأعضاء المسجّلون: ${n}`,
  statusReport: (c, total) => `📊 *قائمة: ${c.name}*\n✅ حاضرة: ${c.present}\n👂 مستمعة: ${c.listening}\n🔔 معتذرة: ${c.excused}\n⏳ لم تسجّل: ${c.pending}\n👥 الإجمالي: ${total}`,
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
  sessionListTruncated: (n) => `… وتم إخفاء ${n} اسم/أسماء لتجاوز حد الرسالة.`,
  inlinePromptAdd: '📝 أرسل إدخالاً واحداً أو أكثر بهذه الصيغة (رداً على هذه الرسالة):\n[معرّف تيليغرام] | [الاسم]\n\nأمثلة:\n123456789 | أحمد محمد\n987654321 | فاطمة علي\n\nيمكنك الفصل بسطر جديد أو فاصلة.',
  inlineInvalidAddFormat: '⚠️ الصيغة الصحيحة:\n[معرّف تيليغرام] | [الاسم]\n\nأمثلة:\n123456789 | أحمد محمد\n987654321 | فاطمة علي\n\nيمكنك الفصل بسطر جديد أو فاصلة.',
  replyToPromptOnly: '↩️ من فضلك اكتب الرد على رسالة الإدخال نفسها.',
  addGuestPrompt: '📝 اكتب اسم الضيفة لإضافتها إلى هذه القائمة:',
  guestExistsInSession: (name) => `⚠️ الاسم *${name}* موجود بالفعل في هذه القائمة.`,
  guestAddedToSession: (name) => `✅ تمت إضافة الضيفة *${name}* إلى القائمة الحالية.`,
  editPagePrompt: (name) => `📄 أدخلي رقم الصفحة أو نطاق الصفحات لـ *${name}* (1-604):\nأمثلة: 5 أو 3-5 أو 2,4,6`,
  invalidPageNumber: '⚠️ أدخل رقماً واحداً (3)، نطاقاً (3-5)، أو قائمة (2,4,6). جميع الأرقام يجب أن تكون بين 1 و 604.',
  pageEditedSuccess: (name, page) => `✅ تم تعديل صفحة *${name}* إلى ${page}.`,
  invalidStartGroupRecitationFormat: '⚠️ مثال: /startgrouprecitation جلسة التلاوة الجماعية',
  emptyTeachers: '📋 لا توجد معلمات مضافة بعد.',
  invalidAddTeacherFormat: '⚠️ الصيغة الصحيحة (سطر لكل معلمة):\n/addteacher [معرّف] | [اسم] | [نوع]\nالأنواع: courseteacher | trainingteacher | recitationteacher\nمثال:\n123456789 | أحمد محمد | courseteacher',
  invalidRemoveTeacherFormat: '⚠️ الصيغة الصحيحة (معلمة واحدة أو أكثر):\n/removeteacher [الاسم]\nأمثلة:\nأحمد محمد\nفاطمة علي',
  invalidAssignTeacherFormat: '⚠️ الصيغة الصحيحة (سطر لكل معلمة):\n/assignteacher [الاسم] | [النوع]\nالأنواع: courseteacher | trainingteacher | recitationteacher\nمثال:\nأحمد محمد | trainingteacher',
  invalidTeacherType: '⚠️ النوع غير صحيح. الأنواع المتاحة: courseteacher | trainingteacher | recitationteacher',
  teacherNameTaken: (name) => `⚠️ يوجد معلمة باسم "${name}" بالفعل.`,
  teacherNotFound: (name) => `⚠️ لم يُعثر على معلمة باسم "${name}".`,
  teacherAdded: (name, label) => `✅ تمت إضافة *${name}* كـ ${label}.`,
  teacherRemoved: (name) => `✅ تم حذف المعلمة *${name}*.`,
  teacherAssigned: (name, label) => `✅ تم تحديث نوع *${name}* إلى ${label}.`,
  invalidTagTeacherFormat: '⚠️ الصيغة الصحيحة: /tagteachers [نوع]\nالأنواع المتاحة: courseteacher | trainingteacher | recitationteacher',
  noTeachersOfType: (label) => `⚠️ لا توجد معلمات من نوع ${label}.`,
  groupRecitationJoinPrompt: '_سجّلي حضورك لتحصلي على صفحتكِ من التلاوة الجماعية:_',
  pageAssignedGroupRecitation: (name, page) => `✅ ${name} — صفحة ${page}`,
  groupRecitationReport: (session) => {
    const pages = session.pages || {};
    const attendance = session.attendance || {};
    
    // Group by attendance status
    const groups = { present: [], listening: [], excused: [] };
    for (const [name, page] of Object.entries(pages)) {
      const status = attendance[name] || 'listening';
      if (status === 'present') groups.present.push([name, page]);
      else if (status === 'listening') groups.listening.push([name, page]);
      else if (status === 'excused') groups.excused.push([name, page]);
    }
    
    // Sort each group by page, then alphabetically by name
    sortByPageThenName(groups);
    
    const totalCount = groups.present.length + groups.listening.length + groups.excused.length;
    if (!totalCount) return `📖 *تقرير التلاوة الجماعية "${session.name}":*\n\nلم يُسجّل أحد.`;
    
    let r = `📖 *تقرير التلاوة الجماعية "${session.name}" (${totalCount} طالبة):*\n\n`;
    
    if (groups.present.length) {
      r += `✅ *قراءة (${groups.present.length}):*\n`;
      r += groups.present.map(([name, page]) => `📄 ${formatPages(page)} — ${name}`).join('\n');
      r += '\n\n';
    }
    
    if (groups.listening.length) {
      r += `👂 *مستمعة (${groups.listening.length}):*\n`;
      r += groups.listening.map(([name, page]) => `📄 ${formatPages(page)} — ${name}`).join('\n');
      r += '\n\n';
    }
    
    if (groups.excused.length) {
      r += `🔔 *معتذرة (${groups.excused.length}):*\n`;
      r += groups.excused.map(([name]) => `${name}`).join('\n');
    }
    
    return r;
  },
  report: (session, groups) => {
    let r = `📊 *تقرير قائمة "${session.name}":*\n\n`;
    if (groups.present.length) r += `✅ *حاضرة (${groups.present.length}):*\n${sortNamesAlphabetically(groups.present).join('\n')}\n\n`;
    if (groups.listening.length) r += `👂 *مستمعة فقط (${groups.listening.length}):*\n${sortNamesAlphabetically(groups.listening).join('\n')}\n\n`;
    if (groups.excused.length) r += `🔔 *معتذرة (${groups.excused.length}):*\n${sortNamesAlphabetically(groups.excused).join('\n')}\n\n`;
    // Show absent only for registered lists
    if (!session.allowPublicRegistration && groups.absent.length) r += `❌ *غياب (${groups.absent.length}):*\n${sortNamesAlphabetically(groups.absent).join('\n')}`;
    return r;
  },
  pageListReport: (session) => {
    const pages = session.pages || {};
    const attendance = session.attendance || {};
    
    // Group by attendance status
    const groups = { present: [], listening: [], excused: [] };
    for (const [name, page] of Object.entries(pages)) {
      const status = attendance[name] || 'listening';
      if (status === 'present') groups.present.push([name, page]);
      else if (status === 'listening') groups.listening.push([name, page]);
      else if (status === 'excused') groups.excused.push([name, page]);
    }
    
    // Sort each group by page, then alphabetically by name
    sortByPageThenName(groups);
    
    const totalCount = groups.present.length + groups.listening.length + groups.excused.length;
    if (!totalCount) return `📖 *تقرير قائمة "${session.name}":*\n\nلم يُسجّل أحد.`;
    
    let r = `📖 *تقرير قائمة "${session.name}" (${totalCount} طالبة):*\n\n`;
    
    if (groups.present.length) {
      r += `✅ *قراءة (${groups.present.length}):*\n`;
      r += groups.present.map(([name, page]) => `📄 ${formatPages(page)} — ${name}`).join('\n');
      r += '\n\n';
    }
    
    if (groups.listening.length) {
      r += `👂 *مستمعة (${groups.listening.length}):*\n`;
      r += groups.listening.map(([name, page]) => `📄 ${formatPages(page)} — ${name}`).join('\n');
      r += '\n\n';
    }
    
    if (groups.excused.length) {
      r += `🔔 *معتذرة (${groups.excused.length}):*\n`;
      r += groups.excused.map(([name]) => `${name}`).join('\n');
    }
    
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
        `/students – إدارة قائمة طالبات المجموعة الخاصة (إضافة / حذف / تعديل)\n` +
        `/registerinfo – إرسال توضيح طريقة التسجيل لطالبات المجموعة الخاصة\n` +
        `/sortnames [أسماء] – ترتيب قائمة أسماء أبجدياً\n` +
        `/addstudent [معرّف] | [اسم] – إضافة طالبة أو أكثر (يمكن إضافة عدة طالبات بفصلهن بسطر جديد أو فاصلة)\n` +
        `/removestudent [اسم] – حذف طالبة أو أكثر (فصل بسطر جديد أو فاصلة)\n` +
        `/renamestudent [قديم] | [جديد] – تعديل اسم طالبة أو أكثر (سطر لكل إدخال)\n` +
        `/tagstudents – الإشارة إلى جميع الطالبات المسجلات \n` +
        `/addteacher [معرّف] | [اسم] | [نوع] – إضافة معلمة أو أكثر (سطر لكل إدخال)\n` +
        `/removeteacher [اسم] – حذف معلمة أو أكثر (فصل بسطر جديد أو فاصلة)\n` +
        `/assignteacher [اسم] | [نوع] – تغيير نوع معلمة أو أكثر (سطر لكل إدخال)\n` +
        `/listteachers – عرض قائمة المعلمات\n` +
        `/tagteachers [نوع] – الإشارة إلى المعلمات حسب النوع\n` +
        `/startlist [اسم] – بدء قائمة للحلقة الرئيسية للمسجلات\n` +
        `/startopenlist [اسم] – بدء قائمة مفتوحة لأي طالبة\n` +
        `/startsecondarylist [اسم] – بدء قائمة للحلقات الثانوية (تصحيح التلاوة) للمسجلات\n` +
        `/startpersonalrecitation [اسم] – بدء ختمة فردية وتعيين صفحات تلقائياً\n` +
        `/startgrouprecitation [اسم] – بدء ختمة جماعية متسلسلة (صفحة واحدة لكل حاضرة)\n` +
        `/stopregistration – إيقاف تسجيل الحضور في القائمة\n` +
        `/newclass – مسح تاريخ الحضور والبدء بدورة جديدة (لمنشئ المجموعة)\n` +
        `/classhistory [دورة] – عرض سجلات الدورة (الحالية افتراضياً، أو دورة محددة)\n` +
        `/removeclassrecord [رقم] – حذف سجل حلقة من الدورة الحالية (بتأكيد، لمنشئ المجموعة)\n` +
        `/removestudentrecord [رقم] | [اسم] – حذف سجل طالبة من سجل في الدورة الحالية (بتأكيد، لمنشئ المجموعة)\n` +
        `/stoplist – إنهاء الحلقة\n` +
        `/editlist – تعديل حالات الحضور بشكل فردي\n` +
        `/studentshistory [دورة] – سجل الطالبات حسب الدورة (الحالية افتراضياً)\n` +
        `/feedback [رسالتك] – الإبلاغ عن مشاكل تقنية أو اقتراحات (يُرسل بشكل مجهول الهوية)\n`
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
    hide: '🙈 إخفاء',
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
  sessionHeader: (name) => `📚 *قائمة: ${name}*`,
  feedbackUsageHelp: `
📧 *التواصل بالمطور (مجهول الهوية)*

*الطريقة:*
\`/feedback [رسالتك هنا]\`

*أمثلة [جيدة]:*
\`/feedback عند استخدام /editlist، حالة الحضور لا تُحفظ\`
\`/feedback /startlist لا يعرض أزرار الحضور في الرسالة\`

*نصيحة:* اذكر الأمر المستخدم والمشكلة والسلوك المتوقع ✓

✅ رسالتك ستُرسل مجهولة الهوية مع طابع التاريخ فقط
`.trim(),
  feedbackThankYou: '✅ شكراً! تم إرسال رسالتك بنجاح (مجهول الهوية)',
  feedbackError: '❌ حدث خطأ. يرجى المحاولة لاحقاً',
  contactNotConfigured: '⚠️ خدمة التواصل غير مفعّلة حالياً',
};


export const st = (key) => (key && TEXT.attendance[key]) || TEXT.attendance.pending;
