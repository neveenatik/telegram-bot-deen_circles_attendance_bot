export function sessionSeries(s) {
  return Number.isInteger(s?.seriesId) && s.seriesId > 0 ? s.seriesId : 1;
}

export function sessionsInSeries(sessions, seriesId) {
  return sessions.filter((s) => sessionSeries(s) === seriesId);
}

export function archivedSessionKey(s) {
  return [
    sessionSeries(s),
    String(s?.type || ''),
    String(s?.name || ''),
    String(s?.startedAt || ''),
    String(s?.endedAt || ''),
  ].join('|');
}

export function parseSeriesArg(rawText, fallbackSeries) {
  const arg = String(rawText || '').split(' ').slice(1).join(' ').trim();
  if (!arg) return { ok: true, series: fallbackSeries };
  const series = parseInt(arg, 10);
  if (!Number.isInteger(series) || series < 1) return { ok: false, series: null };
  return { ok: true, series };
}

export function clampButtonLabel(input, maxLen = 56) {
  const text = String(input || '').trim();
  if (text.length <= maxLen) return text;
  return `${text.slice(0, Math.max(0, maxLen - 3)).trim()}...`;
}
