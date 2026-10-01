// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Large, realistic workspaces for looking at the map at scale (M26):
 * `pnpm db:seed:scale` (after `pnpm db:seed`, which creates the demo user).
 * Re-runnable: deletes and recreates the "scale-300" and "scale-1000"
 * workspaces, owned by demo@depmap.local. Deterministic (seeded random).
 *
 * Shape: an MSP / mid-size company — hypervisors with VMs, Docker hosts with
 * containers, a Kubernetes cluster, applications with their databases and
 * calls between them, public sites behind Cloudflare and load balancers,
 * Active Directory as the hub everything authenticates with, monitoring,
 * backups and a few cloud islands.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import type { RelationshipType, ResourceType } from "../src/generated/prisma/enums";

const DEMO_EMAIL = "demo@depmap.local";

interface R {
  id: string;
  name: string;
  type: ResourceType;
  environment: "PRODUCTION" | "STAGING" | "DEVELOPMENT";
  criticality?: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  tags: string[];
  metadata: Record<string, unknown>;
}
interface E {
  from: string;
  type: RelationshipType;
  to: string;
}

function generate(machines: number) {
  let seed = 7 + machines;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;
  const resources: R[] = [];
  const edges: E[] = [];
  let ip = 10;
  const add = (name: string, type: ResourceType, extra: Partial<R> = {}): R => {
    const r: R = {
      id: randomUUID(),
      name,
      type,
      environment: "PRODUCTION",
      tags: [],
      metadata: {},
      ...extra,
    };
    if ((type === "SERVER" || type === "VM") && !r.metadata.ipAddresses)
      r.metadata.ipAddresses = [`10.${Math.floor(ip / 250)}.${ip++ % 250}.${10 + (ip % 200)}`];
    resources.push(r);
    return r;
  };
  const rel = (from: R, type: RelationshipType, to: R) =>
    edges.push({ from: from.id, type, to: to.id });

  // Core services.
  const cdn = add("Cloudflare", "EXTERNAL_SERVICE", { criticality: "HIGH", tags: ["cloudflare"] });
  const dcs = [1, 2].map((i) =>
    add(`DC0${i}`, "SERVER", { criticality: "CRITICAL", metadata: { os: "Windows Server 2022" } }),
  );
  const ad = add("corp.local", "DOMAIN", { criticality: "CRITICAL" });
  for (const dc of dcs) rel(ad, "DEPENDS_ON", dc);
  const zbxSrv = add("MON01", "SERVER", { metadata: { os: "Ubuntu 24.04" } });
  const zabbix = add("Zabbix", "APPLICATION", { tags: ["monitoring"] });
  rel(zabbix, "RUNS_ON", zbxSrv);
  const nas = [1, 2].map((i) => add(`NAS0${i}`, "STORAGE", { tags: ["backup"] }));
  const lbs = [1, 2].map((i) => {
    const lb = add(`LB0${i}`, "SERVER", { criticality: "HIGH", metadata: { os: "Debian 12" } });
    const fe = add(`web (LB0${i})`, "APPLICATION", { tags: ["haproxy"], criticality: "HIGH" });
    rel(fe, "RUNS_ON", lb);
    return fe;
  });

  // Hypervisors with VMs (~70 % of the machines).
  const hosts = Math.max(3, Math.round((machines * 0.7) / 22));
  const vms: R[] = [];
  for (let h = 1; h <= hosts; h++) {
    const hv = add(`esx${String(h).padStart(2, "0")}.corp.local`, "SERVER", {
      tags: ["vmware"],
      criticality: "HIGH",
    });
    const count = 16 + Math.floor(rand() * 10);
    for (let v = 1; v <= count && vms.length < machines * 0.7; v++) {
      const env = rand() < 0.75 ? "PRODUCTION" : rand() < 0.6 ? "STAGING" : "DEVELOPMENT";
      const vm = add(`VM-${String(vms.length + 1).padStart(4, "0")}`, "VM", {
        environment: env,
        tags: ["vmware"],
        metadata: { os: rand() < 0.55 ? "Microsoft Windows Server 2022 (64-bit)" : "Ubuntu 24.04" },
      });
      rel(hv, "HOSTS", vm);
      vms.push(vm);
    }
  }
  for (const m of [...dcs, zbxSrv, ...vms]) rel(m, "AUTHENTICATES_WITH", ad);

  // Docker hosts with containers.
  const dockerHosts = Math.max(2, Math.round(machines / 40));
  const containers: R[] = [];
  for (let d = 1; d <= dockerHosts; d++) {
    const host = add(`DOCKER${String(d).padStart(2, "0")}`, "SERVER", {
      metadata: { os: "Ubuntu 24.04 LTS" },
    });
    rel(host, "AUTHENTICATES_WITH", ad);
    const project = `stack${d}`;
    const web = add(`${project}-web (DOCKER${d})`, "CONTAINER", { tags: ["docker", "nginx"] });
    const api = add(`${project}-api (DOCKER${d})`, "CONTAINER", { tags: ["docker"] });
    const db = add(`${project}-db (DOCKER${d})`, "DATABASE", { tags: ["docker", "postgresql"] });
    const cache = add(`${project}-cache (DOCKER${d})`, "DATABASE", { tags: ["docker", "redis"] });
    for (const c of [web, api, db, cache]) rel(c, "RUNS_ON", host);
    rel(web, "DEPENDS_ON", api);
    rel(api, "USES_DATABASE", db);
    rel(api, "DEPENDS_ON", cache);
    containers.push(web, api);
  }

  // Kubernetes cluster.
  const nodes = [1, 2, 3, 4].map((i) =>
    add(`k8s-node${i}`, "SERVER", { tags: ["kubernetes"], metadata: { os: "Ubuntu 24.04.1 LTS" } }),
  );
  const workloads: R[] = [];
  for (let w = 1; w <= Math.max(8, Math.round(machines / 40)); w++) {
    const isDb = w % 5 === 0;
    const wl = add(`prod/${isDb ? "db" : "svc"}-${w}`, isDb ? "DATABASE" : "APPLICATION", {
      tags: ["kubernetes", ...(isDb ? ["postgresql"] : [])],
    });
    const spread = isDb ? 1 : 1 + Math.floor(rand() * 3);
    const start = Math.floor(rand() * nodes.length);
    for (let s = 0; s < spread; s++) rel(wl, "RUNS_ON", nodes[(start + s) % nodes.length]!);
    workloads.push(wl);
  }

  // Applications on VMs, with databases on dedicated VMs.
  const appVms = vms.filter((_, i) => i % 3 !== 0);
  const dbVms = vms.filter((_, i) => i % 3 === 0);
  const databases: R[] = [];
  dbVms.forEach((vm, i) => {
    if (i % 2) return;
    const engine = pick(["sql-server", "postgresql", "mysql"]);
    const db = add(`DB-${String(i + 1).padStart(3, "0")}`, "DATABASE", {
      environment: vm.environment,
      tags: [engine],
      criticality: rand() < 0.3 ? "CRITICAL" : "HIGH",
    });
    rel(db, "RUNS_ON", vm);
    databases.push(db);
  });
  const apps: R[] = [];
  appVms.forEach((vm, i) => {
    if (i % 2) return; // not every VM runs a mapped application
    const app = add(`app-${String(apps.length + 1).padStart(3, "0")}`, "APPLICATION", {
      environment: vm.environment,
      tags: [pick(["iis", "nginx", "apache", "internal"])],
      criticality: rand() < 0.2 ? "HIGH" : "MEDIUM",
    });
    rel(app, "RUNS_ON", vm);
    if (databases.length) rel(app, "USES_DATABASE", pick(databases));
    apps.push(app);
  });
  // Calls between applications, a few to Kubernetes services and containers.
  for (const app of apps) {
    if (rand() < 0.35) {
      const other = pick(apps);
      if (other !== app) rel(app, "CALLS", other);
    }
    if (rand() < 0.08) rel(app, "CALLS", pick(workloads));
    if (rand() < 0.05) rel(app, "CALLS", pick(containers));
  }
  // Public sites.
  const publicApps = apps.filter((_, i) => i % 9 === 0).slice(0, 40);
  publicApps.forEach((app, i) => {
    const domain = add(`site${i + 1}.example.com`, "DOMAIN", { criticality: "HIGH" });
    rel(domain, "DEPENDS_ON", app);
    rel(domain, "EXPOSED_THROUGH", cdn);
    rel(app, "EXPOSED_THROUGH", pick(lbs));
  });
  // Monitoring and backups (informational).
  for (const vm of vms) if (rand() < 0.3) rel(vm, "MONITORED_BY", zabbix);
  for (const db of databases) rel(db, "BACKS_UP_TO", pick(nas));

  // Cloud islands and a few unconnected resources.
  for (let c = 1; c <= Math.max(2, Math.round(machines / 150)); c++) {
    const lb = add(`lb-cloud-${c}`, "NETWORK", { tags: ["hetzner", "load-balancer"] });
    for (let v = 1; v <= 3; v++) {
      const vm = add(`cloud-${c}-web-${v}`, "VM", { tags: ["hetzner"] });
      rel(vm, "EXPOSED_THROUGH", lb);
    }
  }
  for (let l = 1; l <= 6; l++)
    add(`orphan-${l}`, pick(["VM", "SERVER", "APPLICATION"]) as ResourceType);

  return { resources, edges };
}

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed in production.");
  const url = process.env.DATABASE_URL_ADMIN || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL_ADMIN / DATABASE_URL is not set (apps/web/.env).");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const user = await db.user.findUnique({ where: { email: DEMO_EMAIL }, select: { id: true } });
    if (!user) throw new Error(`Run "pnpm db:seed" first (creates ${DEMO_EMAIL}).`);
    for (const machines of [300, 1000]) {
      const slug = `scale-${machines}`;
      await db.$transaction([
        db.$executeRaw`SELECT set_config('depmap.allow_audit_delete', 'on', true)`,
        db.workspace.deleteMany({ where: { slug } }),
      ]);
      const ws = await db.workspace.create({
        data: {
          name: `Scale ${machines}`,
          slug,
          memberships: { create: { userId: user.id, role: "OWNER" } },
        },
      });
      const { resources, edges } = generate(machines);
      await db.resource.createMany({
        data: resources.map((r) => ({
          ...r,
          workspaceId: ws.id,
          status: "DISCOVERED" as const,
          source: "IMPORT" as const,
          sourceLabel: "Scale test data",
          metadata: r.metadata as object,
        })),
      });
      const seen = new Set<string>();
      await db.relationship.createMany({
        data: edges
          .filter((e) => {
            const k = `${e.from}|${e.to}|${e.type}`;
            if (seen.has(k) || e.from === e.to) return false;
            seen.add(k);
            return true;
          })
          .map((e) => ({
            workspaceId: ws.id,
            fromResourceId: e.from,
            toResourceId: e.to,
            type: e.type,
            origin: "MANUAL" as const,
            status: "CONFIRMED" as const,
          })),
      });
      const machinesCount = resources.filter((r) => r.type === "SERVER" || r.type === "VM").length;
      console.log(
        `Seeded "${slug}": ${resources.length} resources (${machinesCount} servers/VMs), ${seen.size} relationships.`,
      );
    }
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
