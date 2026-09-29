// SPDX-License-Identifier: AGPL-3.0-only
import { RELATIONSHIP_TYPES } from "@depmap/graph";
import { describe, expect, it } from "vitest";
import { RelationshipType } from "@/generated/prisma/enums";
import {
  relationshipCreateSchema,
  relationshipFieldErrors,
  relationshipFormToCreateInput,
} from "./schemas";

describe("RelationshipType enum", () => {
  it("matches the graph registry exactly (DB and semantics cannot drift)", () => {
    expect(Object.values(RelationshipType).sort()).toEqual([...RELATIONSHIP_TYPES].sort());
  });
});

function form(entries: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

describe("relationshipFormToCreateInput", () => {
  it("outgoing: this resource is `from`", () => {
    const input = relationshipFormToCreateInput(
      form({ direction: "outgoing", otherResourceId: "sql", type: "USES_DATABASE", note: "" }),
      "api",
    );
    expect(relationshipCreateSchema.parse(input)).toEqual({
      fromResourceId: "api",
      toResourceId: "sql",
      type: "USES_DATABASE",
      note: null,
    });
  });

  it("incoming: this resource is `to`", () => {
    const input = relationshipFormToCreateInput(
      form({ direction: "incoming", otherResourceId: "web", type: "CALLS", note: " via HTTPS " }),
      "api",
    );
    expect(relationshipCreateSchema.parse(input)).toMatchObject({
      fromResourceId: "web",
      toResourceId: "api",
      note: "via HTTPS",
    });
  });
});

describe("relationshipCreateSchema", () => {
  it("rejects self-relationships and reports them on the resource picker", () => {
    const result = relationshipCreateSchema.safeParse({
      fromResourceId: "a",
      toResourceId: "a",
      type: "CALLS",
    });
    expect(result.success).toBe(false);
    expect(relationshipFieldErrors(result.error!)).toHaveProperty("otherResourceId");
  });

  it("rejects unknown types and missing resources", () => {
    const result = relationshipCreateSchema.safeParse({
      fromResourceId: "a",
      toResourceId: "",
      type: "LOVES",
    });
    expect(Object.keys(relationshipFieldErrors(result.error!)).sort()).toEqual([
      "otherResourceId",
      "type",
    ]);
  });
});
