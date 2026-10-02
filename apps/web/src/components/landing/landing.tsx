// SPDX-License-Identifier: AGPL-3.0-only
import Link from "next/link";
import {
  Boxes,
  Building2,
  Check,
  EyeOff,
  FileUp,
  Home,
  Radar,
  Server,
  Siren,
  Waypoints,
  Wrench,
  FileDown,
  KeyRound,
  Layers,
  ScrollText,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { Logo, Mascot, Wordmark } from "@/components/logo";
import { Button } from "@/components/ui/button";
import {
  BUSINESS_FROM_EUR_YEAR,
  CLOUD_TIER,
  CLOUD_TIERS,
  CLOUD_TRIAL_DAYS,
  COMMUNITY_WORKSPACE_LIMIT,
} from "@/lib/billing-plans";
import { localePath, type Locale } from "@/lib/i18n";
import { LISTED_LEGAL_DOCS, legalTitle } from "@/lib/legal";
import { SITE_COPY, type SiteCopy } from "./copy";
import { LanguageSuggestion, LanguageSwitch } from "./language";
import { MapIllustration } from "./map-illustration";
import { MiniMap } from "./mini-map";

/**
 * Public landing page (M11, ADR-022). Shown at "/" (English) and "/es"
 * (Spanish, M14 / ADR-026) to signed-out visitors on Cloud or when
 * PUBLIC_SITE=true (M13); otherwise installs go straight to sign-in.
 * Light theme island inside the dark app. Copy lives in ./copy.ts and follows
 * docs/UI.md: "could be affected", never "will break"; no claims the product
 * does not back.
 */
/** What the visitor can actually do on this installation (M13). */
export interface LandingOptions {
  /** Cloud sign-up is open (EDITION=cloud and SIGNUP=open). Otherwise: "Install free". */
  cloudSignup: boolean;
  /** A public demo exists at /demo (DEMO_MODE). */
  demo: boolean;
  /** The visitor is signed in with the shared demo account: offer to go back to it. */
  inDemo?: boolean;
  /**
   * Show Cloud / Business prices. Only when InfraMole is actually sold here
   * (EDITION=cloud); the public site of a non-commercial open source project
   * shows Community and "planned" editions without prices.
   */
  showPrices?: boolean;
}

interface Localized {
  locale: Locale;
  t: SiteCopy;
}

/** The application (/w/…) is English-only, so the demo link is the same in every language. */
const DEMO_APP_HREF = "/w/demo/map";
const INSTALL_PATH = "/docs/installation/requirements";

export function Landing({ locale = "en", ...options }: LandingOptions & { locale?: Locale }) {
  const props = { ...options, locale, t: SITE_COPY[locale] };
  return (
    <div className="light flex min-h-full flex-1 flex-col" lang={locale}>
      <SiteHeader locale={locale} />
      <main className="flex-1">
        <Hero {...props} />
        <Proof {...props} />
        <HowItWorks {...props} />
        <MapSection {...props} />
        <Sources {...props} />
        <UseCases {...props} />
        <Honesty {...props} />
        <Security {...props} />
        <Pricing {...props} />
        <Faq {...props} />
        <FinalCta {...props} />
      </main>
      <SiteFooter locale={locale} />
    </div>
  );
}

export function SiteHeader({ locale = "en" }: { locale?: Locale }) {
  const t = SITE_COPY[locale];
  const href = (path: string) => localePath(locale, path);
  return (
    <header className="border-border/70 bg-background/80 sticky top-0 z-30 border-b backdrop-blur">
      <LanguageSuggestion
        text={t.language.suggestion}
        action={t.language.suggestionAction}
        dismiss={t.language.dismiss}
      />
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href={href("/")} aria-label={t.nav.home}>
          <Logo className="text-[15px] [&_img]:size-6" />
        </Link>
        <nav className="text-muted hidden items-center gap-6 text-sm lg:flex">
          <Link href={href("/#how")} className="hover:text-foreground">
            {t.nav.how}
          </Link>
          <Link href={href("/#map")} className="hover:text-foreground">
            {t.nav.map}
          </Link>
          <Link href={href("/#security")} className="hover:text-foreground">
            {t.nav.security}
          </Link>
          <Link href={href("/#pricing")} className="hover:text-foreground">
            {t.nav.pricing}
          </Link>
          <Link href={href("/#faq")} className="hover:text-foreground">
            {t.nav.faq}
          </Link>
          <Link href={href("/docs")} className="hover:text-foreground">
            {t.nav.docs}
          </Link>
          <a href={GITHUB} className="hover:text-foreground">
            GitHub
          </a>
        </nav>
        <div className="flex items-center gap-2">
          <LanguageSwitch label={t.language.switchTo} title={t.language.switchLabel} />
          <Button asChild variant="ghost" size="md">
            <Link href="/sign-in">{t.nav.signIn}</Link>
          </Button>
          <Button asChild size="md" className="hidden sm:inline-flex">
            <Link href={href("/#pricing")}>{t.nav.getStarted}</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}

const GITHUB = "https://github.com/InfraMole/self-hosted";

function Hero({ cloudSignup, demo, inDemo, locale, t }: LandingOptions & Localized) {
  return (
    <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pt-16 pb-14 sm:px-6 lg:grid-cols-[1.15fr_0.85fr] lg:pt-24">
      <div>
        <p className="text-accent mb-4 font-mono text-xs tracking-wide">{t.hero.eyebrow}</p>
        <h1 className="text-4xl leading-[1.08] font-semibold tracking-tight sm:text-5xl lg:text-[56px]">
          {t.hero.title[0]}
          <br />
          {t.hero.title[1]}
        </h1>
        <p className="text-muted mt-5 max-w-xl text-base leading-relaxed sm:text-lg">
          <Wordmark className="text-foreground" /> {t.hero.lead}
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button asChild size="lg" className="h-10 px-5">
            {cloudSignup ? (
              <Link href="/sign-up">{t.hero.startTrial}</Link>
            ) : (
              <Link href={localePath(locale, INSTALL_PATH)}>{t.hero.installFree}</Link>
            )}
          </Button>
          <Button asChild variant="outline" size="lg" className="h-10 px-5">
            {inDemo ? (
              <Link href={DEMO_APP_HREF}>{t.hero.backToDemo}</Link>
            ) : demo ? (
              <Link href={localePath(locale, "/demo")}>{t.hero.tryDemo}</Link>
            ) : (
              <a href="#how">{t.hero.howItWorks}</a>
            )}
          </Button>
        </div>
        <p className="text-subtle mt-4 text-xs">
          {cloudSignup ? t.hero.trialNote(CLOUD_TRIAL_DAYS) : t.hero.freeNote}{" "}
          <a href={GITHUB} className="text-accent hover:underline">
            {t.hero.sourceCode} →
          </a>
        </p>
      </div>
      <div className="relative mx-auto w-full max-w-md lg:max-w-none">
        <div className="bg-brand-lavender/45 absolute inset-x-6 bottom-2 h-2/3 rounded-full blur-3xl" />
        <Mascot priority className="relative h-auto w-full" />
      </div>
    </section>
  );
}

/** The idea in ten seconds: click a resource, see what could be affected. */
function Proof({ locale }: Localized) {
  return (
    <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
      <MiniMap locale={locale} />
    </section>
  );
}

const MAP_ICONS: LucideIcon[] = [Waypoints, Boxes, Radar, FileDown];

function MapSection({ t }: Localized) {
  return (
    <section id="map" className="mx-auto max-w-6xl scroll-mt-14 px-4 py-20 sm:px-6">
      <SectionTitle eyebrow={t.map.eyebrow} title={t.map.title} />
      <p className="text-muted mt-4 max-w-2xl leading-relaxed">{t.map.body}</p>
      <ul className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
        {t.map.points.map((point, i) => {
          const Icon = MAP_ICONS[i] ?? Waypoints;
          return (
            <li key={point.title}>
              <Icon className="text-accent size-5" aria-hidden />
              <h3 className="mt-3 font-semibold">{point.title}</h3>
              <p className="text-muted mt-1.5 text-sm leading-relaxed">{point.body}</p>
            </li>
          );
        })}
      </ul>
      <div className="mt-10">
        <MapIllustration t={t.miniMap} />
      </div>
    </section>
  );
}

const SOURCE_ICONS: LucideIcon[] = [Server, KeyRound, FileUp];

function Sources({ locale, t }: Localized) {
  return (
    <section className="border-border bg-surface border-y">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <SectionTitle eyebrow={t.sources.eyebrow} title={t.sources.title} />
        <div className="mt-12 grid gap-8 lg:grid-cols-3">
          {t.sources.groups.map((group, i) => {
            const Icon = SOURCE_ICONS[i] ?? Server;
            return (
              <div key={group.title}>
                <Icon className="text-accent size-5" aria-hidden />
                <h3 className="mt-3 font-semibold">{group.title}</h3>
                <p className="text-subtle mt-0.5 text-xs">{group.note}</p>
                <ul className="text-muted mt-4 space-y-2 text-sm">
                  {group.items.map((item) => (
                    <li key={item} className="flex gap-2">
                      <Check className="text-accent mt-0.5 size-3.5 shrink-0" aria-hidden />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
        <p className="text-muted mt-10 text-sm">
          {t.sources.more} ·{" "}
          <Link
            href={localePath(locale, "/docs/manual/integrations")}
            className="text-accent font-medium hover:underline"
          >
            {t.sources.moreLink}
          </Link>
        </p>
      </div>
    </section>
  );
}

const USE_CASE_ICONS: LucideIcon[] = [Wrench, Siren, Building2, Home];

function UseCases({ t }: Localized) {
  return (
    <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
      <SectionTitle eyebrow={t.useCases.eyebrow} title={t.useCases.title} />
      <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {t.useCases.items.map((item, i) => {
          const Icon = USE_CASE_ICONS[i] ?? Wrench;
          return (
            <li key={item.title} className="border-border bg-surface rounded-xl border p-5">
              <Icon className="text-accent size-5" aria-hidden />
              <h3 className="mt-3 font-semibold">{item.title}</h3>
              <p className="text-muted mt-1.5 text-sm leading-relaxed">{item.body}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** `code` spans in answers (`inframole-agent dry-run`). */
function withCode(text: string) {
  return text.split(/(`[^`]+`)/).map((part, i) =>
    part.startsWith("`") ? (
      <code key={i} className="text-foreground font-mono text-[13px]">
        {part.slice(1, -1)}
      </code>
    ) : (
      part
    ),
  );
}

function Faq({ t }: Localized) {
  return (
    <section id="faq" className="border-border bg-surface scroll-mt-14 border-t">
      <div className="mx-auto max-w-3xl px-4 py-20 sm:px-6">
        <SectionTitle eyebrow={t.faq.eyebrow} title={t.faq.title} />
        <div className="divide-border border-border mt-10 divide-y border-y">
          {t.faq.items.map((item) => (
            <details key={item.q} className="group py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                {item.q}
                <span
                  aria-hidden
                  className="text-accent font-mono text-lg transition-transform group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <p className="text-muted mt-3 leading-relaxed">{withCode(item.a)}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorks({ t }: Localized) {
  return (
    <section id="how" className="border-border bg-surface scroll-mt-14 border-y">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <SectionTitle eyebrow={t.how.eyebrow} title={t.how.title} />
        <ol className="mt-12 grid gap-8 md:grid-cols-3">
          {t.how.steps.map((s, i) => (
            <li key={s.title}>
              <span className="text-accent font-mono text-sm">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="mt-2 text-lg font-semibold">{s.title}</h3>
              <p className="text-muted mt-2 leading-relaxed">{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

const confidenceStyle = [
  { key: "confirmed", dash: undefined, opacity: 1 },
  { key: "detected", dash: "6 5", opacity: 1 },
  { key: "inferred", dash: "1.5 5", opacity: 0.55 },
] as const;

function Honesty({ t }: Localized) {
  return (
    <section className="mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-2">
      <div>
        <SectionTitle eyebrow={t.honesty.eyebrow} title={t.honesty.title} />
        <p className="text-muted mt-4 max-w-lg leading-relaxed">{t.honesty.body}</p>
        <ul className="text-muted mt-8 space-y-2 text-sm">
          {t.honesty.not.map((n) => (
            <li key={n.strong}>
              <span className="text-foreground font-medium">{n.strong}</span> {n.rest}
            </li>
          ))}
        </ul>
      </div>
      <ul className="border-border bg-surface divide-border divide-y self-start rounded-xl border">
        {confidenceStyle.map((c) => {
          const copy = t.honesty.confidence[c.key];
          return (
            <li key={c.key} className="flex gap-5 p-5">
              <svg viewBox="0 0 64 8" className="mt-2 h-2 w-16 shrink-0" aria-hidden>
                <line
                  x1="0"
                  y1="4"
                  x2="64"
                  y2="4"
                  stroke="var(--accent)"
                  strokeWidth="2"
                  strokeDasharray={c.dash}
                  strokeOpacity={c.opacity}
                />
              </svg>
              <div>
                <h3 className="font-semibold">{copy.label}</h3>
                <p className="text-muted mt-1 text-sm leading-relaxed">{copy.body}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const safeguards: { icon: LucideIcon; key: keyof SiteCopy["security"]["items"] }[] = [
  { icon: EyeOff, key: "readOnly" },
  { icon: KeyRound, key: "noSecrets" },
  { icon: Layers, key: "isolation" },
  { icon: ShieldCheck, key: "twoFactor" },
  { icon: ScrollText, key: "audit" },
  { icon: FileDown, key: "data" },
];

function Security({ t }: Localized) {
  return (
    <section id="security" className="border-border bg-surface scroll-mt-14 border-y">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <SectionTitle eyebrow={t.security.eyebrow} title={t.security.title} />
        <ul className="mt-12 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {safeguards.map(({ icon: Icon, key }) => (
            <li key={key}>
              <Icon className="text-accent size-5" aria-hidden />
              <h3 className="mt-3 font-semibold">{t.security.items[key].title}</h3>
              <p className="text-muted mt-1.5 text-sm leading-relaxed">
                {t.security.items[key].body}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// Plans and prices: lib/billing-plans.ts (ADR-023 pricing, ADR-024 licensing, PRODUCT.md §10).
// Only list capabilities that exist today — never sell roadmap items.
function Pricing({ cloudSignup, showPrices, locale, t }: LandingOptions & Localized) {
  if (!showPrices) return <PricingOpenSource locale={locale} t={t} />;
  const p = t.pricing;
  return (
    <section id="pricing" className="mx-auto max-w-6xl scroll-mt-14 px-4 py-20 sm:px-6">
      <SectionTitle eyebrow={p.eyebrow} title={p.title} />
      <p className="text-muted mt-4 max-w-2xl leading-relaxed">{p.intro}</p>

      <PathHeading label={p.selfHosted.label} note={p.selfHosted.note} />
      <div className="grid gap-4 md:grid-cols-2">
        <CommunityCard locale={locale} t={t} />
        <div className="border-border bg-surface flex flex-col rounded-xl border p-6">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-lg font-semibold">{p.business.name}</h3>
            <span className="text-muted text-xs">{p.business.tag}</span>
          </div>
          <div className="mt-5 flex items-baseline gap-2">
            <span className="text-muted text-sm">{p.business.from}</span>
            <span className="text-3xl font-medium tracking-tight">{BUSINESS_FROM_EUR_YEAR} €</span>
            <span className="text-muted text-sm">{p.business.perYear}</span>
          </div>
          <ul className="text-muted mt-5 flex-1 space-y-2 text-sm">
            {p.business.lines.map((line) => (
              <PlanLine key={line}>{line}</PlanLine>
            ))}
          </ul>
          <a
            href="mailto:sales@inframole.com"
            className="text-accent mt-6 text-sm font-medium hover:underline"
          >
            {p.business.contact}
          </a>
        </div>
      </div>

      <PathHeading label={p.cloud.label} note={p.cloud.note} />
      <div className="grid gap-4 md:grid-cols-3">
        {CLOUD_TIERS.map((key) => {
          const tier = CLOUD_TIER[key];
          const featured = key === "team";
          return (
            <div
              key={key}
              className={`bg-surface flex flex-col rounded-xl border p-6 ${featured ? "border-accent/60 ring-accent/15 ring-4" : "border-border"}`}
            >
              <div className="flex items-baseline justify-between">
                <h3 className="text-lg font-semibold">{tier.name}</h3>
                {featured && <span className="text-accent text-xs font-medium">{p.mostTeams}</span>}
              </div>
              <div className="mt-5 flex items-baseline gap-2">
                <span className="text-3xl font-medium tracking-tight">{tier.priceEur} €</span>
                <span className="text-muted text-sm">{p.perMonth}</span>
              </div>
              <ul className="text-muted mt-5 flex-1 space-y-2 text-sm">
                <PlanLine>
                  {p.upTo[0]} <span className="text-foreground font-medium">{tier.nodes}</span>{" "}
                  {p.upTo[1]}
                </PlanLine>
                <PlanLine>
                  {tier.members === null ? p.unlimitedMembers : p.members(tier.members)}
                </PlanLine>
                <PlanLine>{p.history(tier.historyDays)}</PlanLine>
                {p.cloudCommon.map((line) => (
                  <PlanLine key={line}>{line}</PlanLine>
                ))}
              </ul>
              {cloudSignup ? (
                <Button asChild variant={featured ? "default" : "outline"} className="mt-6 h-9">
                  <Link href="/sign-up">{p.startTrial}</Link>
                </Button>
              ) : (
                <Button variant="outline" className="mt-6 h-9" disabled>
                  {p.comingSoon}
                </Button>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-muted mt-4 text-sm">
        {cloudSignup ? p.trialOpen(CLOUD_TRIAL_DAYS) : p.trialSoon(CLOUD_TRIAL_DAYS)}{" "}
        {p.moreThan(CLOUD_TIER.scale.nodes)}{" "}
        <a href="mailto:sales@inframole.com" className="text-accent hover:underline">
          {p.talkToUs}
        </a>
        .
      </p>
      <p className="text-subtle mt-6 text-xs">{p.earlyAccess}</p>
    </section>
  );
}

function CommunityCard({ locale, t }: Localized) {
  const c = t.community;
  return (
    <div className="border-accent/60 ring-accent/15 bg-surface flex flex-col rounded-xl border p-6 ring-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-lg font-semibold">{c.name}</h3>
        <span className="text-accent text-xs font-medium">{c.tag}</span>
      </div>
      <div className="mt-5 flex items-baseline gap-2">
        <span className="text-3xl font-medium tracking-tight">{c.price}</span>
        <span className="text-muted text-sm">{c.forever}</span>
      </div>
      <ul className="text-muted mt-5 flex-1 space-y-2 text-sm">
        <PlanLine>
          {c.unlimited[0]}
          <span className="text-foreground font-medium">{c.unlimited[1]}</span>
          {c.unlimited[2]}
        </PlanLine>
        <PlanLine>{c.workspaces(COMMUNITY_WORKSPACE_LIMIT)}</PlanLine>
        {c.lines.map((line) => (
          <PlanLine key={line}>{line}</PlanLine>
        ))}
      </ul>
      <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm font-medium">
        <Link href={localePath(locale, INSTALL_PATH)} className="text-accent hover:underline">
          {c.installGuide}
        </Link>
        <a href="https://github.com/InfraMole/self-hosted" className="text-accent hover:underline">
          {c.sourceCode}
        </a>
      </div>
    </div>
  );
}

/** Pricing section while nothing is sold: Community + planned editions, no prices. */
function PricingOpenSource({ locale, t }: Localized) {
  const o = t.openSource;
  return (
    <section id="pricing" className="mx-auto max-w-6xl scroll-mt-14 px-4 py-20 sm:px-6">
      <SectionTitle eyebrow={o.eyebrow} title={t.pricing.title} />
      <p className="text-muted mt-4 max-w-2xl leading-relaxed">{o.intro}</p>
      <div className="mt-10 grid gap-4 md:grid-cols-2">
        <CommunityCard locale={locale} t={t} />
        <div className="border-border bg-surface flex flex-col rounded-xl border p-6">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-lg font-semibold">{o.plannedTitle}</h3>
            <span className="text-muted text-xs">{o.planned}</span>
          </div>
          <p className="text-muted mt-5 flex-1 text-sm leading-relaxed">
            <span className="text-foreground font-medium">{o.cloud[0]}</span> {o.cloud[1]}{" "}
            <span className="text-foreground font-medium">{o.business[0]}</span> {o.business[1]}
          </p>
          <a
            href="mailto:sales@inframole.com"
            className="text-accent mt-6 text-sm font-medium hover:underline"
          >
            {o.interested}
          </a>
        </div>
      </div>
    </section>
  );
}

function PathHeading({ label, note }: { label: string; note: string }) {
  return (
    <div className="mt-12 mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="text-accent font-mono text-xs font-medium tracking-[0.2em] uppercase">
        {label}
      </span>
      <span className="text-muted text-sm">{note}</span>
    </div>
  );
}

function PlanLine({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <span className="bg-accent mt-2 size-1 shrink-0 rounded-full" />
      <span>{children}</span>
    </li>
  );
}

function FinalCta({ cloudSignup, demo, inDemo, locale, t }: LandingOptions & Localized) {
  return (
    <section className="bg-brand-ink text-white">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-8 px-4 py-16 sm:px-6 md:flex-row md:justify-between">
        <div className="flex items-center gap-6">
          <Mascot className="hidden h-auto w-32 sm:block" />
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">{t.finalCta.title}</h2>
            <p className="mt-2 text-white/65">{cloudSignup ? t.finalCta.trial : t.finalCta.free}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {demo && (
            <Button
              asChild
              size="lg"
              variant="outline"
              className="h-10 border-white/30 px-6 text-white hover:bg-white/10"
            >
              <Link href={inDemo ? DEMO_APP_HREF : localePath(locale, "/demo")}>
                {inDemo ? t.hero.backToDemo : t.hero.tryDemo}
              </Link>
            </Button>
          )}
          <Button
            asChild
            size="lg"
            className="bg-brand-violet hover:bg-brand-violet/90 h-10 px-6 text-white"
          >
            {cloudSignup ? (
              <Link href="/sign-up">{t.hero.startTrial}</Link>
            ) : (
              <Link href={localePath(locale, INSTALL_PATH)}>{t.hero.installFree}</Link>
            )}
          </Button>
        </div>
      </div>
    </section>
  );
}

export function SiteFooter({ locale = "en" }: { locale?: Locale }) {
  const t = SITE_COPY[locale];
  return (
    <footer className="border-border border-t">
      <div className="text-muted mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-6 text-xs sm:px-6 lg:flex-row">
        <span>
          © {new Date().getFullYear()} <Wordmark className="text-foreground" /> · {t.footer.tagline}
        </span>
        <nav className="flex flex-wrap justify-center gap-x-5 gap-y-2">
          <Link href={localePath(locale, "/agent")} className="hover:text-foreground">
            {t.footer.agent}
          </Link>
          <Link href={localePath(locale, "/docs")} className="hover:text-foreground">
            {t.footer.docs}
          </Link>
          {LISTED_LEGAL_DOCS.map((d) => (
            <Link
              key={d.slug}
              href={localePath(locale, `/legal/${d.slug}`)}
              className="hover:text-foreground"
            >
              {legalTitle(d, locale)}
            </Link>
          ))}
          <Link href="/sign-in" className="hover:text-foreground">
            {t.footer.signIn}
          </Link>
        </nav>
      </div>
    </footer>
  );
}

function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div>
      <p className="text-accent font-mono text-xs tracking-wide">{eyebrow}</p>
      <h2 className="mt-3 max-w-2xl text-3xl leading-tight font-semibold tracking-tight">
        {title}
      </h2>
    </div>
  );
}
