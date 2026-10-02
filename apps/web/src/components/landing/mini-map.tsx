// SPDX-License-Identifier: AGPL-3.0-only
"use client";

/**
 * Landing (M28): a tiny, illustrative map. Click (or tap, or Enter on) any
 * resource to see what could be affected if it fails — the same idea and
 * the same confidence encoding as the product (docs/UI.md §2): confirmed =
 * solid, detected = dashed, inferred = dotted. Not the real map component:
 * hand-placed nodes, readable at any size.
 */
import { useMemo, useState } from "react";
import type { Locale } from "@/lib/i18n";
import { SITE_COPY, type SiteCopy } from "./copy";

type Confidence = "confirmed" | "detected" | "inferred";

interface MiniNode {
  id: string;
  label: string;
  kind: keyof SiteCopy["miniMap"]["kinds"];
  x: number;
  y: number;
}

const W = 150;
const H = 44;

/** Four layers, top to bottom: entry points, applications, data, servers. */
const NODES: MiniNode[] = [
  { id: "shop", label: "shop.example.com", kind: "domain", x: 40, y: 24 },
  { id: "apidns", label: "api.example.com", kind: "domain", x: 255, y: 24 },
  { id: "web", label: "web-shop", kind: "app", x: 40, y: 124 },
  { id: "api", label: "orders-api", kind: "app", x: 255, y: 124 },
  { id: "billing", label: "billing-worker", kind: "app", x: 470, y: 124 },
  { id: "cache", label: "cache", kind: "database", x: 147, y: 224 },
  { id: "db", label: "orders-db", kind: "database", x: 362, y: 224 },
  { id: "app01", label: "APP01", kind: "server", x: 40, y: 324 },
  { id: "sql", label: "SQL-PROD-02", kind: "server", x: 362, y: 324 },
];

/** dependent → dependency (the arrow points to what it depends on). */
const EDGES: { from: string; to: string; confidence: Confidence }[] = [
  { from: "shop", to: "web", confidence: "confirmed" },
  { from: "apidns", to: "api", confidence: "confirmed" },
  { from: "web", to: "cache", confidence: "detected" },
  { from: "web", to: "db", confidence: "detected" },
  { from: "api", to: "db", confidence: "confirmed" },
  { from: "billing", to: "db", confidence: "inferred" },
  { from: "web", to: "app01", confidence: "confirmed" },
  { from: "cache", to: "app01", confidence: "confirmed" },
  { from: "db", to: "sql", confidence: "confirmed" },
];

const RANK: Record<Confidence, number> = { confirmed: 2, detected: 1, inferred: 0 };
const byId = new Map(NODES.map((n) => [n.id, n]));

/** Everything that depends on `root`, with the weakest confidence along its strongest path. */
function impactOf(root: string): Map<string, Confidence> {
  const out = new Map<string, Confidence>();
  const queue: [string, Confidence][] = [[root, "confirmed"]];
  while (queue.length) {
    const [id, conf] = queue.shift()!;
    for (const e of EDGES) {
      if (e.to !== id) continue;
      const c = RANK[e.confidence] < RANK[conf] ? e.confidence : conf;
      const prev = out.get(e.from);
      if (e.from === root || (prev && RANK[prev] >= RANK[c])) continue;
      out.set(e.from, c);
      queue.push([e.from, c]);
    }
  }
  return out;
}

const DASH: Record<Confidence, string | undefined> = {
  confirmed: undefined,
  detected: "6 5",
  inferred: "1.5 5",
};

