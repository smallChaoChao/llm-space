import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type {
  RemoteServerPackageArch,
  RemoteServerPackageOs,
  ServerPackageManifest,
} from "@llm-space/runtime/remote-package";
import { REMOTE_RUNTIME_PROTOCOL_VERSION } from "@llm-space/runtime/remote-protocol";

import serverPackageJson from "../package.json";

interface PackOptions {
  os: RemoteServerPackageOs;
  arch: RemoteServerPackageArch;
  outDir: string;
}

const REPO_ROOT = path.resolve(import.meta.dir, "../../..");
const SERVER_ROOT = path.join(REPO_ROOT, "apps/server");

async function main(): Promise<void> {
  const options = _parseArgs(Bun.argv.slice(2));
  const version = serverPackageJson.version;
  const packageName = `llm-space-server-${version}-${options.os}-${options.arch}`;
  const artifactsDir = path.resolve(REPO_ROOT, options.outDir);
  const stagingRoot = path.join(artifactsDir, ".staging");
  const packageRoot = path.join(stagingRoot, packageName);
  const binaryPath = path.join(packageRoot, "bin", "llm-space-server");
  const archivePath = path.join(artifactsDir, `${packageName}.tar.gz`);

  await rm(stagingRoot, { recursive: true, force: true });
  await mkdir(path.dirname(binaryPath), { recursive: true });
  await mkdir(artifactsDir, { recursive: true });

  await Bun.$`bun build ${path.join(SERVER_ROOT, "src/index.ts")} --compile --outfile ${binaryPath}`.cwd(
    REPO_ROOT
  );

  const manifest: ServerPackageManifest = {
    name: "llm-space-server",
    version,
    protocolVersion: REMOTE_RUNTIME_PROTOCOL_VERSION,
    os: options.os,
    arch: options.arch,
    createdAt: new Date().toISOString(),
    entrypoint: "bin/llm-space-server",
  };
  await writeFile(
    path.join(packageRoot, "server-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    path.join(packageRoot, "README.txt"),
    `LLM Space Runtime Server ${version}\n\nRun: ./bin/llm-space-server --token <token> [options]\n`,
    "utf8"
  );

  await rm(archivePath, { force: true });
  await Bun.$`tar -czf ${archivePath} -C ${stagingRoot} ${packageName}`.cwd(
    REPO_ROOT
  );

  const sha256 = await _sha256(archivePath);
  await writeFile(`${archivePath}.sha256`, `${sha256}  ${path.basename(archivePath)}\n`, "utf8");
  await rm(stagingRoot, { recursive: true, force: true });

  console.info(`Created ${path.relative(REPO_ROOT, archivePath)}`);
  console.info(`Created ${path.relative(REPO_ROOT, `${archivePath}.sha256`)}`);
}

function _parseArgs(argv: string[]): PackOptions {
  let target = _defaultTarget();
  let outDir = "apps/server/artifacts";
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--target") {
      target = _requireValue(argv, ++index, arg);
      continue;
    }
    if (arg === "--out-dir") {
      outDir = _requireValue(argv, ++index, arg);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  const [targetOs, targetArch] = target.split("-");
  if (targetOs !== "linux" || (targetArch !== "x64" && targetArch !== "arm64")) {
    throw new Error(`Unsupported server package target: ${target}`);
  }
  return { os: targetOs, arch: targetArch, outDir };
}

function _defaultTarget(): string {
  const platform = os.platform();
  const arch = os.arch();
  const targetOs = platform === "linux" ? "linux" : platform;
  const targetArch = arch === "x64" || arch === "arm64" ? arch : arch;
  return `${targetOs}-${targetArch}`;
}

function _requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

async function _sha256(filePath: string): Promise<string> {
  const file = Bun.file(filePath);
  const bytes = await file.arrayBuffer();
  return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
