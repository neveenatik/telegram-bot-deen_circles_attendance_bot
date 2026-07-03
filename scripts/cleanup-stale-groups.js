import 'dotenv/config';
import storage from '../lib/storage.js';

function parseDaysArg() {
  const raw = process.argv.find((arg) => arg.startsWith('--days='));
  if (!raw) return 90;
  const days = Number(raw.split('=')[1]);
  return Number.isFinite(days) && days > 0 ? days : 90;
}

async function main() {
  const days = parseDaysArg();
  const shouldDelete = process.argv.includes('--yes');
  const cutoffDate = new Date(Date.now() - (days * 24 * 60 * 60 * 1000));
  const inactive = await storage.listInactiveGroups(cutoffDate.toISOString());

  if (!inactive.length) {
    console.log(`No groups inactive for ${days} days or more.`);
    return;
  }

  console.log(`Found ${inactive.length} inactive group(s) older than ${days} days:`);
  for (const row of inactive) {
    console.log(`- ${row.groupId} | last activity: ${row.lastActivityAt}`);
  }

  if (!shouldDelete) {
    console.log('Dry run only. To delete them, run: npm run cleanup-stale-groups -- --yes');
    console.log('Optional: change threshold with --days=30');
    return;
  }

  for (const row of inactive) {
    await storage.clearGroupData(row.groupId);
  }

  console.log(`Deleted data for ${inactive.length} inactive group(s).`);
}

main().catch((err) => {
  console.error(JSON.stringify({
    level: 'error',
    event: 'cleanup_stale_groups_unhandled_error',
    message: err?.message || String(err),
    at: new Date().toISOString(),
  }));
  process.exit(1);
});