/** Takes the locale, not the copy: the copy has functions, which cannot cross to the client. */
export function MiniMap({ locale }: { locale: Locale }) {
  const t = SITE_COPY[locale].miniMap;
  const [root, setRoot] = useState("sql");
  const affected = useMemo(() => impactOf(root), [root]);
  const rootNode = byId.get(root)!;
  const onPath = (e: (typeof EDGES)[number]) =>
    (affected.has(e.from) || e.from === root) && (affected.has(e.to) || e.to === root);

  return (
    <div className="dark border-border bg-background text-foreground shadow-brand-ink/25 overflow-hidden rounded-xl border shadow-2xl">
      <div className="border-border flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-3">
        <span className="bg-danger/80 size-2 rounded-full" aria-hidden />
        <p className="text-sm font-medium" aria-live="polite">
          {t.ifFails(rootNode.label, affected.size)}
        </p>
        <p className="text-subtle ml-auto text-xs">{t.hint}</p>
      </div>
      <div className="grid md:grid-cols-[1.35fr_1fr]">
        <svg
          viewBox="0 0 660 392"
          className="border-border w-full border-b md:border-r md:border-b-0"
          role="group"
          aria-label={t.label}
        >
          <defs>
            {(["base", "hot"] as const).map((k) => (
              <marker
                key={k}
                id={`mini-arrow-${k}`}
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto"
              >
                <path d="M0,0 L10,5 L0,10 z" fill={k === "hot" ? "#f0b43c" : "#5c6470"} />
              </marker>
            ))}
          </defs>
          {EDGES.map((e) => {
            const a = byId.get(e.from)!;
            const b = byId.get(e.to)!;
            const x1 = a.x + W / 2;
            const y1 = a.y + H;
            const x2 = b.x + W / 2;
            const y2 = b.y - 3;
            const hot = onPath(e);
            return (
              <path
                key={`${e.from}-${e.to}`}
                d={`M${x1},${y1} C${x1},${y1 + 40} ${x2},${y2 - 40} ${x2},${y2}`}
                fill="none"
                stroke={hot ? "#f0b43c" : "#5c6470"}
                strokeWidth={hot ? 1.8 : 1.2}
                strokeDasharray={DASH[e.confidence]}
                strokeOpacity={hot ? 1 : e.confidence === "inferred" ? 0.5 : 0.8}
                markerEnd={`url(#mini-arrow-${hot ? "hot" : "base"})`}
              />
            );
          })}
          {NODES.map((n) => {
            const isRoot = n.id === root;
            const conf = affected.get(n.id);
            const dim = !isRoot && !conf;
            return (
              <g
                key={n.id}
                transform={`translate(${n.x},${n.y})`}
                role="button"
                tabIndex={0}
                aria-pressed={isRoot}
                aria-label={t.select(n.label)}
                onClick={() => setRoot(n.id)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter" || ev.key === " ") {
                    ev.preventDefault();
                    setRoot(n.id);
                  }
                }}
                className="cursor-pointer outline-none [&:focus-visible>rect]:stroke-[#a78bfa]"
                opacity={dim ? 0.45 : 1}
              >
                <rect
                  width={W}
                  height={H}
                  rx={7}
                  fill="#15171d"
                  stroke={isRoot ? "#f2706a" : conf ? "#f0b43c" : "#3a404a"}
                  strokeWidth={isRoot ? 2 : 1.3}
                  strokeDasharray={conf ? DASH[conf] : undefined}
                />
                <text
                  x={12}
                  y={19}
                  fill="#e5e8eb"
                  fontSize={13}
                  fontFamily="var(--font-geist-mono)"
                >
                  {n.label}
                </text>
                <text
                  x={12}
                  y={34}
                  fill="#8b93a0"
                  fontSize={10.5}
                  fontFamily="var(--font-geist-sans)"
                >
                  {t.kinds[n.kind]}
                </text>
              </g>
            );
          })}
        </svg>
        <ul className="divide-border divide-y text-sm">
          {[...affected.entries()].map(([id, conf]) => (
            <li key={id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <span className="truncate font-mono text-[13px]">{byId.get(id)!.label}</span>
              <span
                className={`shrink-0 rounded border px-1.5 py-0.5 text-[11px] ${
                  conf === "confirmed"
                    ? "border-foreground/40 text-foreground border-solid"
                    : conf === "detected"
                      ? "border-accent/70 text-accent border-dashed"
                      : "border-muted text-muted border-dotted"
                }`}
              >
                {t.confidence[conf]}
              </span>
            </li>
          ))}
          {affected.size === 0 && <li className="text-muted px-4 py-3 text-xs">{t.nothing}</li>}
          <li className="text-subtle px-4 py-3 text-xs">{t.note}</li>
        </ul>
      </div>
    </div>
  );
}
