/**
 * Cut a release: preflight checks -> commit-and-tag-version (bump the version in
 * apps/desktop/package.json and apps/server/package.json, commit, tag) -> push.
 * The tag push triggers the release workflow.
 *
 * Usage:
 *   mise run release                          # stable from main
 *   mise run release:canary                   # canary from main
 *   mise run release:beta                     # beta from the current branch
 *   mise run release -- --release-as 0.2.0    # force an exact version
 *   mise run release -- --dry-run             # preview without touching anything
 */
import { $ } from "bun";

const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run");
const prerelease = _optionValue(args, "--prerelease");
const isBranchBeta = prerelease === "beta";

function fail(message: string): never {
  console.error(`✖ ${message}`);
  process.exit(1);
}

const branch = (await $`git rev-parse --abbrev-ref HEAD`.text()).trim();
if (branch === "HEAD") {
  fail("releases must be cut from a branch, not a detached HEAD");
}
if (!isBranchBeta && branch !== "main") {
  fail(`stable/canary releases are cut from main (current: ${branch})`);
}

const dirty = (await $`git status --porcelain`.text()).trim();
if (dirty) fail("working tree is dirty — commit or stash first");

const upstream = await _upstreamRef(branch);
if (isBranchBeta) {
  if (!upstream) {
    fail(`beta releases require ${branch} to have an upstream branch`);
  }
  await $`git fetch origin --tags`;
} else {
  await $`git fetch origin main --tags`;
}

const local = (await $`git rev-parse HEAD`.text()).trim();
const remoteRef = isBranchBeta ? upstream : "origin/main";
const remote = (await $`git rev-parse ${remoteRef}`.text()).trim();
if (local !== remote) {
  fail(`${branch} is not in sync with ${remoteRef} — push or pull first`);
}

await $`bunx commit-and-tag-version ${args}`;

if (isDryRun) process.exit(0);

// --atomic: all-or-nothing — if the branch is rejected (e.g. someone pushed in
// the meantime), the tag must not land alone and trigger a release off an orphan.
await $`git push --atomic --follow-tags origin ${branch}`;

const { version } = (await Bun.file("apps/desktop/package.json").json()) as {
  version: string;
};
const repo = await _originRepo();
console.info(
  `\n✔ v${version} pushed — release CI: https://github.com/${repo}/actions`
);

function _optionValue(args: string[], name: string): string | undefined {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === name) return args[i + 1];
    if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
  }
  return undefined;
}

async function _upstreamRef(branch: string): Promise<string | null> {
  try {
    return (
      await $`git rev-parse --abbrev-ref ${branch}@{upstream}`.text()
    ).trim();
  } catch {
    return null;
  }
}

async function _originRepo(): Promise<string> {
  try {
    const url = (await $`git remote get-url origin`.text()).trim();
    const sshMatch = /github\.com[:/]([^/]+\/[^/.]+)(?:\.git)?$/.exec(url);
    return sshMatch?.[1] ?? "deer-flow/llm-space";
  } catch {
    return "deer-flow/llm-space";
  }
}
