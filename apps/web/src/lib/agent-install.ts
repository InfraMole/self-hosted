// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Install commands shown once with a new enrollment token. With a release
 * base URL (AGENT_DOWNLOAD_BASE_URL), the commands download the binary and
 * SHA256SUMS and refuse to run on a checksum mismatch (docs/AGENT.md §10).
 */
export interface InstallInput {
  token: string;
  serverUrl: string;
  insecure: boolean;
  downloadBaseUrl?: string | null;
}

export interface InstallCommands {
  windows: string;
  linux: string;
}

export const AGENT_ASSETS = [
  { label: "Windows x64", file: "inframole-agent_windows_amd64.exe" },
  { label: "Windows ARM64", file: "inframole-agent_windows_arm64.exe" },
  { label: "Linux x64", file: "inframole-agent_linux_amd64" },
  { label: "Linux ARM64", file: "inframole-agent_linux_arm64" },
  { label: "SHA256SUMS", file: "SHA256SUMS" },
  { label: "Signature bundle", file: "SHA256SUMS.sigstore.json" },
] as const;

/** Permanent binary locations: the OS service runs the binary from where it was installed. */
export const WINDOWS_AGENT_DIR = "$env:ProgramFiles\\InfraMole";
export const LINUX_AGENT_PATH = "/usr/local/bin/inframole-agent";

export function installCommands({
  token,
  serverUrl,
  insecure,
  downloadBaseUrl,
}: InstallInput): InstallCommands {
  const flag = insecure ? " --insecure-dev" : "";
  const winDir = `$dir = "${WINDOWS_AGENT_DIR}"; New-Item -ItemType Directory -Force $dir | Out-Null`;
  const winInstall = [
    `$env:INFRAMOLE_ENROLLMENT_TOKEN = "${token}"`,
    `& "$dir\\inframole-agent.exe" install --server ${serverUrl}${flag}`,
  ].join("\n");
  const linuxInstall = `sudo INFRAMOLE_ENROLLMENT_TOKEN=${token} ${LINUX_AGENT_PATH} install --server ${serverUrl}${flag}`;
  const base = downloadBaseUrl?.replace(/\/+$/, "");

  if (!base) {
    // The user downloaded the binary into the current directory.
    return {
      windows: [winDir, "Copy-Item .\\inframole-agent.exe $dir -Force", winInstall].join("\n"),
      linux: [`sudo install -m 0755 ./inframole-agent ${LINUX_AGENT_PATH}`, linuxInstall].join(
        "\n",
      ),
    };
  }

  const windows = [
    winDir,
    "Set-Location $dir",
    `$arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "amd64" }`,
    `$file = "inframole-agent_windows_$arch.exe"`,
    `Invoke-WebRequest "${base}/$file" -OutFile inframole-agent.exe`,
    `Invoke-WebRequest "${base}/SHA256SUMS" -OutFile SHA256SUMS`,
    // Lines are "<sha256>  <file>" (or "<sha256> *<file>" in binary mode).
    `$expected = Get-Content SHA256SUMS | ForEach-Object { $h, $n = $_ -split '\\s+\\*?', 2; if ($n -eq $file) { $h } }`,
    `if (-not $expected -or (Get-FileHash inframole-agent.exe -Algorithm SHA256).Hash -ne $expected) { Remove-Item inframole-agent.exe; throw "Checksum mismatch: do not run this file." }`,
    winInstall,
  ].join("\n");

  const linux = [
    `cd "$(mktemp -d)"`,
    `ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')`,
    `curl -fsSLO "${base}/inframole-agent_linux_$ARCH" -O "${base}/SHA256SUMS"`,
    `sha256sum --ignore-missing -c SHA256SUMS && sudo install -m 0755 "inframole-agent_linux_$ARCH" ${LINUX_AGENT_PATH}`,
    linuxInstall,
  ].join("\n");

  return { windows, linux };
}
