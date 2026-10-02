// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { notifyList, notifyText } from "./notify";

describe("who to warn", () => {
  const items = [
    {
      name: "orders-db",
      owner: "Data team",
      ownerContact: "data@example.com",
      confidence: "confirmed" as const,
    },
    { name: "billing", owner: "Platform team", ownerContact: null },
    { name: "shop", owner: "platform team ", ownerContact: "#platform" },
    { name: "shop.example.com", owner: null, ownerContact: null },
  ];

  it("groups by owner (case-insensitive), biggest first, and lists what has no owner", () => {
    const list = notifyList(items);
    expect(list.groups.map((g) => [g.owner, g.contact, g.resources.map((r) => r.name)])).toEqual([
      ["Platform team", "#platform", ["billing", "shop"]],
      ["Data team", "data@example.com", ["orders-db"]],
    ]);
    expect(list.unowned).toEqual(["shop.example.com"]);
  });

  it("writes a message to paste", () => {
    expect(notifyText("SQL01", notifyList(items))).toBe(
      [
        "If SQL01 fails, these could be affected:",
        "",
        "- Platform team (#platform): billing, shop",
        "- Data team (data@example.com): orders-db",
        "- No owner recorded: shop.example.com",
      ].join("\n"),
    );
  });
});
