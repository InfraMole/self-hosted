// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { resolveTech } from "./tech";

describe("resolveTech", () => {
  it("says what it is and where it runs", () => {
    expect(resolveTech(["docker", "postgresql", "compose:shop"])).toEqual({
      primary: "postgresql",
      platform: "docker",
    });
    expect(resolveTech(["kubernetes", "k8s:prod", "ns:shop", "nginx"])).toEqual({
      primary: "nginx",
      platform: "kubernetes",
    });
    expect(resolveTech(["sql-server"])).toEqual({ primary: "sql-server" });
    expect(resolveTech(["MSSQL", "windows"])).toEqual({ primary: "sql-server" });
  });

  it("falls back to the platform, then the OS", () => {
    expect(resolveTech(["docker", "compose:shop"])).toEqual({ primary: "docker" });
    expect(resolveTech(["vmware"])).toEqual({ primary: "vmware" });
    expect(resolveTech(["hetzner", "env:prod"])).toEqual({ primary: "hetzner" });
    expect(resolveTech([], "Ubuntu 24.04.1 LTS")).toEqual({ primary: "linux" });
    expect(resolveTech(["internal"], "Windows Server 2022")).toEqual({ primary: "windows" });
    expect(resolveTech([], "Proxmox VE 8")).toEqual({ primary: "proxmox" });
    expect(resolveTech(["internal"])).toEqual({});
    expect(resolveTech(null)).toEqual({});
  });
});
