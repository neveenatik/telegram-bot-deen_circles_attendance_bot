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
  invalidAddFormat: '⚠️ الطريقة الصحيحة لإضافة طالبة أو أكثر:\n/addstudent [رقم الحساب] | [الاسم]\nأمثلة:\n123456789 | فاطمة محمد\n987654321 | عائشة علي',
  invalidRenameFormat: '⚠️ الطريقة الصحيحة لتعديل الاسم (كل تعديل في سطر):\n/renamestudent [الاسم الحالي] | [الاسم الجديد]\nأمثلة:\nفاطمة القديم | فاطمة الجديد\nعائشة القديم | عائشة الجديد',
  invalidStartFormat: '⚠️ مثال: /startlist اجتماع يونيو',
  invalidPageListFormat: '⚠️ مثال: /startpagelist جلسة قراءة يونيو',
  invalidRemoveFormat: '⚠️ أسهل طريقة للحذف هي عبر /students.\n\nويمكنك استخدام الأمر الاحتياطي بهذا الشكل:\n/removestudent [الاسم أو رقم الحساب]\nأمثلة:\nفاطمة محمد\n123456789\nعائشة علي, 987654321',
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
  noSeriesRecords: (s) => `⚠️ لا توجد سجلات في الدورة الحالية (${s}).`,
  recordsHeader: (s, n) => `🗂️ سجلات الدورة ${s} (${n})`,
  recordsLine: (i, s) => `#${i} | ${s.name} | ${new Date(s.endedAt || s.startedAt).toLocaleDateString('ar-EG', { timeZone: 'Africa/Cairo' })}`,
  invalidRecordIndex: '⚠️ رقم السجل غير صالح. استخدمي /classhistory لمعرفة الأرقام.',
  invalidSeriesNumber: '⚠️ رقم الدورة غير صالح. استخدمي رقماً أكبر من صفر.',
  invalidRemoveMemberRecordFormat: '⚠️ الصيغة الصحيحة:\n/removestudentrecord [رقم السجل] | [اسم العضوة]',
  invalidSortNamesFormat: '⚠️ الصيغة الصحيحة:\n/sortnames اسم1 | اسم2 | اسم3\nويمكن أيضاً استخدام الفاصلة , أو كل اسم في سطر، مع دعم الترقيم مثل 1- اسم.\n\nيمكن بدء السطر بـ add وسيتم تجاهلها:\n/sortnames add اسم1 | اسم2\n\nللتجميع عبر عدة رسائل:\n/sortnames start ثم /sortnames add ... ثم /sortnames done\nوللإلغاء: /sortnames cancel',
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
  checkpointMissing: '⚠️ نقطة المتابعة هذه لم تعد متاحة.',
  checkpointNeedAttendance: '⚠️ سجّلي حضورك في الحلقة أولاً، ثم أكّدي المتابعة بارك الله فيكِ.',
  checkpointAlreadyConfirmed: '🌷 سبق تأكيدك لهذه النقطة، جزاكِ الله خيراً وبارك فيكِ.',
  checkpointConfirmedStart: '🌷 بارك الله فيكِ، وصلنا تأكيد حضوركِ.',
  checkpointConfirmedReminder: '🌷 جزاكِ الله خيراً، وصلنا تأكيد متابعتكِ.',
  checkpointStartButton: '✅ أؤكد حضوري',
  checkpointReminderButton: '🌷 أؤكد المتابعة',
  checkpointStartPrompt: (sessionName) =>
    `السلام عليكن ورحمة الله وبركاته\n\n` +
    `حياكن الله يا غاليات، وبارك في اجتماعكن في *${sessionName}*.\n` +
    `نذكّر أنفسنا وإياكن بتجديد النية، وأن يكون حضورنا وتعلّمنا لله سبحانه وتعالى، نبتغي به الأجر والقبول.\n\n` +
    `ولا تنسين الإكثار من التسبيح، وحمد الله، والصلاة والسلام على نبينا محمد ﷺ.\n\n` +
    `نرجو من كل طالبة حاضرة أن تؤكد حضورها بالضغط على الزر أدناه.\n` +
    `جزاكن الله خيراً وكتب لكن النفع والبركة.`,
  checkpointReminderPrompt: (sessionName, number) =>
    `تذكير لطيف يا غاليات\n\n` +
    `هذه نقطة المتابعة رقم ${number} في *${sessionName}*.\n` +
    `من كانت لا تزال متابعة، نرجو منها تأكيد المتابعة بالضغط على الزر أدناه.\n` +
    `ولا تنسين التسبيح، وحمد الله، والصلاة والسلام على النبي محمد ﷺ.\n\n` +
    `بارك الله فيكن ونفع بكن.`,
  checkpointPosted: (label, number) => `✅ تم إرسال ${label} (${number}).`,
  checkpointLabelStart: 'افتتاح المجلس',
  checkpointLabelReminder: 'تذكير المتابعة',
  checkpointSummary: (session, names) => {
    const checkpoints = Array.isArray(session?.checkpoints) ? session.checkpoints : [];
    if (!checkpoints.length) {
      return '🕰️ *ملخص تأكيدات المتابعة*\n\nلم تُرسل نقاط متابعة خلال هذه الجلسة.';
    }

    const allNames = sortNamesAlphabetically(names || []);
    const confirmedSet = new Set();
    const detailLines = checkpoints.map((checkpoint, index) => {
      const count = Object.keys(checkpoint?.confirmations || {}).length;
      for (const name of Object.keys(checkpoint?.confirmations || {})) confirmedSet.add(name);
      const label = checkpoint?.kind === 'start' ? TEXT.checkpointLabelStart : TEXT.checkpointLabelReminder;
      return `• النقطة ${index + 1} — ${label}: ${count}`;
    });

    const confirmed = allNames.filter((name) => confirmedSet.has(name));
    const missing = allNames.filter((name) => !confirmedSet.has(name));

    let text = '🕰️ *ملخص تأكيدات المتابعة*\n\n';
    text += confirmed.length
      ? `✅ *أكدن مرة واحدة على الأقل (${confirmed.length}):*\n${confirmed.join('\n')}\n\n`
      : '✅ *أكدن مرة واحدة على الأقل (0):*\n—\n\n';
    text += missing.length
      ? `⏳ *لم يؤكدن أي نقطة متابعة (${missing.length}):*\n${missing.join('\n')}\n\n`
      : '⏳ *لم يؤكدن أي نقطة متابعة (0):*\n—\n\n';
    text += `📍 *تفصيل النقاط:*\n${detailLines.join('\n')}`;
    return text;
  },
  sessionClosingDua: `جزاكن الله خيراً يا غاليات، وبارك في هذا المجلس.\n\n` +
    `نسأل الله أن يتقبل منكن، وأن يجعل ما حضرتن وسمعتن في ميزان حسناتكن، وأن يرزقنا وإياكن الإخلاص والقبول.\n\n` +
    `*كفارة المجلس:*\n` +
    `سبحانك اللهم وبحمدك، أشهد أن لا إله إلا أنت، أستغفرك وأتوب إليك.`,
  registeredSelf: (a) => `✅ تمت إضافتك وتسجيلك كـ "${a}"`,
  membersHeader: (n) => `👥 *قائمة الأعضاء (${n}):*\n\n`,
  manageHeader: (name) => `⚙️ *إدارة الحضور – ${name}*\n\nانقر على عضو لتعديل حالته أو علّم أنه تم النداء عليه:\n\n`,
  memberOptionsHeader: (name) => `🔧 *إدارة العضو:*\n${name}`,
  managePickHeader: (name, e, called) => `⚙️ *تعديل حالة:* ${name}\nالحالة الحالية: ${e}\nحالة النداء: ${called === 'responding' ? '👉 جاري الرد' : called === 'responded' ? '✅ حاضرة' : called === 'away' ? '📣 كان بعيداً عن الميكروفون' : ''}\n\nاختر الحالة الجديدة أو حالة النداء:`,
  renamePrompt: (name) => `✏️ اكتب الاسم الجديد بدلاً من *${name}*:`,
  myIdInfo: '🪪 حياكِ الله، هذا رقم حسابك في تيليغرام. أرسلي السطر التالي للمشرفة لتضيفك بسهولة:',
  registerWidgetText: `📢 *طلب الانضمام لقائمة المسجلات*\n\nالسلام عليكن ورحمة الله وبركاته يا غاليات.\n\nللتسجيل يكفي أن تضغطي الزر أدناه مرة واحدة فقط.\n\nبعدها يصل طلبك إلى المشرفات، ثم يراجعن الطلب ويقبلنه أو يؤجلنه.\n\nإذا ظهر لك أن الطلب تم إرساله، فانتظري فقط ولا تحتاجين أي خطوة أخرى.`,
  registerWidgetButton: '📝 طلب التسجيل',
  registerWidgetCloseButton: '✕ إغلاق التسجيل',
  registerWidgetClosed: '✅ تم إغلاق رسالة التسجيل.',
  registerInGroupOnly: '⚠️ هذا الزر يعمل داخل المجموعة فقط يا غالية.',
  registerRequestSubmitted: '✅ تم إرسال طلب التسجيل بنجاح. انتظري مراجعة المشرفة، بارك الله فيكِ.',
  registerRequestUpdated: '✅ تم تحديث طلبك بنجاح، جزاكِ الله خيراً.',
  registerRequestAlreadyMember: 'ℹ️ أنتِ مسجّلة بالفعل في القائمة، حياكِ الله.',
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
  pendingStudentsHeader: (count) => `📝 *طلبات التسجيل المعلّقة (${count}):*`,
  pendingStudentsEmpty: '📝 لا توجد طلبات تسجيل معلّقة حالياً.',
  pendingStudentNotFound: '⚠️ طلب التسجيل هذا لم يعد موجوداً.',
  pendingStudentDismissConfirm: (name) => `⚠️ تأكيد تجاهل طلب *${name}*.`,
  pendingStudentDismissed: (name) => `🗑️ تم تجاهل طلب *${name}*.`,
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
  secondaryReport: (session) => {
    const verses = session.verses || {};
    const attendance = session.attendance || {};
    const present = Object.entries(attendance)
      .filter(([, status]) => status === 'present')
      .map(([name]) => [name, verses[name] || '—'])
      .sort((a, b) => compareArabic(a[0], b[0]));

    if (!present.length) {
      return `🧾 *تقرير حلقة تصحيح التلاوة "${session.name}":*\n\nلا توجد طالبات حاضرات.`;
    }

    const lines = present.map(([name, verse]) => `${name} — ${verse}`).join('\n');
    return `🧾 *تقرير حلقة تصحيح التلاوة "${session.name}" (${present.length} طالبة):*\n\n✅ *حاضرات:*
${lines}`;
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
    `السلام عليكن ورحمة الله وبركاته 👋 *بوت الحضور*\n\n` +
    `*للأعضاء*\n` +
    `/help – عرض المساعدة\n` +
    `الأفضل: اضغطي زر "طلب التسجيل" الذي ترسله المشرفة داخل المجموعة\n` +
    `/myid – خيار احتياطي لعرض رقم حسابك للتسجيل اليدوي\n` +
    `` +
    (admin
      ? `\n\n*للمشرف*\n` +
        `\n*إدارة الحلقة*\n` +
        `/status – ملخص حضور الحلقة الحالية\n` +
        `/startlist [اسم] – بدء قائمة للحلقة الرئيسية للمسجلات\n` +
        `/startopenlist [اسم] – بدء قائمة مفتوحة لأي طالبة\n` +
        `/startsecondarylist [اسم] – بدء قائمة للحلقات الثانوية (تصحيح التلاوة) للمسجلات\n` +
        `/startpersonalrecitation [اسم] – بدء ختمة فردية وتعيين صفحات تلقائياً\n` +
        `/startgrouprecitation [اسم] – بدء ختمة جماعية متسلسلة (صفحة واحدة لكل حاضرة)\n` +
        `/lessonstart – إرسال رسالة افتتاح المجلس مع تأكيد الحضور\n` +
        `/startless – نفس أمر /lessonstart بشكل مختصر\n` +
        `/lessonreminder – إرسال نقطة متابعة جديدة أثناء المجلس\n` +
        `/freezelist – تجميد تسجيل الحضور في القائمة\n` +
        `/editlist – تعديل حالات الحضور بشكل فردي\n` +
        `/stoplist – إنهاء الحلقة\n` +
        `\n*إدارة الطالبات*\n` +
        `/students – إدارة قائمة طالبات المجموعة الخاصة (الطريقة الموصى بها)\n` +
        `/register – إرسال رسالة فيها زر "طلب التسجيل"\n` +
        `/pendingstudents – مراجعة طلبات التسجيل وقبولها أو تجاهلها\n` +
        `/addstudent [معرّف] | [اسم] – إضافة طالبة أو أكثر\n` +
        `/removestudent [اسم أو معرّف] – حذف احتياطي لطالبة أو أكثر\n` +
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
        `/studentshistory [دورة] – سجل الطالبات حسب الدورة\n` +
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
  historyLine: (name, p, l, x, ab, verse = '—') =>
    `${name}\n  ✅ ${p} حاضرة | 👂 ${l} مستمعة | 🔔 ${x} معتذرة | ❌ ${ab} غياب\n  🧾 آخر آية: ${verse}`,
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
};


export const st = (key) => (key && TEXT.attendance[key]) || TEXT.attendance.pending;
