// Reusable image-render engine: HTML string -> PNG buffer via headless Chrome.
//
// Templates produce a full HTML document (see templates/*.ts); this module is
// intentionally generic so it can serve roster images today and certificates
// later. Rendering an element with id="root" crops the screenshot to that
// element's natural size, so callers control height purely with CSS.
import { getBrowser } from './browser.js';

export interface RenderOptions {
  // Logical width in CSS pixels (the #root element should be this wide).
  width: number;
  // Optional fixed height; omit to let the #root element size itself.
  height?: number;
  // Device scale factor for crisp output (defaults to 2 = retina).
  scale?: number;
}

export async function renderHtmlToPng(
  html: string,
  opts: RenderOptions,
): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({
      width: opts.width,
      height: opts.height ?? 100,
      deviceScaleFactor: opts.scale ?? 2,
    });
    await page.setContent(html, { waitUntil: 'load' });
    // Ensure embedded @font-face fonts are parsed before we snapshot. Evaluated
    // as a string so TypeScript doesn't need the DOM lib for `document`.
    await page.evaluate('document.fonts && document.fonts.ready');
    const root = await page.$('#root');
    const shot = root
      ? await root.screenshot({ type: 'png' })
      : await page.screenshot({ type: 'png', fullPage: true });
    return Buffer.from(shot);
  } finally {
    await page.close();
  }
}
