import { setRequestLocale } from "next-intl/server";
import Header from "@/components/Header";
import Hero from "@/components/Hero";
import Features from "@/components/Features";
import Guide from "@/components/Guide";
import ChatDemo from "@/components/ChatDemo";
import Developers from "@/components/Developers";
import Footer from "@/components/Footer";

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function HomePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <>
      <Header />
      <main className="flex-1">
        <Hero />
        <Features />
        <Guide />
        <ChatDemo />
        <Developers />
      </main>
      <Footer />
    </>
  );
}
