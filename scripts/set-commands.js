// One-off helper to register Telegram command menu/autocomplete.
// Run: npm run set-commands
import 'dotenv/config';
import { Telegraf } from 'telegraf';

const commands = [
  { command: 'start', description: 'عرض رسالة الترحيب (للمشرف)' },
  { command: 'help', description: 'عرض قائمة الأوامر' },
  { command: 'myid', description: 'عرض رقم حسابك للتسجيل اليدوي' },

  // Session management
  { command: 'status', description: 'ملخص حالة الجلسة الحالية (للمشرف)' },
  { command: 'startlist', description: 'بدء قائمة للحلقة الرئيسية للمسجلات (للمشرف)' },
  { command: 'startopenlist', description: 'بدء قائمة مفتوحة لأي طالبة (للمشرف)' },
  { command: 'startsecondarylist', description: 'بدء قائمة للحلقات الثانوية (تصحيح التلاوة) للمسجلات (للمشرف)' },
  { command: 'startpersonalrecitation', description: 'بدء ختمة فردية وتعيين صفحات تلقائي (للمشرف)' },
  { command: 'startgrouprecitation', description: 'بدء ختمة جماعية متسلسلة (للمشرف)' },
  { command: 'lessonstart', description: 'رسالة افتتاح المجلس مع تأكيد الحضور (للمشرف)' },
  { command: 'startless', description: 'نفس أمر lessonstart بشكل مختصر (للمشرف)' },
  { command: 'lessonreminder', description: 'إرسال نقطة متابعة أثناء المجلس (للمشرف)' },
  { command: 'freezelist', description: 'تجميد تسجيل الحضور (للمشرف)' },
  { command: 'editlist', description: 'تعديل حالات الحضور (للمشرف)' },
  { command: 'stoplist', description: 'إنهاء الحلقة الحالية (للمشرف)' },

  // Student management
  { command: 'students', description: 'إدارة قائمة الطالبات (الطريقة الموصى بها) (للمشرف)' },
  { command: 'register', description: 'إرسال رسالة فيها زر طلب التسجيل (للمشرف)' },
  { command: 'pendingstudents', description: 'مراجعة طلبات التسجيل وقبولها أو تجاهلها (للمشرف)' },
  { command: 'addstudent', description: 'إضافة طالبة أو أكثر (للمشرف)' },
  { command: 'removestudent', description: 'حذف احتياطي لطالبة أو أكثر (اسم/رقم حساب) (للمشرف)' },
  { command: 'removestudents', description: 'حذف جميع الطالبات المسجلات (لمنشئ المجموعة)' },
  { command: 'renamestudent', description: 'تعديل اسم طالبة أو أكثر (للمشرف)' },
  { command: 'tagstudents', description: 'الإشارة إلى جميع الطالبات المسجلات للإعلان (للمشرف)' },

  // Teacher management
  { command: 'addteacher', description: 'إضافة معلمة أو أكثر (للمشرف)' },
  { command: 'addteacherreply', description: 'إضافة معلمة بالرد على رسالتها مباشرة (للمشرف)' },
  { command: 'assignteacher', description: 'تغيير نوع معلمة أو أكثر (للمشرف)' },
  { command: 'listteachers', description: 'عرض قائمة المعلمات (للمشرف)' },
  { command: 'removeteacher', description: 'حذف معلمة أو أكثر (للمشرف)' },
  { command: 'tagteachers', description: 'الإشارة إلى المعلمات حسب النوع للإعلان (للمشرف)' },

  // History and lifecycle
  { command: 'newclass', description: 'بدء دورة جديدة مع حفظ السجلات السابقة (لمنشئ المجموعة)' },
  { command: 'classhistory', description: 'عرض سجلات الدورة (الحالية افتراضياً أو محددة) (للمشرف)' },
  { command: 'studentshistory', description: 'عرض سجل الجلسات (للمشرف)' },
  { command: 'removeclassrecord', description: 'حذف سجل حلقة من الدورة الحالية (لمنشئ المجموعة)' },
  { command: 'removestudentrecord', description: 'حذف سجل طالبة من الدورة الحالية (لمنشئ المجموعة)' },

  // Utilities
  { command: 'sortnames', description: 'ترتيب أسماء (فوري أو start/add/done) (للمشرف)' },
  { command: 'feedback', description: 'الإبلاغ عن المشاكل والاقتراحات (مجهول الهوية)' },
];

(async () => {
  if (!process.env.BOT_TOKEN) {
    console.error(JSON.stringify({
      level: 'error',
      event: 'set_commands_missing_bot_token',
      message: 'BOT_TOKEN is missing in environment variables.',
      at: new Date().toISOString(),
    }));
    process.exit(1);
  }

  const bot = new Telegraf(process.env.BOT_TOKEN);
  const hiddenCommands = [];

  try {
    // Hide command menu for users outside administrator scope.
    await bot.telegram.setMyCommands(hiddenCommands, { scope: { type: 'default' } });
    console.log('✅ Commands cleared for default scope');

    // Hide command menu for non-admin members in group chats.
    await bot.telegram.setMyCommands(hiddenCommands, { scope: { type: 'all_group_chats' } });
    console.log('✅ Commands cleared for all group chats');

    // Expose command menu only to group administrators.
    await bot.telegram.setMyCommands(commands, { scope: { type: 'all_chat_administrators' } });
    console.log('✅ Commands registered for group administrators');

    // Arabic command menu label where supported
    await bot.telegram.setChatMenuButton({ menu_button: { type: 'commands' } }).catch((err) => {
      console.warn(JSON.stringify({
        level: 'warn',
        event: 'set_commands_menu_button_failed',
        message: err?.message || String(err),
        at: new Date().toISOString(),
      }));
    });
    console.log('✅ Command menu button set');

    console.log('\n✅ All command scopes registered successfully!');
    console.log('   - Default scope hidden');
    console.log('   - All group chats hidden for non-admins');
    console.log('   - Group administrators visible');
  } catch (err) {
    console.error(JSON.stringify({
      level: 'error',
      event: 'set_commands_register_failed',
      message: err?.message || String(err),
      at: new Date().toISOString(),
    }));
    process.exit(1);
  }
})();
