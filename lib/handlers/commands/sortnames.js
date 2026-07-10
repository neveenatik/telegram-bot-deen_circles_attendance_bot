import { isAdmin } from '../../guards.js';
import { sortArabic, replyEphemeral } from '../../helpers.js';
import { TEXT } from '../../text.js';

const pendingSortInputs = new Map();

function parseNamesChunk(raw) {
  const hadNumbering = /^\s*[\d٠-٩]+\s*[-.)]\s*/m.test(raw);
  const numberingSep = (raw.match(/^\s*[\d٠-٩]+\s*([-.)])\s*/m) || [])[1] || '-';
  const names = raw
    .split(/\s*[|,\n]\s*/)
    .map((s) => s.replace(/^\s*[\d٠-٩]+\s*[-.)]\s*/, '').trim())
    .filter(Boolean);

  return { names, hadNumbering, numberingSep };
}

function userKey(ctx) {
  return `${ctx.chat.id}:${ctx.from.id}`;
}

async function sendSorted(ctx, names, hadNumbering, numberingSep) {
  const sorted = sortArabic(names);
  const outLines = hadNumbering
    ? sorted.map((name, i) => `${i + 1}${numberingSep} ${name}`)
    : sorted;

  const header = TEXT.sortedNamesHeader(sorted.length);
  let chunk = '';
  let first = true;

  for (const line of outLines) {
    const next = chunk ? `${chunk}\n${line}` : line;
    if (next.length > 3500 && chunk) {
      await ctx.reply(`${first ? header : TEXT.sortedNamesContinue}\n${chunk}`);
      first = false;
      chunk = line;
    } else {
      chunk = next;
    }
  }

  if (chunk) {
    await ctx.reply(`${first ? header : TEXT.sortedNamesContinue}\n${chunk}`);
  }
}

export function createHandlers() {
  async function sortnames(ctx) {
    if (!await isAdmin(ctx)) return replyEphemeral(ctx, TEXT.adminOnly);

    const raw = ctx.message.text.split(' ').slice(1).join(' ').trim();
    const key = userKey(ctx);
    const pending = pendingSortInputs.get(key);

    if (!raw || raw.toLowerCase() === 'start') {
      pendingSortInputs.set(key, { names: [], hadNumbering: false, numberingSep: '-' });
      return replyEphemeral(ctx, TEXT.sortnamesStartCollect);
    }

    if (raw.toLowerCase() === 'cancel') {
      if (!pending) return replyEphemeral(ctx, TEXT.sortnamesNoPendingCollect);
      pendingSortInputs.delete(key);
      return replyEphemeral(ctx, TEXT.sortnamesCollectCancelled);
    }

    if (raw.toLowerCase() === 'done') {
      if (!pending || !pending.names.length) return replyEphemeral(ctx, TEXT.sortnamesNoPendingCollect);
      pendingSortInputs.delete(key);
      await sendSorted(ctx, pending.names, pending.hadNumbering, pending.numberingSep);
      return;
    }

    const addPrefix = /^add(?:\s+|$)/i;
    const chunkRaw = raw.match(addPrefix) ? raw.replace(addPrefix, '').trim() : raw;

    if (pending) {
      const chunk = parseNamesChunk(chunkRaw);
      if (!chunk.names.length) return replyEphemeral(ctx, TEXT.sortnamesEmptyChunk);

      pending.names.push(...chunk.names);
      pending.hadNumbering = pending.hadNumbering || chunk.hadNumbering;
      if (chunk.hadNumbering && pending.numberingSep === '-') {
        pending.numberingSep = chunk.numberingSep;
      }
      pendingSortInputs.set(key, pending);
      return replyEphemeral(ctx, TEXT.sortnamesChunkAdded(chunk.names.length, pending.names.length));
    }

    const parsed = parseNamesChunk(chunkRaw);
    if (!parsed.names.length) return replyEphemeral(ctx, TEXT.invalidSortNamesFormat);
    await sendSorted(ctx, parsed.names, parsed.hadNumbering, parsed.numberingSep);
  }

  return { sortnames };
}

export function register(bot) {
  const h = createHandlers();
  bot.command('sortnames', h.sortnames);
}
