// One-off helper to register/unregister the Telegram webhook.
//   node scripts/set-webhook.js https://<your-app>.vercel.app/api/telegram
//   node scripts/set-webhook.js delete
require('dotenv').config();
const { Telegraf } = require('telegraf');

(async () => {
  const bot = new Telegraf(process.env.BOT_TOKEN);
  const arg = process.argv[2];
  if (!arg) { console.error('Usage: node scripts/set-webhook.js <url|delete>'); process.exit(1); }
  if (arg === 'delete') {
    await bot.telegram.deleteWebhook();
    console.log('Webhook deleted (back to polling).');
  } else {
    await bot.telegram.setWebhook(arg, {
      secret_token: process.env.WEBHOOK_SECRET || undefined,
    });
    console.log('Webhook set to', arg);
  }
})();
