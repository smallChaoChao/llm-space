import type { ServerPackageManifest } from "@llm-space/runtime/remote-package";

import { execRemoteCommand } from "./remote-exec";
import { parseRemotePlatform } from "./remote-platform";
import {
  currentDesktopVersion,
  expectedProtocolVersion,
  serverPackageAssetName,
  serverPackageAssetUrl,
} from "./server-package";
import type { SshRemoteRuntimeConfig } from "./ssh-bootstrap-config";
import { buildSshTarget, shellQuote } from "./ssh-command";

export interface RemoteServerInstallResult {
  entrypoint: string;
  version: string;
  platform: { os: "linux"; arch: "x64" | "arm64" };
}

export type RemoteCommandRunner = (
  config: SshRemoteRuntimeConfig,
  command: string,
  timeoutMs?: number
) => Promise<{ stdout: string; stderr: string }>;

export interface RemoteServerInstallOptions {
  onProgress?: (progress: {
    stage: "platform-detect" | "server-install";
    message: string;
  }) => void;
}

export class RemoteServerInstallError extends Error {
  constructor(
    readonly stage: "platform-detect" | "server-install",
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "RemoteServerInstallError";
  }
}

const INSTALL_TIMEOUT_MS = 300_000;

export async function installRemoteServerPackage(
  config: SshRemoteRuntimeConfig,
  run: RemoteCommandRunner = execRemoteCommand,
  options: RemoteServerInstallOptions = {}
): Promise<RemoteServerInstallResult> {
  options.onProgress?.({
    stage: "platform-detect",
    message: "Detecting remote platform",
  });
  let platform;
  try {
    platform = await detectRemoteServerPlatform(config, run);
  } catch (error) {
    throw new RemoteServerInstallError(
      "platform-detect",
      error instanceof Error ? error.message : String(error),
      { cause: error }
    );
  }
  const version = currentDesktopVersion();
  const installDir = config.remoteInstallDir;
  const packageDir = `${installDir}/versions/${version}`;
  const manifestPath = `${packageDir}/server-manifest.json`;
  const assetName = serverPackageAssetName({ version, ...platform });
  const assetUrl = serverPackageAssetUrl({
    baseUrl: process.env.LLM_SPACE_SERVER_PACKAGE_BASE_URL,
    target: { version, ...platform },
  });
  const entrypoint = `${packageDir}/bin/llm-space-server`;

  if (await _hasInstalledPackage(config, run, manifestPath, version, platform)) {
    options.onProgress?.({
      stage: "server-install",
      message: "Remote runtime is already installed",
    });
    await _pointCurrentAtVersion(config, run, installDir, version);
    return { entrypoint, version, platform };
  }

  options.onProgress?.({
    stage: "server-install",
    message: "Downloading remote runtime package",
  });
  try {
    await run(
      config,
      buildInstallCommand({
        installDir,
        version,
        assetName,
        assetUrl,
        packageDir,
      }),
      INSTALL_TIMEOUT_MS
    );
  } catch (error) {
    throw new RemoteServerInstallError(
      "server-install",
      _formatInstallFailure(config, {
        error,
        assetName,
        assetUrl,
        timeoutMs: INSTALL_TIMEOUT_MS,
      }),
      { cause: error }
    );
  }

  if (!(await _hasInstalledPackage(config, run, manifestPath, version, platform))) {
    throw new Error(`Remote server package install verification failed: ${assetName}`);
  }
  await _pointCurrentAtVersion(config, run, installDir, version);
  return { entrypoint, version, platform };
}

export async function detectRemoteServerPlatform(
  config: SshRemoteRuntimeConfig,
  run: RemoteCommandRunner = execRemoteCommand
) {
  const result = await run(config, "printf '%s\\n%s\\n' \"$(uname -s)\" \"$(uname -m)\"");
  const [unameS = "", unameM = ""] = result.stdout.trim().split(/\r?\n/);
  return parseRemotePlatform({ unameS, unameM });
}

