// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Contract between the Go agent and the server (ADR-004):
 *  1. the golden report produced by the Go tests must satisfy the zod schema;
 *  2. the committed JSON Schema must match the zod schema (regenerate with
 *     `pnpm agent:contract`).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { reportSchemaV1 } from "./protocol";

const agentDir = path.resolve(import.meta.dirname, "../../../../../../agent");
// The public server repo (InfraMole/self-hosted) ships without the agent, which
// lives in InfraMole/agent (ADR-024); the contract is checked where both exist.
const hasAgent = existsSync(path.join(agentDir, "contract"));

function reportJsonSchema() {
  return z.toJSONSchema(reportSchemaV1, { io: "input" });
}

describe.skipIf(!hasAgent)("agent contract", () => {
  it("the Go golden report is accepted by the server schema", () => {
    const golden = JSON.parse(
      readFileSync(path.join(agentDir, "internal/protocol/testdata/report.golden.json"), "utf8"),
    );
    const result = reportSchemaV1.safeParse(golden);
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });

  it("agent/contract/report.v1.schema.json is up to date", () => {
    const committed = JSON.parse(
      readFileSync(path.join(agentDir, "contract/report.v1.schema.json"), "utf8"),
    );
    expect(committed).toEqual(reportJsonSchema());
  });
});
