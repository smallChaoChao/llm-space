import type {
  AgentEvent,
  BuiltinTool,
  FileNode,
  McpServerView,
  ModelConfig,
  ModelProviderGroup,
  NetworkSettings,
  SearchSettings,
  SkillsSettings,
  Thread,
} from "@llm-space/core";
import {
  REMOTE_RUNTIME_PROTOCOL_VERSION,
  type RemoteRuntimeHealthResponse,
  type RemoteRuntimeRpcMethod,
  type RemoteRuntimeRpcRequest,
  type RemoteRuntimeRpcResponse,
} from "@llm-space/runtime/remote-protocol";
import type {
  RuntimeAbortStreamPayload,
  RuntimeClient,
  RuntimeId,
  RuntimeInfo,
  RuntimeStreamRequestPayload,
  RuntimeStreamResponsePayload,
} from "@llm-space/runtime/runtime";

export interface RemoteRuntimeClientOptions {
  id: RuntimeId;
  name: string;
  baseUrl: string;
  token: string;
}

export class RemoteRuntimeClient implements RuntimeClient {
  private readonly _baseUrl: string;
  private _health: RemoteRuntimeHealthResponse | null = null;
  private readonly _activeStreams = new Map<string, AbortController>();

  constructor(private readonly _options: RemoteRuntimeClientOptions) {
    this._baseUrl = _options.baseUrl.replace(/\/+$/, "");
  }

  async connect(): Promise<void> {
    const health = await this._fetchHealth();
    const protocolVersion = Number(health.protocolVersion);
    if (protocolVersion !== REMOTE_RUNTIME_PROTOCOL_VERSION) {
      throw new Error(
        `Remote runtime protocol mismatch: expected ${REMOTE_RUNTIME_PROTOCOL_VERSION}, got ${protocolVersion}.`
      );
    }
    this._health = health;
  }

  info(): RuntimeInfo {
    return {
      id: this._options.id,
      kind: "remote",
      name: this._options.name,
      status: this._health ? "connected" : "disconnected",
      capabilities: this._health?.capabilities ?? [],
    };
  }

  availableModels() {
    return this._rpc<ModelProviderGroup[]>("models.available");
  }

  builtinProviders() {
    return this._rpc<ModelProviderGroup[]>("models.builtinProviders");
  }

  getDefaultModel() {
    return this._rpc<ModelConfig | null>("models.getDefault");
  }

  resolveGeneratorEnv(
    input: Parameters<RuntimeClient["resolveGeneratorEnv"]>[0]
  ) {
    return this._rpc<{ modelApiKey: string; envValues: Record<string, string> }>(
      "models.resolveGeneratorEnv",
      input
    );
  }

  fsLs(path: string) {
    return this._rpc<FileNode[]>("fs.ls", { path });
  }

  async fsMkdir(path: string) {
    await this._rpc<null>("fs.mkdir", { path });
  }

  fsRead(path: string) {
    return this._rpc<Thread>("fs.read", { path });
  }

  async fsWrite(path: string, thread: Thread) {
    await this._rpc<null>("fs.write", { path, thread });
  }

  async fsRealpath(path: string) {
    const result = await this._rpc<{ path: string }>("fs.realpath", { path });
    return result.path;
  }

  mcpListServers() {
    return this._rpc<McpServerView[]>("mcp.listServers");
  }

  builtInListTools() {
    return this._rpc<BuiltinTool[]>("builtinTools.list");
  }

  getSearchSettings() {
    return this._rpc<SearchSettings>("search.get");
  }

  getNetworkSettings() {
    return this._rpc<NetworkSettings>("network.get");
  }

  skillsGetSettings() {
    return this._rpc<SkillsSettings>("skills.getSettings");
  }

