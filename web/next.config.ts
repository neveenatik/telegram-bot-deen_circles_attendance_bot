import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  // This app has its own lockfile; pin the workspace root to avoid Next
  // picking up the bot's root lockfile.
  turbopack: {
    root: import.meta.dirname,
  },
};

export default withNextIntl(nextConfig);
