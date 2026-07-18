import { useTranslations } from "next-intl";
import Image from "next/image";
import LocaleSwitcher from "./LocaleSwitcher";
import { BOT_URL } from "@/lib/site";

export default function Header() {
  const t = useTranslations("nav");

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <a href="#top" className="flex items-center gap-2 font-bold">
          <span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-white">
            <Image
              src="/logo-mark.svg"
              alt=""
              width={28}
              height={28}
              className="h-7 w-7"
            />
          </span>
          <span className="brand-text">Deen Circles</span>
        </a>

        <nav className="hidden items-center gap-6 text-sm text-muted sm:flex">
          <a href="#features" className="hover:text-foreground">
            {t("features")}
          </a>
          <a href="#guide" className="hover:text-foreground">
            {t("guide")}
          </a>
          <a href="#demo" className="hover:text-foreground">
            {t("demo")}
          </a>
          <a href="#developers" className="hover:text-foreground">
            {t("developers")}
          </a>
        </nav>

        <div className="flex items-center gap-3">
          <LocaleSwitcher />
          <a
            href={BOT_URL}
            target="_blank"
            rel="noreferrer"
            className="brand-gradient rounded-full px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
          >
            {t("openBot")}
          </a>
        </div>
      </div>
    </header>
  );
}
