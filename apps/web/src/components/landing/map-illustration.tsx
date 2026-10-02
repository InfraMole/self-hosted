// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Landing (M28): how the map reads — layers from entry points down to hosts,
 * and servers / hypervisors drawn as boxes around what runs on them (nested:
 * a hypervisor holds a VM that holds its databases). Static and illustrative
 * (hand-placed), in the product's visual language.
 */
import type { SiteCopy } from "./copy";

const W = 132;
const H = 38;

function Node({ x, y, label, kind }: { x: number; y: number; label: string; kind: string }) {
  return (
    <g transform={`translate(${x},${y})`}>
      <rect width={W} height={H} rx={6} fill="#15171d" stroke="#3a404a" strokeWidth={1.2} />
      <text x={10} y={17} fill="#e5e8eb" fontSize={11.5} fontFamily="var(--font-geist-mono)">
        {label}
      </text>
      <text x={10} y={30} fill="#8b93a0" fontSize={9.5}>
        {kind}
      </text>
    </g>
  );
}

function Box({
  x,
  y,
  w,
  h,
  label,
  kind,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  kind: string;
}) {
  return (
    <g transform={`translate(${x},${y})`}>
      <rect width={w} height={h} rx={9} fill="#101217" stroke="#4b5260" strokeWidth={1.2} />
      <line x1={0} x2={w} y1={30} y2={30} stroke="#2a2f38" />
      <text x={12} y={19} fill="#e5e8eb" fontSize={11.5} fontFamily="var(--font-geist-mono)">
        {label}
      </text>
      <text x={w - 12} y={19} fill="#8b93a0" fontSize={9.5} textAnchor="end">
        {kind}
      </text>
    </g>
  );
}

/** Vertical bezier from (x1,y1) down to (x2,y2). */
const down = (x1: number, y1: number, x2: number, y2: number) =>
  `M${x1},${y1} C${x1},${y1 + 34} ${x2},${y2 - 34} ${x2},${y2}`;

const BANDS = [
  { y: 0, h: 96 },
  { y: 96, h: 92 },
  { y: 188, h: 206 },
];

export function MapIllustration({ t }: { t: SiteCopy["miniMap"] }) {
  const k = t.kinds;
  return (
    <div className="dark border-border bg-background overflow-hidden rounded-xl border">
      <svg viewBox="0 0 860 394" className="w-full" role="img" aria-label={t.illustrationLabel}>
        <defs>
          <marker
            id="illus-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto"
          >
            <path d="M0,0 L10,5 L0,10 z" fill="#6b7380" />
          </marker>
        </defs>
        {BANDS.map((band, i) => (
          <g key={i}>
            <rect
              x={0}
              y={band.y}
              width={860}
              height={band.h}
              fill={i % 2 ? "#0d0f14" : "#0a0b10"}
            />
            <text
              x={18}
              y={band.y + 22}
              fill="#6b7280"
              fontSize={10}
              fontFamily="var(--font-geist-mono)"
              letterSpacing={1}
            >
              {t.layers[i]!.toUpperCase()}
            </text>
          </g>
        ))}

        {/* Hosts first: boxes around what runs on them. */}
        <Box x={110} y={222} w={300} h={104} label="APP01" kind={k.server} />
        <Node x={122} y={268} label="web-shop" kind={k.app} />
        <Node x={266} y={268} label="orders-api" kind={k.app} />

        <Box x={450} y={206} w={330} h={168} label="pve-01" kind={k.hypervisor} />
        <Box x={464} y={250} w={302} h={108} label="SQL-PROD-02" kind={k.vm} />
        <Node x={476} y={296} label="orders-db" kind={k.database} />
        <Node x={622} y={296} label="reports-db" kind={k.database} />

        {/* Entry points and load balancer. */}
        <Node x={238} y={36} label="shop.example.com" kind={k.domain} />
        <Node x={490} y={36} label="api.example.com" kind={k.domain} />
        <Node x={364} y={124} label="lb-01" kind={k.lb} />

        <g fill="none" stroke="#6b7380" strokeWidth={1.2} markerEnd="url(#illus-arrow)">
          <path d={down(304, 74, 420, 121)} />
          <path d={down(556, 74, 440, 121)} />
          <path d={down(410, 162, 188, 265)} />
          <path d={down(450, 162, 332, 265)} />
          {/* orders-api uses orders-db: across boxes */}
          <path d="M398,287 C430,287 440,315 473,315" />
        </g>
      </svg>
    </div>
  );
}
