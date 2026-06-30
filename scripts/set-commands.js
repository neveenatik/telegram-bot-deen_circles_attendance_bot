// One-off helper to register Telegram command menu/autocomplete.
// Run: npm run set-commands
require('dotenv').config();
const { Telegraf } = require('telegraf');

const commands = [
  { command: 'start', description: 'عرض رسالة الترحيب' },
  { command: 'help', description: 'عرض قائمة الأوامر' },
  { command: 'myid', description: 'عرض معرف حسابك' },
  { command: 'status', description: 'ملخص حالة الجلسة الحالية (للمشرف)' },
  { command: 'members', description: 'إدارة قائمة الأعضاء (للمشرف)' },
  { command: 'registerinfo', description: 'شرح طريقة التسجيل (للمشرف)' },
  { command: 'addmember', description: 'إضافة عضو (للمشرف)' },
  { command: 'removemember', description: 'حذف عضو (للمشرف)' },
  { command: 'renamemember', description: 'تعديل اسم عضو (للمشرف)' },
  { command: 'startsession', description: 'بدء جلسة للمسجلات (للمشرف)' },
  { command: 'startopensession', description: 'بدء جلسة مفتوحة (للمشرف)' },
  { command: 'stopregistration', description: 'إيقاف تسجيل الحضور (للمشرف)' },
  { command: 'endsession', description: 'إنهاء الجلسة الحالية (للمشرف)' },
  { command: 'sessionmanage', description: 'تعديل حالات الحضور (للمشرف)' },
  { command: 'history', description: 'عرض سجل الجلسات (للمشرف)' },
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
