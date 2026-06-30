import 'dotenv/config';

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.');
    process.exit(1);
  }

  const base = `${url.replace(/\/$/, '')}/rest/v1/kv`;
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
  };

  const countRows = async () => {
    const res = await fetch(`${base}?select=key`, {
      method: 'HEAD',
      headers: {
        ...headers,
        Prefer: 'count=exact',
      },
    });

    if (!res.ok) {
      throw new Error(`Count request failed: ${res.status}`);
    }

    const contentRange = res.headers.get('content-range') || '*/0';
    const total = Number(contentRange.split('/')[1] || '0');
    return Number.isFinite(total) ? total : 0;
  };

  const before = await countRows();
  const shouldDelete = process.argv.includes('--yes');

  if (!shouldDelete) {
    console.log(`kv rows currently: ${before}`);
    console.log('Dry run only. To delete all kv rows, run: npm run clear-kv');
    return;
  }

  const del = await fetch(`${base}?key=not.is.null`, {
    method: 'DELETE',
    headers,
  });

  if (!del.ok) {
    throw new Error(`Delete request failed: ${del.status}`);
  }

  const after = await countRows();
  console.log(`kv rows before: ${before}`);
  console.log(`kv rows after: ${after}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
