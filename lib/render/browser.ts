// Headless-browser lifecycle for image rendering.
//
// We render images with a real Chromium so Arabic RTL shaping, bidi and
// per-glyph font fallback all come from the browser's own layout engine
// (Satori could not do this reliably). On Vercel we use @sparticuz/chromium's
// Linux binary; locally we point at the system Chrome (the bundled binary is
// Linux-only). A single browser instance is cached and reused across warm
// serverless invocations.
import { existsSync } from 'node:fs';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import type { Browser } from 'puppeteer-core';

let browserPromise: Promise<Browser> | null = null;

function isServerless(): boolean {
  return Boolean(
    process.env.VERCEL ||
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.AWS_EXECUTION_ENV,
  );
}

const LOCAL_CHROME_CANDIDATES: string[] = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter((p): p is string => Boolean(p));

// Path to a usable local Chrome/Chromium, or null when none is installed
// (lets callers/tests skip browser rendering gracefully).
export function localChromePath(): string | null {
  return LOCAL_CHROME_CANDIDATES.find((p) => existsSync(p)) ?? null;
}

async function launch(): Promise<Browser> {
  if (isServerless()) {
    // @sparticuz/chromium ships only Open Sans (no Arabic); templates embed
    // their own Arabic font via @font-face, so the missing system font is fine.
    chromium.setGraphicsMode = false;
    return puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: 'shell',
    });
  }
  const executablePath = localChromePath();
  if (!executablePath) {
    throw new Error(
      'No local Chrome/Chromium found. Set PUPPETEER_EXECUTABLE_PATH to a Chrome binary.',
    );
  }
  return puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
}

// Launch (or reuse) a cached browser. Re-launches transparently if a cached
// instance has disconnected.
export async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = launch().catch((err) => {
      browserPromise = null;
      throw err;
    });
  }
  const browser = await browserPromise;
  if (!browser.connected) {
    browserPromise = null;
    return getBrowser();
  }
  return browser;
}

// Close the cached browser (used by tests; serverless keeps it warm).
export async function closeBrowser(): Promise<void> {
  if (!browserPromise) return;
  const pending = browserPromise;
  browserPromise = null;
  try {
    const browser = await pending;
    await browser.close();
  } catch {
    // Already gone / failed to launch — nothing to close.
  }
}
