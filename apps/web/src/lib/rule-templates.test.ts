// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { guessProtocol } from "@/server/modules/discovery/protocols";
import { RULE_TEMPLATES, describeTemplate, findRuleTemplate } from "./rule-templates";

describe("suggested exclusion rules (M19)", () => {
  it("has unique ids and valid, non-empty rules", () => {
    const ids = RULE_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of RULE_TEMPLATES) {
      expect(t.rules.length).toBeGreaterThan(0);
      for (const r of t.rules) {
        expect(r.port !== undefined || !!r.processName).toBe(true);
        if (r.port !== undefined) expect(r.port >= 1 && r.port <= 65535).toBe(true);
      }
    }
  });

  it("never hides the application protocols discovery relies on", () => {
    // Databases, directories, web, file shares: those ARE dependencies.
    for (const t of RULE_TEMPLATES)
      for (const r of t.rules)
        if (r.port !== undefined && t.category !== "administration")
          expect(guessProtocol(r.port), `${t.id} → ${r.port}`).toBeNull();
    const all = RULE_TEMPLATES.flatMap((t) => t.rules.map((r) => r.port));
    for (const port of [80, 443, 1433, 3306, 5432, 389, 445, 53]) expect(all).not.toContain(port);
  });

  it("describes and finds templates", () => {
    expect(describeTemplate(findRuleTemplate("zabbix")!)).toBe("ports 10050, 10051");
    expect(describeTemplate(findRuleTemplate("rdp")!)).toBe("port 3389");
    expect(findRuleTemplate("nope")).toBeNull();
  });
});
