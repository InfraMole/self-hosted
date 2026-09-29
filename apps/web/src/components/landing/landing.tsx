// SPDX-License-Identifier: AGPL-3.0-only
import Link from "next/link";
import {
  EyeOff,
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
import { LEGAL_DOCS } from "@/lib/legal";
import { ImpactPreview } from "./impact-preview";

/**
 * Public landing page (M11, ADR-022). Shown at "/" to signed-out visitors on
 * Cloud or when PUBLIC_SITE=true (M13); otherwise installs go straight to sign-in.
 * Light theme island inside the dark app. Copy follows docs/UI.md: "could be
 * affected", never "will break"; no claims the product does not back.
 */
/** What the visitor can actually do on this installation (M13). */
export interface LandingOptions {
  /** Cloud sign-up is open (EDITION=cloud and SIGNUP=open). Otherwise: "Install free". */
  cloudSignup: boolean;
  /** A public demo exists at /demo (DEMO_MODE). */
  demo: boolean;
}

export function Landing(options: LandingOptions) {
  return (
    <div className="light flex min-h-full flex-1 flex-col">
      <SiteHeader />
      <main className="flex-1">
        <Hero {...options} />
        <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
          <ImpactPreview />
        </section>
        <HowItWorks />
        <Honesty />
        <Security />
        <Pricing {...options} />
        <FinalCta {...options} />
      </main>
      <SiteFooter />
    </div>
  );
}

export function SiteHeader() {
  return (
    <header className="border-border/70 bg-background/80 sticky top-0 z-30 border-b backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" aria-label="InfraMole home">
          <Logo className="text-[15px] [&_img]:size-6" />
        </Link>
        <nav className="text-muted hidden items-center gap-6 text-sm md:flex">
          <Link href="/#how" className="hover:text-foreground">
            How it works
          </Link>
          <Link href="/#security" className="hover:text-foreground">
            Security
          </Link>
          <Link href="/#pricing" className="hover:text-foreground">
            Pricing
          </Link>
          <Link href="/docs" className="hover:text-foreground">
            Docs
          </Link>
        </nav>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="md">
            <Link href="/sign-in">Sign in</Link>
          </Button>
          <Button asChild size="md">
            <Link href="/#pricing">Get started</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}

const technicalValues = ["prod-web-01", "10.20.4.15", "Azure / rg-production", "SQL-PROD-02"];

const INSTALL_HREF = "/docs/installation/requirements";

function Hero({ cloudSignup, demo }: LandingOptions) {
  return (
    <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pt-16 pb-14 sm:px-6 lg:grid-cols-[1.15fr_0.85fr] lg:pt-24">
      <div>
        <p className="text-accent mb-4 font-mono text-xs tracking-wide">
          infrastructure dependency mapping
        </p>
        <h1 className="text-4xl leading-[1.08] font-semibold tracking-tight sm:text-5xl lg:text-[56px]">
          See what depends
          <br />
          on what.
        </h1>
        <p className="text-muted mt-5 max-w-xl text-base leading-relaxed sm:text-lg">
          <Wordmark className="text-foreground" /> digs through your servers, apps, databases and
          domains, maps how they connect, and shows what could be affected before you change or
          switch off anything. Lightweight and read-only — for small IT teams, MSPs and homelabs.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button asChild size="lg" className="h-10 px-5">
            {cloudSignup ? (
              <Link href="/sign-up">Start free trial</Link>
            ) : (
              <Link href={INSTALL_HREF}>Install free</Link>
            )}
          </Button>
          <Button asChild variant="outline" size="lg" className="h-10 px-5">
            {demo ? <Link href="/demo">Try the demo</Link> : <a href="#how">How it works</a>}
          </Button>
        </div>
        <p className="text-subtle mt-4 text-xs">
          {cloudSignup
            ? `${CLOUD_TRIAL_DAYS}-day free trial. No card needed. Or self-host Community — free and open source.`
            : "Free and open source (AGPLv3). Up and running on your own server in about ten minutes."}
        </p>
        <ul className="mt-10 flex flex-wrap gap-2" aria-label="The kind of things it maps">
          {technicalValues.map((v) => (
            <li
              key={v}
              className="border-border bg-surface text-muted rounded-md border px-2 py-1 font-mono text-xs"
            >
              {v}
            </li>
          ))}
        </ul>
      </div>
      <div className="relative mx-auto w-full max-w-md lg:max-w-none">
        <div className="bg-brand-lavender/45 absolute inset-x-6 bottom-2 h-2/3 rounded-full blur-3xl" />
        <Mascot priority className="relative h-auto w-full" />
      </div>
    </section>
  );
}

const steps = [
  {
    n: "01",
    title: "Install",
    body: "Run one small read-only agent per server — a single signed binary for Windows or Linux. Or bring what you already have: Proxmox, Azure, AWS, Cloudflare, Docker Compose or a CSV.",
  },
  {
    n: "02",
    title: "Discover",
    body: "Hosts, services and the connections between them are observed and turned into suggestions — each one says where it came from and how sure we are.",
  },
  {
    n: "03",
    title: "Understand",
    body: "Your team confirms what matters and adds the context only people know. Then open the map, or ask what could be affected before a change or during an outage.",
  },
];

function HowItWorks() {
  return (
    <section id="how" className="border-border bg-surface scroll-mt-14 border-y">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <SectionTitle
          eyebrow="Install → Discover → Understand"
          title="A map that builds itself, and people who make it true"
        />
        <ol className="mt-12 grid gap-8 md:grid-cols-3">
          {steps.map((s) => (
            <li key={s.n}>
              <span className="text-accent font-mono text-sm">{s.n}</span>
              <h3 className="mt-2 text-lg font-semibold">{s.title}</h3>
              <p className="text-muted mt-2 leading-relaxed">{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

const confidence = [
  {
    label: "Confirmed",
    dash: undefined,
    opacity: 1,
    body: "A person on your team said so. Only confirmed dependencies are presented as dependencies.",
  },
  {
    label: "Detected",
    dash: "6 5",
    opacity: 1,
    body: "Observed by an agent or an integration — for example, a live connection to port 1433.",
  },
  {
    label: "Inferred",
    dash: "1.5 5",
    opacity: 0.55,
    body: "A reasonable guess from names or placement. Shown faintly, and never counted as fact.",
  },
];

function Honesty() {
  return (
    <section className="mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-2">
      <div>
        <SectionTitle
          eyebrow="Honest by design"
          title="Suggestions, never guesses dressed up as facts"
        />
        <p className="text-muted mt-4 max-w-lg leading-relaxed">
          Every relationship carries its confidence, everywhere: on the map, in lists and in impact
          results. You decide what is true; InfraMole keeps track of what changed and when.
        </p>
        <ul className="text-muted mt-8 space-y-2 text-sm">
          <li>
            <span className="text-foreground font-medium">Not monitoring.</span> No alerts, no
            dashboards to stare at.
          </li>
          <li>
            <span className="text-foreground font-medium">Not a CMDB.</span> No forms to fill in
            before you get value.
          </li>
          <li>
            <span className="text-foreground font-medium">Never remote control.</span> It cannot run
            anything on your machines.
          </li>
        </ul>
      </div>
      <ul className="border-border bg-surface divide-border divide-y self-start rounded-xl border">
        {confidence.map((c) => (
          <li key={c.label} className="flex gap-5 p-5">
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
              <h3 className="font-semibold">{c.label}</h3>
              <p className="text-muted mt-1 text-sm leading-relaxed">{c.body}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

const safeguards: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: EyeOff,
    title: "Read-only agent",
    body: "It reports what it sees and has no command channel. The platform never executes anything on your machines.",
  },
  {
    icon: KeyRound,
    title: "No secrets collected",
    body: "No passwords, file contents, command-line arguments or environment variables. Integration tokens are encrypted and read-only.",
  },
  {
    icon: Layers,
    title: "Isolation, enforced twice",
    body: "Every workspace is separated in the application and again by row-level security in the database.",
  },
  {
    icon: ShieldCheck,
    title: "2FA and passkeys",
    body: "For every account, and workspaces can require them. Included in Community and in every Cloud plan.",
  },
  {
    icon: ScrollText,
    title: "Audit log",
    body: "Who did what, append-only, kept for a year — members, integrations, agents and settings.",
  },
  {
    icon: FileDown,
    title: "Your data stays yours",
    body: "Export a workspace or delete it at any time. Or self-host InfraMole and keep everything in-house.",
  },
];

function Security() {
  return (
    <section id="security" className="border-border bg-surface scroll-mt-14 border-y">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <SectionTitle
          eyebrow="Security"
          title="Built to be trusted with a map of your infrastructure"
        />
        <ul className="mt-12 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {safeguards.map(({ icon: Icon, title, body }) => (
            <li key={title}>
              <Icon className="text-accent size-5" aria-hidden />
              <h3 className="mt-3 font-semibold">{title}</h3>
              <p className="text-muted mt-1.5 text-sm leading-relaxed">{body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// Plans and prices: lib/billing-plans.ts (ADR-023 pricing, ADR-024 licensing, PRODUCT.md §10).
// Only list capabilities that exist today — never sell roadmap items.
const cloudCommon = [
  "Agents",
  "Azure, AWS and Cloudflare discovery",
  "Applications, databases, containers, domains and discovered services unlimited",
];

function Pricing({ cloudSignup }: LandingOptions) {
  return (
    <section id="pricing" className="mx-auto max-w-6xl scroll-mt-14 px-4 py-20 sm:px-6">
      <SectionTitle eyebrow="Pricing" title="Your infrastructure. Your choice." />
      <p className="text-muted mt-4 max-w-2xl leading-relaxed">
        Self-host InfraMole for free, or let us run it for you. Cloud pricing is based only on
        servers and VMs — everything else you discover is unlimited.
      </p>

      <PathHeading label="Self-hosted" note="You run InfraMole on your own servers." />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="border-accent/60 ring-accent/15 bg-surface flex flex-col rounded-xl border p-6 ring-4">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-lg font-semibold">Community</h3>
            <span className="text-accent text-xs font-medium">Free &amp; Open Source — AGPLv3</span>
          </div>
          <div className="mt-5 flex items-baseline gap-2">
            <span className="text-3xl font-medium tracking-tight">Free</span>
            <span className="text-muted text-sm">forever</span>
          </div>
          <ul className="text-muted mt-5 flex-1 space-y-2 text-sm">
            <PlanLine>
              <span className="text-foreground font-medium">Unlimited</span> servers and VMs
            </PlanLine>
            <PlanLine>{COMMUNITY_WORKSPACE_LIMIT} workspace</PlanLine>
            <PlanLine>
              Discovery with agents, dependency map, dependencies and impact analysis
            </PlanLine>
            <PlanLine>Azure, AWS and Cloudflare discovery</PlanLine>
            <PlanLine>Two-factor authentication, passkeys and audit log</PlanLine>
            <PlanLine>Docker Compose deployment</PlanLine>
          </ul>
          <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm font-medium">
            <Link href="/docs/installation/requirements" className="text-accent hover:underline">
              Install guide →
            </Link>
            <a
              href="https://github.com/InfraMole/self-hosted"
              className="text-accent hover:underline"
            >
              Source code →
            </a>
          </div>
        </div>
        <div className="border-border bg-surface flex flex-col rounded-xl border p-6">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-lg font-semibold">Business</h3>
            <span className="text-muted text-xs">Enterprise</span>
          </div>
          <div className="mt-5 flex items-baseline gap-2">
            <span className="text-muted text-sm">from</span>
            <span className="text-3xl font-medium tracking-tight">{BUSINESS_FROM_EUR_YEAR} €</span>
            <span className="text-muted text-sm">per year</span>
          </div>
          <ul className="text-muted mt-5 flex-1 space-y-2 text-sm">
            <PlanLine>Everything in Community</PlanLine>
            <PlanLine>Multiple workspaces — one per client or department</PlanLine>
            <PlanLine>Signed offline licence — no phone-home</PlanLine>
            <PlanLine>Priority email support</PlanLine>
            <PlanLine>Commercial licence as an alternative to the AGPL</PlanLine>
          </ul>
          <a
            href="mailto:sales@inframole.com"
            className="text-accent mt-6 text-sm font-medium hover:underline"
          >
            Contact sales@inframole.com →
          </a>
        </div>
      </div>

      <PathHeading label="Cloud" note="We run and maintain InfraMole for you." />
      <div className="grid gap-4 md:grid-cols-3">
        {CLOUD_TIERS.map((key) => {
          const t = CLOUD_TIER[key];
          const featured = key === "team";
          return (
            <div
              key={key}
              className={`bg-surface flex flex-col rounded-xl border p-6 ${featured ? "border-accent/60 ring-accent/15 ring-4" : "border-border"}`}
            >
              <div className="flex items-baseline justify-between">
                <h3 className="text-lg font-semibold">{t.name}</h3>
                {featured && <span className="text-accent text-xs font-medium">Most teams</span>}
              </div>
              <div className="mt-5 flex items-baseline gap-2">
                <span className="text-3xl font-medium tracking-tight">{t.priceEur} €</span>
                <span className="text-muted text-sm">per month</span>
              </div>
              <ul className="text-muted mt-5 flex-1 space-y-2 text-sm">
                <PlanLine>
                  Up to <span className="text-foreground font-medium">{t.nodes}</span> servers and
                  VMs
                </PlanLine>
                <PlanLine>
                  {t.members === null ? "Unlimited members" : `${t.members} members`}
                </PlanLine>
                <PlanLine>{t.historyDays} days change history</PlanLine>
                {cloudCommon.map((line) => (
                  <PlanLine key={line}>{line}</PlanLine>
                ))}
              </ul>
              {cloudSignup ? (
                <Button asChild variant={featured ? "default" : "outline"} className="mt-6 h-9">
                  <Link href="/sign-up">Start free trial</Link>
                </Button>
              ) : (
                <Button variant="outline" className="mt-6 h-9" disabled>
                  Coming soon
                </Button>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-muted mt-4 text-sm">
        {cloudSignup
          ? `Every Cloud workspace starts with ${CLOUD_TRIAL_DAYS} days of Team, free — no card needed.`
          : `InfraMole Cloud opens soon: every Cloud workspace will start with ${CLOUD_TRIAL_DAYS} days of Team, free — no card needed.`}
        More than {CLOUD_TIER.scale.nodes} servers?{" "}
        <a href="mailto:sales@inframole.com" className="text-accent hover:underline">
          Talk to us
        </a>
        .
      </p>
      <p className="text-subtle mt-6 text-xs">
        Early-access prices; they may change before general availability.
      </p>
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

function FinalCta({ cloudSignup, demo }: LandingOptions) {
  return (
    <section className="bg-brand-ink text-white">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-8 px-4 py-16 sm:px-6 md:flex-row md:justify-between">
        <div className="flex items-center gap-6">
          <Mascot className="hidden h-auto w-32 sm:block" />
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">
              Know what is under the ground.
            </h2>
            <p className="mt-2 text-white/65">
              {cloudSignup
                ? "Map your first servers in minutes. 14 days free, no card, no sales call."
                : "Free and open source. Map your first servers in minutes — no sales call."}
            </p>
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
              <Link href="/demo">Try the demo</Link>
            </Button>
          )}
          <Button
            asChild
            size="lg"
            className="bg-brand-violet hover:bg-brand-violet/90 h-10 px-6 text-white"
          >
            {cloudSignup ? (
              <Link href="/sign-up">Start free trial</Link>
            ) : (
              <Link href={INSTALL_HREF}>Install free</Link>
            )}
          </Button>
        </div>
      </div>
    </section>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-border border-t">
      <div className="text-muted mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-6 text-xs sm:px-6 lg:flex-row">
        <span>
          © {new Date().getFullYear()} <Wordmark className="text-foreground" /> · See what depends
          on what.
        </span>
        <nav className="flex flex-wrap justify-center gap-x-5 gap-y-2">
          <Link href="/agent" className="hover:text-foreground">
            What the agent collects
          </Link>
          <Link href="/docs" className="hover:text-foreground">
            Docs
          </Link>
          {LEGAL_DOCS.map((d) => (
            <Link key={d.slug} href={`/legal/${d.slug}`} className="hover:text-foreground">
              {d.title}
            </Link>
          ))}
          <Link href="/sign-in" className="hover:text-foreground">
            Sign in
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
