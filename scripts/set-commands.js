// One-off helper to register Telegram command menu/autocomplete.
// Run: npm run set-commands
require('dotenv').config();
const { Telegraf } = require('telegraf');

const commands = [
  { command: 'start', description: 'عرض رسالة الترحيب (للمشرف)' },
  { command: 'help', description: 'عرض قائمة الأوامر' },
  { command: 'myid', description: 'عرض معرف حسابك' },
  { command: 'status', description: 'ملخص حالة الجلسة الحالية (للمشرف)' },
  { command: 'students', description: 'إدارة قائمة الطالبات (للمشرف)' },
  { command: 'registerinfo', description: 'شرح طريقة التسجيل (للمشرف)' },
  { command: 'sortnames', description: 'ترتيب قائمة أسماء أبجدياً (للمشرف)' },
  { command: 'addstudent', description: 'إضافة طالبة (للمشرف)' },
  { command: 'removestudent', description: 'حذف طالبة (للمشرف)' },
  { command: 'renamestudent', description: 'تعديل اسم طالبة (للمشرف)' },
  { command: 'startlist', description: 'بدء قائمة مفتوحة (للمشرف)' },
  { command: 'startregisteredlist', description: 'بدء قائمة للمسجلات (للمشرف)' },
  { command: 'stopregistration', description: 'إيقاف تسجيل الحضور (للمشرف)' },
  { command: 'newclass', description: 'مسح تاريخ الحضور والبدء بدورة جديدة (لمنشئ المجموعة)' },
  { command: 'classhistory', description: 'عرض سجلات الدورة الحالية مع رقم كل حلقة (للمشرف)' },
  { command: 'removeclassrecord', description: 'حذف سجل حلقة من الدورة الحالية (بتأكيد، لمنشئ المجموعة)' },
  { command: 'removestudentrecord', description: 'حذف سجل طالبة من سجل الدورة الحالية (بتأكيد، لمنشئ المجموعة)' },
  { command: 'stoplist', description: 'إنهاء الحلقة الحالية (للمشرف)' },
  { command: 'editlist', description: 'تعديل حالات الحضور (للمشرف)' },
  { command: 'studentshistory', description: 'عرض سجل الجلسات (للمشرف)' },
];

(async () => {
  if (!process.env.BOT_TOKEN) {
    console.error('BOT_TOKEN is missing in environment variables.');
    process.exit(1);
  }

  const bot = new Telegraf(process.env.BOT_TOKEN);

  // Default scope (private chats)
  await bot.telegram.setMyCommands(commands, { scope: { type: 'default' } });

  // Group/supergroup scope so slash-menu works in groups as well.
  await bot.telegram.setMyCommands(commands, { scope: { type: 'all_group_chats' } });

  // Arabic command menu label where supported.
  await bot.telegram.setChatMenuButton({ menu_button: { type: 'commands' } }).catch(() => {});

  console.log('Telegram commands menu registered for default + all_group_chats scopes.');
})();