export function buildInstallCommand(input: {
  installDir: string;
  version: string;
  assetName: string;
  assetUrl: string;
  packageDir: string;
}): string {
  const installDir = shellQuote(input.installDir);
  const version = shellQuote(input.version);
  const assetName = shellQuote(input.assetName);
  const assetUrl = shellQuote(input.assetUrl);
  const packageDir = shellQuote(input.packageDir);
  return [
    "set -e",
    `INSTALL_DIR=${installDir}`,
    `VERSION=${version}`,
    `ASSET_NAME=${assetName}`,
    `ASSET_URL=${assetUrl}`,
    'DOWNLOAD_DIR="$INSTALL_DIR/downloads"',
    'TMP_DIR="$INSTALL_DIR/.tmp-$VERSION-$$"',
    'mkdir -p "$INSTALL_DIR/versions" "$DOWNLOAD_DIR"',
    'rm -rf "$TMP_DIR"',
    'mkdir -p "$TMP_DIR"',
    'ARCHIVE="$DOWNLOAD_DIR/$ASSET_NAME"',
    'if command -v curl >/dev/null 2>&1; then curl -fL --connect-timeout 15 --max-time 240 --retry 2 --retry-delay 2 "$ASSET_URL" -o "$ARCHIVE"; elif command -v wget >/dev/null 2>&1; then wget --timeout=30 --tries=3 -O "$ARCHIVE" "$ASSET_URL"; else echo "curl or wget is required to download llm-space-server" >&2; exit 1; fi',
    'tar -xzf "$ARCHIVE" -C "$TMP_DIR"',
    'EXTRACTED="$(find "$TMP_DIR" -mindepth 1 -maxdepth 1 -type d | head -1)"',
    'test -n "$EXTRACTED"',
    `rm -rf ${packageDir}`,
    `mv "$EXTRACTED" ${packageDir}`,
    'rm -rf "$TMP_DIR"',
    `ln -sfn ${shellQuote(`versions/${input.version}`)} "$INSTALL_DIR/current"`,
  ].join(" && ");
}

function _formatInstallFailure(
  config: SshRemoteRuntimeConfig,
  input: {
    error: unknown;
    assetName: string;
    assetUrl: string;
    timeoutMs: number;
  }
): string {
  const message =
    input.error instanceof Error ? input.error.message : String(input.error);
  const target = buildSshTarget(config);
  const probeCommand = `ssh ${target} ${shellQuote(
    `curl -I -L --connect-timeout 15 ${shellQuote(input.assetUrl)}`
  )}`;
  if (/timed out after \d+ms/i.test(message)) {
    return [
      `Remote runtime package download timed out after ${input.timeoutMs}ms.`,
      `Package URL: ${input.assetUrl}`,
      `LLM Space can reach the SSH server, but the server did not finish downloading ${input.assetName}.`,
      `Check remote network access with: ${probeCommand}`,
      "If GitHub is blocked or slow on the remote server, configure the remote server's proxy for curl/wget or use a mirrored release asset URL.",
    ].join(" ");
  }
  return [
    `Package URL: ${input.assetUrl}`,
    message,
    `Check remote network access with: ${probeCommand}`,
  ].join(" ");
}

async function _hasInstalledPackage(
  config: SshRemoteRuntimeConfig,
  run: RemoteCommandRunner,
  manifestPath: string,
  version: string,
  platform: { os: "linux"; arch: "x64" | "arm64" }
): Promise<boolean> {
  try {
    const result = await run(config, `cat ${shellQuote(manifestPath)}`, 10_000);
    const manifest = JSON.parse(result.stdout) as ServerPackageManifest;
    return (
      manifest.name === "llm-space-server" &&
      manifest.version === version &&
      manifest.protocolVersion === expectedProtocolVersion() &&
      manifest.os === platform.os &&
      manifest.arch === platform.arch &&
      Boolean(manifest.entrypoint)
    );
  } catch {
    return false;
  }
}

async function _pointCurrentAtVersion(
  config: SshRemoteRuntimeConfig,
  run: RemoteCommandRunner,
  installDir: string,
  version: string
): Promise<void> {
  await run(
    config,
    `mkdir -p ${shellQuote(installDir)} && ln -sfn ${shellQuote(
      `versions/${version}`
    )} ${shellQuote(`${installDir}/current`)}`,
    10_000
  );
}
