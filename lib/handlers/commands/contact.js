import { TEXT } from '../../text.js';
import { replyEphemeral } from '../../helpers.js';

const pendingContactInputs = new Set();

function keyFromCtx(ctx) {
  return `${ctx.chat?.id}:${ctx.from?.id}`;
}

export function register(bot) {
  const feedbackGroupId = process.env.FEEDBACK_GROUP_ID;

  // Log missing feedback group on startup
  if (!feedbackGroupId) {
    console.warn('⚠️ FEEDBACK_GROUP_ID environment variable is not set. /contact command will not work.');
  }

  async function forwardContact(ctx, userMessage) {
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

      replyEphemeral(ctx, TEXT.contactThankYou);
    } catch (error) {
      console.error('❌ Failed to send feedback:', {
        error: error.message,
        code: error.code,
        description: error.description,
        groupId: feedbackGroupId ? '***' : 'NOT_SET'
      });
      // User gets generic error message, no technical details leaked
      replyEphemeral(ctx, TEXT.contactError);
    }
  }

  bot.command('contact', async (ctx) => {
    if (!feedbackGroupId) {
      console.error('❌ /contact attempt: FEEDBACK_GROUP_ID is not configured');
      return replyEphemeral(ctx, TEXT.contactNotConfigured);
    }

    const userMessage = ctx.message.text.split(' ').slice(1).join(' ').trim();
    
    if (!userMessage) {
      pendingContactInputs.add(keyFromCtx(ctx));
      return replyEphemeral(ctx, '✍️ أرسلي رسالتك الآن في رسالة واحدة، أو اكتبي "إلغاء" للإلغاء.');
    }

    return forwardContact(ctx, userMessage);
  });

  bot.on('text', async (ctx, next) => {
    const key = keyFromCtx(ctx);
    if (!pendingContactInputs.has(key)) return next();

    const text = String(ctx.message?.text || '').trim();
    if (!text || text.startsWith('/')) return next();

    pendingContactInputs.delete(key);
    if (text.toLowerCase() === 'cancel' || text === 'إلغاء') {
      return replyEphemeral(ctx, 'تم الإلغاء.');
    }

    return forwardContact(ctx, text);
  });
}
