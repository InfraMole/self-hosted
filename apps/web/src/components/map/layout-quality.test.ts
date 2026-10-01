// SPDX-License-Identifier: AGPL-3.0-only
/** Layout quality on the demo infrastructure (M26): numbers, not impressions. */
import type { GraphEdge } from "@depmap/graph";
import { describe, expect, it } from "vitest";
import { RELATIONSHIPS, RESOURCES } from "@/server/modules/demo/example-data";
import { UPWARD_EDGE_TYPES, layoutGraph } from "./layout";
import { layoutMetrics } from "./layout-metrics";

const nodes = RESOURCES.filter((r) => r.status !== "ARCHIVED").map((r) => ({
  id: r.name,
  type: r.type,
}));
const edges: GraphEdge[] = RELATIONSHIPS.map(([from, type, to], i) => ({
  id: `e${i}`,
  from,
  to,
  type,
}));

describe("demo map layout", () => {
  it("reports its metrics", () => {
    const pos = layoutGraph(
      nodes.map((n) => n.id),
      edges,
      new Map(nodes.map((n) => [n.id, n.type])),
    );
    const m = layoutMetrics(pos, edges, UPWARD_EDGE_TYPES);
    console.log("demo layout", JSON.stringify(m));
    expect(m.overlaps).toBe(0);
  });
});
