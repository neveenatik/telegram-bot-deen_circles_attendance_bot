// One-off helper to register Telegram command menu/autocomplete.
// Run: npm run set-commands
import 'dotenv/config';
import { Telegraf } from 'telegraf';

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
  { command: 'startpagelist', description: 'بدء قائمة ختمة فردية وتعيين صفحات تلقائي (للمشرف)' },
  { command: 'startgrouprecitation', description: 'بدء ختمة جماعية مع حفظ الصفحة (للمشرف)' },
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

  try {
    // Direct messages / private chats
    await bot.telegram.setMyCommands(commands, { scope: { type: 'default' } });
    console.log('✅ Commands registered for direct messages (default scope)');

    // All group chats (groups and supergroups)
    await bot.telegram.setMyCommands(commands, { scope: { type: 'all_group_chats' } });
    console.log('✅ Commands registered for all group chats');

    // Group administrators
    await bot.telegram.setMyCommands(commands, { scope: { type: 'all_chat_administrators' } });
    console.log('✅ Commands registered for group administrators');

    // Arabic command menu label where supported
    await bot.telegram.setChatMenuButton({ menu_button: { type: 'commands' } }).catch(() => {});
    console.log('✅ Command menu button set');

    console.log('\n✅ All command scopes registered successfully!');
    console.log('   - Direct messages (default)');
    console.log('   - All group chats');
    console.log('   - Group administrators');
  } catch (err) {
    console.error('❌ Error registering commands:', err.message);
    process.exit(1);
  }
})();
