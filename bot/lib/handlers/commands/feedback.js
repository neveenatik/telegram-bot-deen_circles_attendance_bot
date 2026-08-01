import { TEXT } from '../../text.js';
import { getErrorDescription, replyEphemeral } from '../../helpers.js';

const pendingFeedbackInputs = new Set();

function keyFromCtx(ctx) {
  return `${ctx.chat?.id}:${ctx.from?.id}`;
}

export function createHandlers({ telegram }) {
  const feedbackGroupId = process.env.FEEDBACK_GROUP_ID;

  // Log missing feedback group on startup
  if (!feedbackGroupId) {
    console.warn(JSON.stringify({
      level: 'warn',
      event: 'feedback_group_not_configured',
      message: 'FEEDBACK_GROUP_ID environment variable is not set. /feedback command will not work.',
      at: new Date().toISOString(),
    }));
  }

  async function forwardFeedback(ctx, userMessage) {
    try {
      // Anonymous feedback has no class/group context, so stamp it in UTC — a
      // neutral, unambiguous reference for whoever reads the feedback inbox.
      const timestamp = new Date().toLocaleString('ar-EG', {
        timeZone: 'UTC',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });

      const feedbackMessage = `💬 *تقرير مجهول الهوية*\n_${timestamp} UTC_\n\n${userMessage}`;

      await telegram.sendMessage(feedbackGroupId, feedbackMessage, {
        parse_mode: 'Markdown'
      });

      replyEphemeral(ctx, TEXT.feedbackThankYou);
    } catch (error) {
      console.error(JSON.stringify({
        level: 'error',
        event: 'feedback_forward_failed',
        message: getErrorDescription(error),
        code: error?.code || null,
        description: error?.description || null,
        groupConfigured: Boolean(feedbackGroupId),
        chatId: ctx?.chat?.id ? String(ctx.chat.id) : null,
        userId: ctx?.from?.id ? String(ctx.from.id) : null,
        at: new Date().toISOString(),
      }));
      replyEphemeral(ctx, TEXT.feedbackError);
    }
  }

  async function feedback(ctx) {
    if (!feedbackGroupId) {
      console.error(JSON.stringify({
        level: 'error',
        event: 'feedback_command_rejected_not_configured',
        message: 'FEEDBACK_GROUP_ID is not configured',
        chatId: ctx?.chat?.id ? String(ctx.chat.id) : null,
        userId: ctx?.from?.id ? String(ctx.from.id) : null,
        at: new Date().toISOString(),
      }));
      return replyEphemeral(ctx, TEXT.contactNotConfigured);
    }

    const userMessage = ctx.message.text.split(' ').slice(1).join(' ').trim();

    if (!userMessage) {
      pendingFeedbackInputs.add(keyFromCtx(ctx));
      return replyEphemeral(ctx, '✍️ اكتبي رسالتك الآن في رسالة واحدة. وللإلغاء اكتبي: إلغاء');
    }

    return forwardFeedback(ctx, userMessage);
  }

  async function onText(ctx, next) {
    const key = keyFromCtx(ctx);
    if (!pendingFeedbackInputs.has(key)) return next();

    const text = String(ctx.message?.text || '').trim();
    if (!text || text.startsWith('/')) return next();

    pendingFeedbackInputs.delete(key);
    if (text.toLowerCase() === 'cancel' || text === 'إلغاء') {
      return replyEphemeral(ctx, '✅ تم الإلغاء.');
    }

    return forwardFeedback(ctx, text);
  }

  return { feedback, onText };
}

export function register(bot) {
  const h = createHandlers({ telegram: bot.telegram });
  bot.command('feedback', h.feedback);
  bot.on('text', h.onText);
}
