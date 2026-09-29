// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Static, illustrative preview of the impact view for the landing page. Same
 * confidence encoding as the product (docs/UI.md §2): confirmed = solid,
 * detected = dashed, inferred = dotted and fainter. Rendered in the dark theme.
 */
const nodes = [
  { id: "db", x: 40, y: 118, label: "SQL-PROD-02", kind: "database", focus: true },
  { id: "api", x: 330, y: 22, label: "api-orders", kind: "application" },
  { id: "web", x: 330, y: 94, label: "prod-web-01", kind: "10.20.4.15" },
  { id: "worker", x: 330, y: 166, label: "billing-worker", kind: "container" },
  { id: "shop", x: 330, y: 238, label: "shop.example.com", kind: "domain" },
] as const;

const edges = [
  { to: "api", dash: undefined, opacity: 0.9 },
  { to: "web", dash: "6 5", opacity: 0.9 },
  { to: "worker", dash: "1.5 5", opacity: 0.55 },
  { to: "shop", dash: undefined, opacity: 0.9 },
] as const;

const rows = [
  { name: "api-orders", why: "depends on SQL-PROD-02", confidence: "Confirmed" },
  { name: "prod-web-01", why: "connects to :1433 (observed by the agent)", confidence: "Detected" },
  { name: "billing-worker", why: "same host, similar name", confidence: "Inferred" },
  { name: "shop.example.com", why: "served by api-orders", confidence: "Confirmed" },
] as const;

const badge: Record<(typeof rows)[number]["confidence"], string> = {
  Confirmed: "border-solid border-foreground/40 text-foreground",
  Detected: "border-dashed border-accent/70 text-accent",
  Inferred: "border-dotted border-muted text-muted",
};

const W = 190;
const H = 44;

export function ImpactPreview() {
  const db = nodes[0];
  return (
    <div className="dark border-border bg-background text-foreground shadow-brand-ink/25 overflow-hidden rounded-xl border shadow-2xl">
      <div className="border-border flex items-center gap-2 border-b px-4 py-3">
        <span className="bg-danger/80 size-2 rounded-full" />
        <span className="text-muted text-xs">Impact</span>
        <span className="text-sm font-medium">
          If <span className="font-mono text-[13px]">SQL-PROD-02</span> goes down, these could be
          affected
        </span>
      </div>
      <div className="grid gap-0 md:grid-cols-[1.15fr_1fr]">
        <svg
          viewBox="0 0 540 300"
          role="img"
          aria-label="Map: four resources depend on SQL-PROD-02 with different confidence"
          className="border-border hidden w-full border-b sm:block md:border-r md:border-b-0"
        >
          {edges.map((e) => {
            const n = nodes.find((x) => x.id === e.to)!;
            const x1 = db.x + W;
            const y1 = db.y + H / 2;
            const x2 = n.x;
            const y2 = n.y + H / 2;
            return (
              <path
                key={e.to}
                d={`M${x2},${y2} C${x2 - 60},${y2} ${x1 + 60},${y1} ${x1},${y1}`}
                fill="none"
                stroke="var(--accent)"
                strokeWidth={1.5}
                strokeDasharray={e.dash}
                strokeOpacity={e.opacity}
              />
            );
          })}
          {nodes.map((n) => (
            <g key={n.id} transform={`translate(${n.x},${n.y})`}>
              <rect
                width={n.id === "db" ? 150 : W}
                height={H}
                rx={6}
                fill="var(--surface-2)"
                stroke={"focus" in n ? "var(--danger)" : "var(--border-strong)"}
              />
              <text
                x={12}
                y={19}
                fill="var(--foreground)"
                fontSize={13}
                fontFamily="var(--font-geist-mono)"
              >
                {n.label}
              </text>
              <text
                x={12}
                y={34}
                fill="var(--muted)"
                fontSize={10.5}
                fontFamily={
                  n.kind.includes(".") ? "var(--font-geist-mono)" : "var(--font-geist-sans)"
                }
              >
                {n.kind}
              </text>
            </g>
          ))}
        </svg>
        <ul className="divide-border divide-y text-sm">
          {rows.map((r) => (
            <li key={r.name} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="truncate font-mono text-[13px]">{r.name}</div>
                <div className="text-muted truncate text-xs">{r.why}</div>
              </div>
              <span
                className={`shrink-0 rounded border px-1.5 py-0.5 text-[11px] ${badge[r.confidence]}`}
              >
                {r.confidence}
              </span>
            </li>
          ))}
          <li className="text-subtle px-4 py-3 text-xs">
            Detected and inferred links stay suggestions until someone on your team confirms them.
          </li>
        </ul>
      </div>
    </div>
  );
}
