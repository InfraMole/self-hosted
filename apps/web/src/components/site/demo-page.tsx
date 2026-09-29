// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteFooter, SiteHeader } from "@/components/landing/landing";
import { Mascot } from "@/components/logo";
import { localePath, type Locale } from "@/lib/i18n";
import {
  DEMO_EMAIL,
  DEMO_PASSWORD,
  DEMO_SLUG,
  demoEnabled,
  ensureDemo,
} from "@/server/modules/demo/demo";
import { DemoSignIn } from "./demo-sign-in";

const en = {
  eyebrow: "live demo",
  title: "Explore InfraMole with example infrastructure",
  intro:
    "A fictional company with web servers, SQL Server, Active Directory, a Proxmox host and a few cloud services. Read-only, no sign-up — it is rebuilt every day.",
  tour: [
    {
      title: "Map",
      body: "Everything the example company runs, laid out by what depends on what.",
    },
    {
      title: "Impact",
      body: "Pick SQL01 and ask what could be affected if it went down — with how certain each path is.",
    },
    {
      title: "Suggestions",
      body: "Connections an agent observed, waiting for a person to confirm them.",
    },
    { title: "Changes", body: "What changed, when and by whom." },
  ],
  like: [
    "Like what you see?",
    "Install InfraMole Community for free",
    "— open source, unlimited servers and VMs.",
  ],
  appNote: "",
  signIn: {
    open: "Open the demo",
    opening: "Opening the demo…",
    busy: "Many people are opening the demo right now. Try again in a minute.",
    unavailable: "The demo is not available right now. Try again later.",
  },
};

const es: typeof en = {
  eyebrow: "demo en vivo",
  title: "Explora InfraMole con una infraestructura de ejemplo",
  intro:
    "Una empresa ficticia con servidores web, SQL Server, Active Directory, un host Proxmox y algunos servicios en la nube. Solo lectura y sin registro — se reconstruye cada día.",
  tour: [
    {
      title: "Map",
      body: "Todo lo que usa la empresa de ejemplo, ordenado según qué depende de qué.",
    },
    {
      title: "Impact",
      body: "Elige SQL01 y pregunta qué podría verse afectado si cayera — con la certeza de cada camino.",
    },
    {
      title: "Suggestions",
      body: "Conexiones que ha observado un agente, esperando a que una persona las confirme.",
    },
    { title: "Changes", body: "Qué cambió, cuándo y quién lo hizo." },
  ],
  like: [
    "¿Te gusta lo que ves?",
    "Instala InfraMole Community gratis",
    "— código abierto, servidores y máquinas virtuales ilimitados.",
  ],
  appNote: "La aplicación está en inglés; los nombres de arriba son los de sus menús.",
  signIn: {
    open: "Abrir la demo",
    opening: "Abriendo la demo…",
    busy: "Mucha gente está abriendo la demo ahora mismo. Inténtalo de nuevo en un minuto.",
    unavailable: "La demo no está disponible ahora mismo. Inténtalo más tarde.",
  },
};

const COPY: Record<Locale, typeof en> = { en, es };

/** Public demo (M13): only when DEMO_MODE=true. /demo and /es/demo. */
export async function DemoPage({ locale }: { locale: Locale }) {
  if (!demoEnabled()) notFound();
  await ensureDemo(); // first visit after a deploy or a reset builds it
  const t = COPY[locale];
  return (
    <div className="light flex min-h-full flex-1 flex-col" lang={locale}>
      <SiteHeader locale={locale} />
      <main className="mx-auto grid w-full max-w-5xl flex-1 items-center gap-10 px-4 py-16 sm:px-6 md:grid-cols-[1.2fr_0.8fr]">
        <div>
          <p className="text-accent font-mono text-xs tracking-wide">{t.eyebrow}</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{t.title}</h1>
          <p className="text-muted mt-4 max-w-xl leading-relaxed">{t.intro}</p>
          <ul className="mt-6 space-y-3 text-sm">
            {t.tour.map((item) => (
              <li key={item.title}>
                <span className="font-semibold">{item.title}.</span>{" "}
                <span className="text-muted">{item.body}</span>
              </li>
            ))}
          </ul>
          {t.appNote && <p className="text-subtle mt-3 text-xs">{t.appNote}</p>}
          <div className="mt-8">
            <DemoSignIn
              email={DEMO_EMAIL}
              password={DEMO_PASSWORD}
              slug={DEMO_SLUG}
              labels={t.signIn}
            />
          </div>
          <p className="text-subtle mt-6 text-xs">
            {t.like[0]}{" "}
            <Link
              href={localePath(locale, "/docs/installation/requirements")}
              className="text-accent hover:underline"
            >
              {t.like[1]}
            </Link>{" "}
            {t.like[2]}
          </p>
        </div>
        <Mascot priority className="mx-auto h-auto w-full max-w-sm" />
      </main>
      <SiteFooter locale={locale} />
    </div>
  );
}