  async streamThread(
    payload: RuntimeStreamRequestPayload,
    send: (message: RuntimeStreamResponsePayload) => void
  ): Promise<void> {
    const controller = new AbortController();
    this._activeStreams.set(payload.streamId, controller);
    try {
      const response = await fetch(`${this._baseUrl}/stream`, {
        method: "POST",
        headers: this._headers(),
        body: JSON.stringify({ request: payload.request }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(await _httpError(response));
      }
      if (!response.body) {
        throw new Error("Remote runtime stream response has no body.");
      }
      for await (const value of _parseSse(response.body)) {
        if (value === "[START]") {
          continue;
        }
        if (value === "[DONE]") {
          send({ streamId: payload.streamId, type: "done" });
          return;
        }
        const event = JSON.parse(value) as
          AgentEvent | { type: "error"; message: string };
        if (event.type === "error") {
          send({
            streamId: payload.streamId,
            type: "error",
            message: event.message,
          });
        } else {
          send({ streamId: payload.streamId, type: "event", event });
        }
      }
      send({ streamId: payload.streamId, type: "done" });
    } finally {
      this._activeStreams.delete(payload.streamId);
    }
  }

  abortStream(payload: RuntimeAbortStreamPayload): void {
    this._activeStreams.get(payload.streamId)?.abort();
  }

  shutdown(): void {
    for (const controller of this._activeStreams.values()) {
      controller.abort();
    }
    this._activeStreams.clear();
  }

  removeProvider() {
    return Promise.reject(_notImplemented("models.removeProvider"));
  }
  addProvider() {
    return Promise.reject(_notImplemented("models.addProvider"));
  }
  addCustomProvider() {
    return Promise.reject(_notImplemented("models.addCustomProvider"));
  }
  updateProvider() {
    return Promise.reject(_notImplemented("models.updateProvider"));
  }
  setModelEnabled() {
    return Promise.reject(_notImplemented("models.setModelEnabled"));
  }
  setAllModelsEnabled() {
    return Promise.reject(_notImplemented("models.setAllModelsEnabled"));
  }
  setDefaultModel() {
    return Promise.reject(_notImplemented("models.setDefaultModel"));
  }
  testModelConnection() {
    return Promise.reject(_notImplemented("models.testConnection"));
  }
  removeCustomModel() {
    return Promise.reject(_notImplemented("models.removeCustomModel"));
  }
  upsertCustomModel() {
    return Promise.reject(_notImplemented("models.upsertCustomModel"));
  }
  fsCp() {
    return Promise.reject(_notImplemented("fs.cp"));
  }
  fsMv() {
    return Promise.reject(_notImplemented("fs.mv"));
  }
  fsRm() {
    return Promise.reject(_notImplemented("fs.rm"));
  }
  mcpAddServer() {
    return Promise.reject(_notImplemented("mcp.addServer"));
  }
  mcpUpdateServer() {
    return Promise.reject(_notImplemented("mcp.updateServer"));
  }
  mcpRemoveServer() {
    return Promise.reject(_notImplemented("mcp.removeServer"));
  }
  mcpDisconnectServer() {
    return Promise.reject(_notImplemented("mcp.disconnectServer"));
  }
  mcpListTools() {
    return Promise.reject(_notImplemented("mcp.listTools"));
  }
  mcpCallTool() {
    return Promise.reject(_notImplemented("mcp.callTool"));
  }
  builtInCallTool() {
    return Promise.reject(_notImplemented("builtinTools.call"));
  }
  setSearchSettings(settings: SearchSettings): SearchSettings {
    void settings;
    throw _notImplemented("search.set");
  }
  setNetworkSettings(settings: NetworkSettings): NetworkSettings {
    void settings;
    throw _notImplemented("network.set");
  }
  detectSystemProxy(): never {
    throw _notImplemented("network.detectSystemProxy");
  }
  skillsAddPath(): never {
    throw _notImplemented("skills.addPath");
  }
  skillsRemovePath(): never {
    throw _notImplemented("skills.removePath");
  }
  skillsSetSkillHidden(): never {
    throw _notImplemented("skills.setSkillHidden");
  }
  skillsSetAllSkillsHidden(): never {
    throw _notImplemented("skills.setAllSkillsHidden");
  }
  skillsListSkills() {
    return [];
  }
  skillsReadSkill(): never {
    throw _notImplemented("skills.readSkill");
  }

  private async _fetchHealth(): Promise<RemoteRuntimeHealthResponse> {
    const response = await fetch(`${this._baseUrl}/health`, {
      headers: this._headers(),
    });
    if (!response.ok) {
      throw new Error(await _httpError(response));
    }
    return (await response.json()) as RemoteRuntimeHealthResponse;
  }

  private async _rpc<TResult>(
    method: RemoteRuntimeRpcMethod,
    params?: unknown
  ): Promise<TResult> {
    const request: RemoteRuntimeRpcRequest = {
      id: crypto.randomUUID(),
      method,
      ...(params === undefined ? {} : { params }),
    };
    const response = await fetch(`${this._baseUrl}/rpc`, {
      method: "POST",
      headers: this._headers(),
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      throw new Error(await _httpError(response));
    }
    const body = (await response.json()) as RemoteRuntimeRpcResponse<TResult>;
    if (!body.ok) {
      throw new Error(body.error.message);
    }
    return body.result;
  }

  private _headers(): HeadersInit {
    return {
      Authorization: `Bearer ${this._options.token}`,
      "Content-Type": "application/json",
    };
  }
}

function _notImplemented(method: string): Error {
  return new Error(`Remote runtime method is not implemented yet: ${method}`);
}

async function _httpError(response: Response): Promise<string> {
  const text = await response.text();
  return `Remote runtime request failed: HTTP ${response.status} ${response.statusText}${text ? ` - ${text}` : ""}`;
}

async function* _parseSse(
  body: ReadableStream<Uint8Array>
): AsyncIterable<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let index: number;
    while ((index = buffer.indexOf("\n\n")) >= 0) {
      const raw = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const data = raw
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data) {
        yield data;
      }
    }
  }
}
