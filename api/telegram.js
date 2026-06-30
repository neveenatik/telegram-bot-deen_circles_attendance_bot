// Vercel serverless webhook endpoint for Telegram.
// Telegram POSTs updates here; we hand each one to the bot.
import bot from '../index.js';

export default async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(200).send('Attendance bot webhook is up.');
  }
  // Optional shared-secret check (set the same value when registering the webhook).
  const secret = process.env.WEBHOOK_SECRET;
  if (secret && req.headers['x-telegram-bot-api-secret-token'] !== secret) {
    return res.status(401).send('unauthorized');
  }
  try {
    await bot.handleUpdate(req.body);
  } catch (e) {
    console.error('handleUpdate error:', e?.message);
  }
  res.status(200).send('ok');
};
