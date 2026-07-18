import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

// Next.js 16 renamed `middleware.ts` to `proxy.ts`.
export default createMiddleware(routing);

export const config = {
  // Match all pathnames except for API routes, Next internals and files with a dot.
  matcher: '/((?!api|trpc|_next|_vercel|.*\\..*).*)',
};
