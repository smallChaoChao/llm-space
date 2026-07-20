import type { RuntimeId } from "./runtime";

export interface RemoteServerDraft {
  name: string;
  host: string;
  user?: string;
  port?: number;
  identityFile?: string;
  remoteRepo: string;
  remoteHome?: string;
  remoteServerPort?: number;
  localPort?: number;
}

export interface RemoteServerConfig extends RemoteServerDraft {
  id: string;
  kind: "ssh";
  port: number;
  remoteHome: string;
  remoteServerPort: number;
  createdAt: number;
  updatedAt: number;
}

export interface RemoteServerView extends RemoteServerConfig {
  runtimeId: RuntimeId;
  status: "connected" | "connecting" | "disconnected" | "error";
  defaultRuntime: boolean;
  error?: string;
}
