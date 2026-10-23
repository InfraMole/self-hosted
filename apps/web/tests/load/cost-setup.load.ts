// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Cost measurement, step 1 (ADR-055): three customers of 25 / 100 / 250
 * servers on one installation, every server with an enrolled agent. Writes
 * the agent credentials to COST_OUT for `scripts/load/agents.mjs`, which then
 * sends realistic reports through the real HTTP API.
 * Run: COST_OUT=<file> pnpm exec vitest run --project load tests/load/cost-setup.load.ts
 */
import { writeFileSync } from "node:fs";
import { afterAll, it } from "vitest";
import type { WorkspaceContext } from "@/server/authz";
import { createEnrollmentToken } from "@/server/modules/agents/agents";
import { enrollAgent } from "@/server/modules/agents/ingestion";
import {
  createWorkspace,
  findWorkspaceContextForUser,
} from "@/server/modules/workspaces/workspaces";
import { adminDb, createTestUser, resetDatabase } from "../integration/helpers";

const CUSTOMERS = [25, 100, 250];

afterAll(() => adminDb().$disconnect());

it.skipIf(!process.env.COST_OUT)("prepares three customers with enrolled agents", async () => {
  const out = process.env.COST_OUT;
  if (!out) throw new Error("COST_OUT is not set");
  await resetDatabase();
  const user = await createTestUser("cost");
  const customers = [];
  for (const [c, size] of CUSTOMERS.entries()) {
    const ws = await createWorkspace(user.id, { name: `Customer ${size}` });
    const ctx = (await findWorkspaceContextForUser(user.id, ws.slug)) as WorkspaceContext;
    const { token } = await createEnrollmentToken(ctx, {
      name: "cost",
      expiresInHours: 24,
      maxUses: null,
    });
    const agents = [];
    for (let i = 0; i < size; i++) {
      const hostname = `C${c}-SRV${String(i).padStart(3, "0")}`;
      const enrolled = await enrollAgent(
        {
          enrollmentToken: token,
          machineId: `cost-${c}-${i}-machine`,
          hostname,
          os: i % 3 === 0 ? "linux" : "windows",
          osVersion: "10.0.20348",
          arch: "amd64",
          agentVersion: "0.6.1",
        },
        { ip: "127.0.0.1" },
      );
      if (!enrolled) throw new Error("enrolment failed");
      // Each customer has its own private range: 10.<c>.<i/250>.<i%250+1>.
      agents.push({ hostname, secret: enrolled.agentSecret, ip: `10.${c}.0.${i + 1}` });
    }
    customers.push({ size, workspaceId: ws.id, agents });
  }
  writeFileSync(out, JSON.stringify({ customers }));
});
