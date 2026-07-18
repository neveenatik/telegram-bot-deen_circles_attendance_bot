import { useTranslations } from "next-intl";

const ITEMS = [
  { key: "attendance", icon: "✅" },
  { key: "tagging", icon: "🏷️" },
  { key: "mentions", icon: "📣" },
  { key: "offline", icon: "🔒" },
  { key: "roster", icon: "🗓️" },
  { key: "materials", icon: "📚" },
  { key: "homework", icon: "✍️" },
  { key: "reports", icon: "📊" },
  { key: "privacy", icon: "🛡️" },
] as const;

export default function Features() {
  const t = useTranslations("features");

  return (
    <section id="features" className="mx-auto max-w-6xl px-4 py-20">
      <div className="text-center">
        <h2 className="text-3xl font-bold sm:text-4xl">{t("title")}</h2>
        <p className="mt-3 text-muted">{t("subtitle")}</p>
      </div>

      <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {ITEMS.map(({ key, icon }) => (
          <article
            key={key}
            className="rounded-2xl border border-border bg-card p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-md"
          >
            <div className="brand-gradient flex h-11 w-11 items-center justify-center rounded-xl text-xl">
              <span>{icon}</span>
            </div>
            <h3 className="mt-4 text-lg font-bold">
              {t(`items.${key}.title`)}
            </h3>
            <p className="mt-2 text-muted">{t(`items.${key}.desc`)}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
