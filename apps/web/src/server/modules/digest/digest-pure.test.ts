// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  digestDue,
  renderDigest,
  unsubscribeToken,
  validUnsubscribeToken,
  weekStart,
  type DigestData,
} from "./digest-pure";

describe("digest schedule", () => {
  it("anchors weeks on Monday 06:00 UTC", () => {
    // Wednesday 1 Oct 2026 → Monday 28 Sep 06:00
    expect(weekStart(new Date("2026-10-01T12:00:00Z")).toISOString()).toBe(
      "2026-09-28T06:00:00.000Z",
    );
    // Monday before 06:00 → the previous Monday
    expect(weekStart(new Date("2026-09-28T05:59:00Z")).toISOString()).toBe(
      "2026-09-21T06:00:00.000Z",
    );
    expect(weekStart(new Date("2026-09-28T06:00:00Z")).toISOString()).toBe(
      "2026-09-28T06:00:00.000Z",
    );
    // Sunday
    expect(weekStart(new Date("2026-10-04T23:00:00Z")).toISOString()).toBe(
      "2026-09-28T06:00:00.000Z",
    );
  });

  it("is due once per week, and never right after being turned on", () => {
    const monday = new Date("2026-09-28T07:00:00Z");
    expect(digestDue(null, monday)).toBe(true);
    expect(digestDue(new Date("2026-09-21T07:00:00Z"), monday)).toBe(true);
    expect(digestDue(new Date("2026-09-28T06:30:00Z"), monday)).toBe(false); // sent this week
    const turnedOnTuesday = new Date("2026-09-29T10:00:00Z");
    expect(digestDue(turnedOnTuesday, new Date("2026-10-02T10:00:00Z"))).toBe(false);
    expect(digestDue(turnedOnTuesday, new Date("2026-10-05T06:01:00Z"))).toBe(true);
  });
});

const data = (over: Partial<DigestData> = {}): DigestData => ({
  workspaceName: "Acme",
  from: new Date("2026-09-21T06:00:00Z"),
  to: new Date("2026-09-28T06:00:00Z"),
  counts: { DISCOVERED: 3, UPDATED: 5, CONFIRMED: 1 },
  topResources: [
    { name: "SQL01", changes: 4 },
    { name: "APP01", changes: 1 },
  ],
  suggestionsWaiting: 2,
  staleResources: 1,
  changesUrl: "https://im.example.com/w/acme/changes",
  suggestionsUrl: "https://im.example.com/w/acme/suggestions",
  unsubscribeUrl: "https://im.example.com/api/digest/unsubscribe?m=1&t=x",
  ...over,
});

describe("renderDigest", () => {
  it("summarises counts, names and what waits — plain text with an unsubscribe link", () => {
    const mail = renderDigest("ana@example.com", data())!;
    expect(mail.subject).toBe("Acme: 9 changes this week");
    expect(mail.unsubscribeUrl).toBe("https://im.example.com/api/digest/unsubscribe?m=1&t=x");
    expect(mail.text).toBe(
      [
        'Weekly summary for "Acme" — 21 Sept to 28 Sept',
        "",
        "9 changes this week:",
        "  • 3 discovered",
        "  • 5 updated",
        "  • 1 confirmed",
        "",
        "Most changed resources:",
        "  • SQL01 — 4 changes",
        "  • APP01 — 1 change",
        "",
        "Waiting for you:",
        "  • 2 suggestions to review: https://im.example.com/w/acme/suggestions",
        "  • 1 resource no longer reporting (stale)",
        "",
        "See every change: https://im.example.com/w/acme/changes",
        "",
        'You receive this because you turned on the weekly summary for "Acme".',
        "Stop these emails: https://im.example.com/api/digest/unsubscribe?m=1&t=x",
        "",
        "— InfraMole · See what depends on what.",
      ].join("\n"),
    );
  });

  it("sends nothing when there is nothing to say", () => {
    expect(
      renderDigest(
        "a@b",
        data({ counts: {}, topResources: [], suggestionsWaiting: 0, staleResources: 0 }),
      ),
    ).toBeNull();
    expect(renderDigest("a@b", data({ counts: {}, topResources: [] }))!.text).toContain(
      "No changes this week.",
    );
  });
});

describe("unsubscribe token", () => {
  it("is bound to the membership and the secret", () => {
    const t = unsubscribeToken("secret-1", "m1");
    expect(validUnsubscribeToken("secret-1", "m1", t)).toBe(true);
    expect(validUnsubscribeToken("secret-1", "m2", t)).toBe(false);
    expect(validUnsubscribeToken("secret-2", "m1", t)).toBe(false);
    expect(validUnsubscribeToken("secret-1", "m1", "short")).toBe(false);
  });
});
