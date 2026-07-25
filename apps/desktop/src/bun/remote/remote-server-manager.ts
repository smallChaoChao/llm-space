import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { uuid } from "@llm-space/core";
import { getSettingsDir } from "@llm-space/core/server";
import type {
  RuntimeClient,
  RuntimeId,
  RuntimeRouter,
} from "@llm-space/runtime/runtime";

import type {
  RemoteConnectionStage,
  RemoteServerConfig,
  RemoteServerDraft,
  RemoteServerStatusChangedPayload,
  RemoteServerView,
} from "../../shared/remote-servers";

import { DEFAULT_REMOTE_INSTALL_DIR } from "./server-package";
import type { SshRemoteRuntimeConfig } from "./ssh-bootstrap-config";
import { startSshRemoteRuntime } from "./ssh-remote-runtime";

interface RemoteRuntimeHandle {
  client: RuntimeClient;
  stop(): Promise<void> | void;
}

type StartSshRemoteRuntime = (
  config: SshRemoteRuntimeConfig,
  options?: {
    onProgress?: (progress: { stage: string; message: string }) => void;
  }
) => Promise<RemoteRuntimeHandle>;

interface RemoteServersConfigFile {
  version?: number;
  servers: RemoteServerConfig[];
}

const REMOTE_SERVERS_CONFIG_VERSION = 2;

interface ConnectedServer {
  status: "connected" | "connecting" | "error";
  stage: RemoteConnectionStage;
  stageLabel: string;
  updatedAt: number;
  handle?: RemoteRuntimeHandle;
  error?: string;
}

type RemoteServerStatusListener = (
  payload: RemoteServerStatusChangedPayload
) => void;

