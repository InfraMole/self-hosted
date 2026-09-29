// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  boundedDiff,
  describeIpChange,
  describeObservationDiff,
  diffObserved,
  isStale,
  observedState,
} from "./host-changes";

describe("observedState", () => {
  it("keeps running services and distinct ports, sorted", () => {
    expect(
      observedState({
        services: [
          { name: "W3SVC", state: "running" },
          { name: "Spooler", state: "stopped" },
          { name: "AppXSvc", state: "running" },
        ],
        listeners: [{ port: 443 }, { port: 80 }, { port: 443 }],
      }),
    ).toEqual({ services: ["AppXSvc", "W3SVC"], ports: [80, 443] });
    expect(observedState(null)).toEqual({ services: [], ports: [] });
  });
});

describe("diffObserved", () => {
  const prev = { services: ["A", "B"], ports: [80, 443] };

  it("treats the first report as a baseline", () => {
    expect(diffObserved(null, prev)).toBeNull();
  });

  it("returns null when nothing changed", () => {
    expect(diffObserved(prev, { services: ["A", "B"], ports: [80, 443] })).toBeNull();
  });

  it("reports started/stopped services and opened/closed ports", () => {
    const diff = diffObserved(prev, { services: ["B", "C"], ports: [443, 1433] });
    expect(diff).toEqual({
      servicesStarted: ["C"],
      servicesStopped: ["A"],
      portsOpened: [1433],
      portsClosed: [80],
    });
    expect(describeObservationDiff("SQL01", diff!)).toBe(
      "SQL01: new services C; stopped A; new listening ports 1433; closed ports 80",
    );
  });

  it("keeps summaries short and payloads bounded", () => {
    const many = Array.from({ length: 80 }, (_, i) => `svc${String(i).padStart(2, "0")}`);
    const diff = diffObserved({ services: [], ports: [] }, { services: many, ports: [] })!;
    expect(describeObservationDiff("H", diff)).toBe(
      "H: new services svc00, svc01, svc02, svc03, svc04 +75 more",
    );
    expect(boundedDiff(diff).servicesStarted).toHaveLength(50);
  });
});

describe("describeIpChange", () => {
  it("describes changes and ignores order/duplicates", () => {
    expect(describeIpChange("APP01", ["10.0.0.23"], ["10.0.0.99"])).toBe(
      "APP01 IP changed: 10.0.0.23 → 10.0.0.99",
    );
    expect(describeIpChange("APP01", ["b", "a"], ["a", "b", "a"])).toBeNull();
    expect(describeIpChange("APP01", [], ["10.0.0.1"])).toBe("APP01 IP changed: none → 10.0.0.1");
  });
});

describe("isStale", () => {
  const now = new Date("2026-09-28T12:00:00Z");
  it("is stale after 3 missed intervals, never before the first report", () => {
    expect(isStale(new Date("2026-09-28T11:50:00Z"), 300, now)).toBe(false); // 10 min
    expect(isStale(new Date("2026-09-28T11:44:00Z"), 300, now)).toBe(true); // 16 min
    expect(isStale(null, 300, now)).toBe(false);
  });
});
