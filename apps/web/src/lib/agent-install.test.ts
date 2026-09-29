// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { installCommands } from "./agent-install";

const input = { token: "dmp_enr_abc", serverUrl: "https://inframole.example.com", insecure: false };

describe("installCommands", () => {
  it("without a release URL, moves the user's binary to a permanent place and enrolls", () => {
    const { windows, linux } = installCommands(input);
    expect(windows).toContain('$dir = "$env:ProgramFiles\\InfraMole"');
    expect(windows).toContain("Copy-Item .\\inframole-agent.exe $dir -Force");
    expect(windows).toContain(
      '& "$dir\\inframole-agent.exe" install --server https://inframole.example.com',
    );
    expect(linux).toBe(
      [
        "sudo install -m 0755 ./inframole-agent /usr/local/bin/inframole-agent",
        "sudo INFRAMOLE_ENROLLMENT_TOKEN=dmp_enr_abc /usr/local/bin/inframole-agent install --server https://inframole.example.com",
      ].join("\n"),
    );
  });

  it("with a release URL, downloads and verifies the checksum before installing", () => {
    const { windows, linux } = installCommands({
      ...input,
      downloadBaseUrl: "https://github.com/o/r/releases/latest/download/",
    });
    expect(linux).toContain(
      'curl -fsSLO "https://github.com/o/r/releases/latest/download/inframole-agent_linux_$ARCH"',
    );
    expect(linux).toMatch(
      /sha256sum --ignore-missing -c SHA256SUMS && sudo install -m 0755 .* \/usr\/local\/bin\/inframole-agent/,
    );
    expect(linux.indexOf("sha256sum")).toBeLessThan(linux.indexOf("install --server"));
    expect(windows).toContain("Set-Location $dir");
    expect(windows).toContain("Get-FileHash inframole-agent.exe -Algorithm SHA256");
    expect(windows).toContain("-split '\\s+\\*?', 2");
    expect(windows).toContain('throw "Checksum mismatch');
    expect(windows.indexOf("Get-FileHash")).toBeLessThan(windows.indexOf("install --server"));
    // The token never goes into a URL.
    expect(`${windows}\n${linux}`.match(/https:\/\/\S*dmp_enr/)).toBeNull();
  });

  it("adds --insecure-dev only for http servers", () => {
    expect(installCommands({ ...input, insecure: true }).linux).toMatch(/--insecure-dev$/);
  });
});
