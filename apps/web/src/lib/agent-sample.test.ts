// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { reportSchemaV1 } from "@/server/modules/agents/protocol";
import { SAMPLE_REPORT } from "./agent-sample";

describe("public agent sample report", () => {
  it("is a valid v1 report (strict schema: no invented fields)", () => {
    expect(reportSchemaV1.safeParse(SAMPLE_REPORT).success).toBe(true);
  });
});
