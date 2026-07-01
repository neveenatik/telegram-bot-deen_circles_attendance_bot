import { TEXT } from '../../text.js';

export function register(bot) {
  const feedbackGroupId = process.env.FEEDBACK_GROUP_ID;

  // Log missing feedback group on startup
  if (!feedbackGroupId) {
    console.warn('⚠️ FEEDBACK_GROUP_ID environment variable is not set. /contact command will not work.');
  }

  bot.command('contact', async (ctx) => {
    if (!feedbackGroupId) {
      console.error('❌ /contact attempt: FEEDBACK_GROUP_ID is not configured');
      return ctx.reply(TEXT.contactNotConfigured);
    }

    const userMessage = ctx.message.text.split(' ').slice(1).join(' ').trim();
    
    if (!userMessage) {
      return ctx.replyWithMarkdown(TEXT.contactUsageHelp);
    }

    try {
      // Send anonymous feedback with timestamp only
      const timestamp = new Date().toLocaleString('ar-SA', {
        timeZone: 'Asia/Riyadh',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });

      const feedbackMessage = `💬 *تقرير مجهول الهوية*\n_${timestamp}_\n\n${userMessage}`;
      
      await bot.telegram.sendMessage(feedbackGroupId, feedbackMessage, {
        parse_mode: 'Markdown'
      });

      ctx.reply(TEXT.contactThankYou);
    } catch (error) {
      console.error('❌ Failed to send feedback:', {
        error: error.message,
        code: error.code,
        description: error.description,
        groupId: feedbackGroupId ? '***' : 'NOT_SET'
      });
      // User gets generic error message, no technical details leaked
      ctx.reply(TEXT.contactError);
    }
  });
}
