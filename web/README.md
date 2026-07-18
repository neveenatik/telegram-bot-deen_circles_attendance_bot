# Deen Circles — Web

Marketing / documentation site for the **Qur'an circle attendance bot**, built
with **Next.js (App Router)**, **next-intl** (Arabic default + English) and
**Tailwind CSS v4**.

This is a self-contained sub-project. It has its own `package.json` and
lockfile and is deployed as a **separate Vercel project** so it never touches
the bot's serverless webhook (`../api/telegram.js`).

## Develop

```bash
cd web
npm install
npm run dev      # http://localhost:3000 → redirects to /ar
```

Other scripts: `npm run build`, `npm start`, `npm run lint`.

## Structure

```
app/[locale]/        # locale-segmented pages (layout sets lang + dir)
components/           # Header, Hero, Features, ChatDemo, Developers, Footer
i18n/                # next-intl routing, navigation, request config
messages/            # ar.json (default, RTL) + en.json
lib/site.ts          # external links (GitHub, README raw, bot URL)
proxy.ts             # next-intl locale middleware (Next 16 name for middleware)
```

- **Localisation:** `ar` is the default locale (RTL); `en` is the fallback.
  Switch languages via the header toggle. Add strings to `messages/*.json`.
- **Chat demo:** a scripted, simulated Telegram conversation (no live bot).
  The script lives under `demo.script` in each `messages/*.json`.
- **Developers section:** fetches the repo `README.md` (public) at build time
  and renders it with `react-markdown`. Update the links in `lib/site.ts`
  (set `BOT_URL` to your bot's public handle).

## Deploy (Vercel)

Create a **new Vercel project** and set **Root Directory** to `web`. Next.js is
auto-detected; no extra config is required.
