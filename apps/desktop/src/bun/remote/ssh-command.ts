import type { SshRemoteRuntimeConfig } from "./ssh-bootstrap-config";

export function buildSshTarget(config: SshRemoteRuntimeConfig): string {
  return config.user ? `${config.user}@${config.host}` : config.host;
}

export function buildSshBaseArgs(config: SshRemoteRuntimeConfig): string[] {
  return [
    "-p",
    String(config.port),
    "-o",
    "BatchMode=yes",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=2",
    ...(config.identityFile ? ["-i", config.identityFile] : []),
    ...config.extraArgs,
    buildSshTarget(config),
  ];
}

export function buildTunnelArgs(input: {
  config: SshRemoteRuntimeConfig;
  localPort: number;
}): string[] {
  return [
    ...buildSshBaseArgs(input.config).slice(0, -1),
    "-o",
    "ExitOnForwardFailure=yes",
    "-N",
    "-L",
    `127.0.0.1:${input.localPort}:127.0.0.1:${input.config.remoteServerPort}`,
    buildSshTarget(input.config),
  ];
}

export function buildRemoteServerArgs(input: {
  config: SshRemoteRuntimeConfig;
  token: string;
}): string[] {
  return [
    ...buildSshBaseArgs(input.config),
    buildRemoteServerCommand({
      remoteRepo: input.config.remoteRepo,
      host: "127.0.0.1",
      port: input.config.remoteServerPort,
      token: input.token,
      home: input.config.remoteHome,
    }),
  ];
}

export function buildRemoteServerCommand(input: {
  remoteRepo: string;
  host: string;
  port: number;
  token: string;
  home: string;
}): string {
  return [
    "cd",
    shellQuote(input.remoteRepo),
    "&&",
    "exec bun --filter @llm-space/server dev --",
    "--host",
    shellQuote(input.host),
    "--port",
    String(input.port),
    "--token",
    shellQuote(input.token),
    "--home",
    shellQuote(input.home),
  ].join(" ");
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