export class RemoteServerManager {
  private _servers: RemoteServerConfig[];
  private readonly _connections = new Map<string, ConnectedServer>();
  private _operationQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly _runtimeRouter: RuntimeRouter,
    private readonly _startSshRemoteRuntime: StartSshRemoteRuntime =
      startSshRemoteRuntime,
    private _onStatusChanged?: RemoteServerStatusListener
  ) {
    this._servers = this._load();
  }

  setStatusListener(listener: RemoteServerStatusListener): void {
    this._onStatusChanged = listener;
  }

  listServers(): RemoteServerView[] {
    return this._servers.map((server) => this._view(server));
  }

  addServer(draft: RemoteServerDraft): RemoteServerView[] {
    const now = Date.now();
    const server = this._normalizeDraft(draft, {
      id: uuid(),
      createdAt: now,
      updatedAt: now,
    });
    this._servers.push(server);
    this._save();
    return this.listServers();
  }

  updateServer(id: string, draft: RemoteServerDraft): RemoteServerView[] {
    this._assertNotConnected(id, "update");
    const index = this._servers.findIndex((server) => server.id === id);
    if (index === -1) {
      throw new Error(`Remote server not found: ${id}`);
    }
    const current = this._servers[index];
    this._servers[index] = this._normalizeDraft(draft, {
      id,
      createdAt: current.createdAt,
      updatedAt: Date.now(),
    });
    this._save();
    return this.listServers();
  }

  async removeServer(id: string): Promise<RemoteServerView[]> {
    return this._enqueue(async () => {
      await this._disconnectServer(id);
      const next = this._servers.filter((server) => server.id !== id);
      if (next.length === this._servers.length) {
        throw new Error(`Remote server not found: ${id}`);
      }
      this._servers = next;
      this._save();
      return this.listServers();
    });
  }

  async connectServer(id: string): Promise<RemoteServerView[]> {
    return this._enqueue(() => this._connectServer(id));
  }

  private async _connectServer(id: string): Promise<RemoteServerView[]> {
    const server = this._find(id);
    const existing = this._connections.get(id);
    if (existing?.status === "connected") {
      this._runtimeRouter.setDefaultRuntime(this._runtimeId(id));
      return this.listServers();
    }

    await this._disconnectOtherServers(id);
    this._setConnection(id, {
      status: "connecting",
      stage: "ssh-check",
      stageLabel: "Checking SSH access",
    });
    try {
      const handle = await this._startSshRemoteRuntime(this._sshConfig(server), {
        onProgress: ({ stage, message }) =>
          this._setConnection(id, {
            status: "connecting",
            stage: _connectionStage(stage),
            stageLabel: message,
          }),
      });
      const runtimeId = this._runtimeId(server.id);
      this._runtimeRouter.register(runtimeId, handle.client);
      this._runtimeRouter.setDefaultRuntime(runtimeId);
      this._setConnection(id, {
        status: "connected",
        stage: "connected",
        stageLabel: "Connected",
        handle,
      });
      return this.listServers();
    } catch (error) {
      this._setConnection(id, {
        status: "error",
        stage: "error",
        stageLabel: "Connection failed",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async disconnectServer(id: string): Promise<RemoteServerView[]> {
    return this._enqueue(() => this._disconnectServer(id));
  }

  private async _disconnectServer(id: string): Promise<RemoteServerView[]> {
    let stopError: unknown;
    const connection = this._connections.get(id);
    try {
      if (connection?.handle) {
        await connection.handle.stop();
      }
    } catch (error) {
      stopError = error;
    } finally {
      const runtimeId = this._runtimeId(id);
      if (this._runtimeRouter.getDefaultRuntimeId() === runtimeId) {
        this._runtimeRouter.setDefaultRuntime("local");
      }
      try {
        this._runtimeRouter.unregister(runtimeId);
      } catch {
        // Runtime may not have been registered or may already be removed.
      }
      this._connections.delete(id);
      this._emitStatusChanged();
    }
    if (stopError) {
      throw stopError instanceof Error
        ? stopError
        : new Error("Remote server stop failed.");
    }
    return this.listServers();
  }

  private async _disconnectOtherServers(keepId: string): Promise<void> {
    await Promise.all(
      [...this._connections.keys()]
        .filter((id) => id !== keepId)
        .map((id) => this._disconnectServer(id))
    );
  }

  setDefaultRuntime(runtimeId: RuntimeId): RemoteServerView[] {
    this._runtimeRouter.setDefaultRuntime(runtimeId);
    return this.listServers();
  }

  getDefaultRuntime(): RuntimeId {
    return this._runtimeRouter.getDefaultRuntimeId();
  }

  async shutdown(): Promise<void> {
    await this._enqueue(() =>
      Promise.all(
        [...this._connections.keys()].map((id) => this._disconnectServer(id))
      ).then(() => undefined)
    );
  }

  private _enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this._operationQueue.then(operation, operation);
    this._operationQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private _view(server: RemoteServerConfig): RemoteServerView {
    const connection = this._connections.get(server.id);
    const runtimeId = this._runtimeId(server.id);
    return {
      ...server,
      runtimeId,
      status: connection?.status ?? "disconnected",
      defaultRuntime: this._runtimeRouter.getDefaultRuntimeId() === runtimeId,
      ...(connection?.stage ? { stage: connection.stage } : {}),
      ...(connection?.stageLabel ? { stageLabel: connection.stageLabel } : {}),
      ...(connection?.updatedAt
        ? { statusUpdatedAt: connection.updatedAt }
        : {}),
      ...(connection?.error ? { error: connection.error } : {}),
    };
  }

  private _sshConfig(server: RemoteServerConfig): SshRemoteRuntimeConfig {
    return {
      id: this._runtimeId(server.id),
      name: server.name,
      host: server.host,
      user: server.user,
      port: server.port,
      identityFile: server.identityFile,
      extraArgs: [],
      remoteRepo: server.remoteRepo ?? "",
      remoteInstallDir: server.remoteInstallDir,
      remoteHome: server.remoteHome,
      remoteServerPort: server.remoteServerPort,
      localPort: server.localPort,
      makeDefault: false,
    };
  }

  private _runtimeId(id: string): RuntimeId {
    return `remote:${id}`;
  }

  private _find(id: string): RemoteServerConfig {
    const server = this._servers.find((item) => item.id === id);
    if (!server) {
      throw new Error(`Remote server not found: ${id}`);
    }
    return server;
  }

  private _assertNotConnected(id: string, action: string): void {
    if (this._connections.get(id)?.status === "connected") {
      throw new Error(`Disconnect remote server before ${action}: ${id}`);
    }
  }

  private _normalizeDraft(
    draft: RemoteServerDraft,
    meta: { id: string; createdAt: number; updatedAt: number }
  ): RemoteServerConfig {
    const name = draft.name.trim();
    const host = draft.host.trim();
    const remoteRepo = _optional(draft.remoteRepo);
    const remoteInstallDir =
      _optional(draft.remoteInstallDir) ?? DEFAULT_REMOTE_INSTALL_DIR;
    if (!name) throw new Error("Remote server name is required.");
    if (!host) throw new Error("Remote server host is required.");
    return {
      id: meta.id,
      kind: "ssh",
      name,
      host,
      user: _optional(draft.user),
      port: draft.port ? _port(draft.port, 0, "SSH port") : undefined,
      identityFile: _optional(draft.identityFile),
      remoteRepo,
      remoteInstallDir,
      remoteHome: _optional(draft.remoteHome) ?? "~/.llm-space-server",
      remoteServerPort: _port(
        draft.remoteServerPort,
        39123,
        "Remote server port"
      ),
      localPort: draft.localPort
        ? _port(draft.localPort, 0, "Local tunnel port")
        : undefined,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
    };
  }

  private get _configPath(): string {
    return path.join(getSettingsDir(), "remote-servers.json");
  }

  private _load(): RemoteServerConfig[] {
    if (!existsSync(this._configPath)) return [];
    const parsed = JSON.parse(
      readFileSync(this._configPath, "utf8")
    ) as RemoteServersConfigFile;
    const isLegacy = parsed.version !== REMOTE_SERVERS_CONFIG_VERSION;
    return Array.isArray(parsed.servers)
      ? parsed.servers.map((server) =>
          this._normalizeLoadedServer(server, { isLegacy })
        )
      : [];
  }

  private _save(): void {
    mkdirSync(getSettingsDir(), { recursive: true });
    writeFileSync(
      this._configPath,
      `${JSON.stringify(
        { version: REMOTE_SERVERS_CONFIG_VERSION, servers: this._servers },
        null,
        2
      )}\n`,
      "utf8"
    );
  }

  private _normalizeLoadedServer(
    server: RemoteServerConfig,
    options: { isLegacy: boolean }
  ): RemoteServerConfig {
    return {
      ...server,
      port:
        options.isLegacy && server.port === 22
          ? undefined
          : server.port
          ? _port(server.port, 0, "SSH port")
          : undefined,
      remoteRepo: _optional(server.remoteRepo),
      remoteInstallDir:
        _optional(server.remoteInstallDir) ?? DEFAULT_REMOTE_INSTALL_DIR,
      remoteHome: _optional(server.remoteHome) ?? "~/.llm-space-server",
      remoteServerPort: _port(
        server.remoteServerPort,
        39123,
        "Remote server port"
      ),
    };
  }

  private _setConnection(
    id: string,
    next: Omit<ConnectedServer, "updatedAt"> & { updatedAt?: number }
  ): void {
    this._connections.set(id, {
      ...next,
      updatedAt: next.updatedAt ?? Date.now(),
    });
    this._emitStatusChanged();
  }

  private _emitStatusChanged(): void {
    this._onStatusChanged?.({ servers: this.listServers() });
  }
}

function _connectionStage(stage: string): RemoteConnectionStage {
  switch (stage) {
    case "platform-detect":
    case "server-install":
    case "server-start":
    case "tunnel-start":
    case "health-check":
      return stage;
    default:
      return "ssh-check";
  }
}

function _optional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function _port(
  value: number | undefined,
  fallback: number,
  label: string
): number {
  const port = value ?? fallback;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${label} must be an integer between 1 and 65535.`);
  }
  return port;
}
