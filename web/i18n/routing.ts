import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  // Arabic is the primary language of the circle; English is provided as a fallback.
  locales: ['ar', 'en'],
  defaultLocale: 'ar',
});

export type Locale = (typeof routing.locales)[number];
