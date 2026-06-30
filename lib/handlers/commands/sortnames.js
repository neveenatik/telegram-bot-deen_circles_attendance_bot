import { isAdmin } from '../../guards.js';
import { sortArabic } from '../../helpers.js';
import { TEXT } from '../../text.js';

export function register(bot) {
  bot.command('sortnames', async (ctx) => {
    if (!await isAdmin(ctx)) return ctx.reply(TEXT.adminOnly);

    const raw = ctx.message.text.split(' ').slice(1).join(' ').trim();
    if (!raw) return ctx.reply(TEXT.invalidSortNamesFormat);
    const hadNumbering = /^\s*[\d٠-٩]+\s*[-.)]\s*/m.test(raw);
    const numberingSep = (raw.match(/^\s*[\d٠-٩]+\s*([-.)])\s*/m) || [])[1] || '-';

    const names = raw
      .split(/\s*[|,\n]\s*/)
      .map((s) => s.replace(/^\s*[\d٠-٩]+\s*[-.)]\s*/, '').trim())
      .filter(Boolean);

    if (!names.length) return ctx.reply(TEXT.invalidSortNamesFormat);

    const sorted = sortArabic(names);
    const out = hadNumbering
      ? sorted.map((name, i) => `${i + 1}${numberingSep} ${name}`).join('\n')
      : sorted.join('\n');
    return ctx.reply(`${TEXT.sortedNamesHeader(sorted.length)}\n${out}`);
  });
}
