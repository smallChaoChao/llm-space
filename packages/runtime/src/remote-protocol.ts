import type { RuntimeCapability } from "./runtime";

export const REMOTE_RUNTIME_PROTOCOL_VERSION = 1;

export interface RemoteRuntimeHealthResponse {
  ok: true;
  version: string;
  protocolVersion: typeof REMOTE_RUNTIME_PROTOCOL_VERSION;
  capabilities: RuntimeCapability[];
  homePath: string;
  workspacePath: string;
  platform: {
    os: NodeJS.Platform;
    arch: string;
  };
}

export type RemoteRuntimeRpcMethod =
  | "runtime.info"
  | "fs.ls"
  | "fs.mkdir"
  | "fs.read"
  | "fs.write"
  | "fs.realpath"
  | "models.available"
  | "models.builtinProviders"
  | "models.getDefault"
  | "models.resolveGeneratorEnv"
  | "mcp.listServers"
  | "builtinTools.list"
  | "search.get"
  | "network.get"
  | "skills.getSettings";

export interface RemoteRuntimeRpcRequest<TParams = unknown> {
  id: string;
  method: RemoteRuntimeRpcMethod;
  params?: TParams;
}

export type RemoteRuntimeRpcResponse<TResult = unknown> =
  | { id: string; ok: true; result: TResult }
  | {
      id: string;
      ok: false;
      error: { code: string; message: string; detail?: unknown };
    };
