"use client";

import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { useTransition } from "react";

export default function LocaleSwitcher() {
  const t = useTranslations("localeSwitcher");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  function onSelect(next: string) {
    if (next === locale) return;
    startTransition(() => {
      router.replace(pathname, { locale: next });
    });
  }

  return (
    <div
      className="inline-flex items-center rounded-full border border-border bg-card p-1 text-sm"
      role="group"
      aria-label={t("label")}
    >
      {routing.locales.map((loc) => {
        const active = loc === locale;
        return (
          <button
            key={loc}
            type="button"
            onClick={() => onSelect(loc)}
            disabled={isPending}
            aria-pressed={active}
            className={`rounded-full px-3 py-1 transition ${
              active
                ? "brand-gradient text-white"
                : "text-muted hover:text-foreground"
            }`}
          >
            {t(loc)}
          </button>
        );
      })}
    </div>
  );
}
