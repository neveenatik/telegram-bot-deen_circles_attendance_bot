import { TEXT } from '../../text.js';
import { replyEphemeral } from '../../helpers.js';

export function register(bot) {
  const feedbackGroupId = process.env.FEEDBACK_GROUP_ID;

  // Log missing feedback group on startup
  if (!feedbackGroupId) {
    console.warn('⚠️ FEEDBACK_GROUP_ID environment variable is not set. /feedback command will not work.');
  }

  bot.command('feedback', async (ctx) => {
    if (!feedbackGroupId) {
      console.error('❌ /feedback attempt: FEEDBACK_GROUP_ID is not configured');
      return replyEphemeral(ctx, TEXT.contactNotConfigured);
    }

    const userMessage = ctx.message.text.split(' ').slice(1).join(' ').trim();
    
    if (!userMessage) {
      return ctx.replyWithMarkdown(TEXT.feedbackUsageHelp);
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

      replyEphemeral(ctx, TEXT.feedbackThankYou);
    } catch (error) {
      console.error('❌ Failed to send feedback:', {
        error: error.message,
        code: error.code,
        description: error.description,
        groupId: feedbackGroupId ? '***' : 'NOT_SET'
      });
      replyEphemeral(ctx, TEXT.feedbackError);
    }
  });
}
