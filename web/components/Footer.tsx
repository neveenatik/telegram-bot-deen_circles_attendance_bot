import { useTranslations } from "next-intl";
import { GITHUB_URL } from "@/lib/site";

export default function Footer() {
  const t = useTranslations("footer");
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-8 text-sm text-muted sm:flex-row">
        <p>{t("tagline")}</p>
        <div className="flex items-center gap-4">
          <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="hover:text-foreground">
            GitHub
          </a>
          <span>
            © {year} · {t("rights")}
          </span>
        </div>
      </div>
    </footer>
  );
}
