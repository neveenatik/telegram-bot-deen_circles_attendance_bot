import { useTranslations } from "next-intl";
import { BOT_URL } from "@/lib/site";

export default function Hero() {
  const t = useTranslations("hero");

  return (
    <section id="top" className="relative overflow-hidden">
      <div className="brand-gradient pointer-events-none absolute inset-x-0 -top-32 h-64 opacity-20 blur-3xl" />
      <div className="mx-auto max-w-6xl px-4 py-20 text-center sm:py-28">
        <span className="inline-block rounded-full border border-border bg-card px-4 py-1 text-sm text-muted">
          {t("badge")}
        </span>
        <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-extrabold leading-tight sm:text-5xl">
          {t("title")}
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-muted">
          {t("subtitle")}
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <a
            href={BOT_URL}
            target="_blank"
            rel="noreferrer"
            className="brand-gradient rounded-full px-6 py-3 font-semibold text-white shadow-md transition hover:opacity-90"
          >
            {t("ctaPrimary")}
          </a>
          <a
            href="#demo"
            className="rounded-full border border-border bg-card px-6 py-3 font-semibold transition hover:border-brand"
          >
            {t("ctaSecondary")}
          </a>
        </div>
      </div>
    </section>
  );
}
