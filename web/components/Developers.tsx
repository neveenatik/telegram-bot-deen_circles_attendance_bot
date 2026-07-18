import { useTranslations } from "next-intl";
import { GITHUB_URL, NEW_ISSUE_URL, PULLS_URL } from "@/lib/site";

export default function Developers() {
  const t = useTranslations("developers");

  const cards = [
    { key: "source", icon: "📂", href: GITHUB_URL },
    { key: "issue", icon: "🐞", href: NEW_ISSUE_URL },
    { key: "feature", icon: "💡", href: NEW_ISSUE_URL },
    { key: "pr", icon: "🔀", href: PULLS_URL },
  ] as const;

  return (
    <section id="developers" className="border-t border-border bg-card/40">
      <div className="mx-auto max-w-6xl px-4 py-20">
        <div className="text-center">
          <h2 className="text-3xl font-bold sm:text-4xl">{t("title")}</h2>
          <p className="mx-auto mt-3 max-w-2xl text-muted">{t("subtitle")}</p>
        </div>

        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {cards.map(({ key, icon, href }) => (
            <a
              key={key}
              href={href}
              target="_blank"
              rel="noreferrer"
              className="group rounded-2xl border border-border bg-card p-6 shadow-sm transition hover:-translate-y-1 hover:border-brand hover:shadow-md"
            >
              <div className="text-2xl">{icon}</div>
              <h3 className="mt-3 text-lg font-bold">
                {t(`cards.${key}.title`)}
              </h3>
              <p className="mt-2 text-sm text-muted">
                {t(`cards.${key}.desc`)}
              </p>
            </a>
          ))}
        </div>

        <div className="mt-10 text-center">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="brand-gradient inline-block rounded-full px-6 py-3 font-semibold text-white shadow-md transition hover:opacity-90"
          >
            {t("viewOnGithub")} ↗
          </a>
        </div>
      </div>
    </section>
  );
}
