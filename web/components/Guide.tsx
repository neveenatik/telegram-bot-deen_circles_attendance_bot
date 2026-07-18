import { useTranslations } from "next-intl";

const MODES = [
  {
    key: "online",
    icon: "👥",
    accent:
      "bg-brand text-white",
  },
  {
    key: "offline",
    icon: "🔒",
    accent: "bg-brand-2 text-brand",
  },
] as const;

export default function Guide() {
  const t = useTranslations("guide");

  return (
    <section id="guide" className="border-t border-border bg-card/40">
      <div className="mx-auto max-w-6xl px-4 py-20">
        <div className="text-center">
          <h2 className="text-3xl font-bold sm:text-4xl">{t("title")}</h2>
          <p className="mx-auto mt-3 max-w-2xl text-muted">{t("subtitle")}</p>
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-2">
          {MODES.map(({ key, icon, accent }) => {
            const steps = t.raw(`${key}.steps`) as string[];
            return (
              <article
                key={key}
                className="flex flex-col rounded-3xl border border-border bg-card p-6 shadow-sm sm:p-8"
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-11 w-11 items-center justify-center rounded-xl text-xl ${accent}`}
                  >
                    <span>{icon}</span>
                  </div>
                  <div>
                    <h3 className="text-lg font-bold">{t(`${key}.title`)}</h3>
                    <p className="text-sm text-muted">{t(`${key}.subtitle`)}</p>
                  </div>
                </div>

                <ol className="mt-6 space-y-3">
                  {steps.map((step, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-background text-xs font-semibold text-brand-2">
                        {i + 1}
                      </span>
                      <span className="text-sm leading-relaxed">{step}</span>
                    </li>
                  ))}
                </ol>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
