import type { RuntimeId } from "./runtime";

export interface RemoteServerDraft {
  name: string;
  host: string;
  user?: string;
  port?: number;
  identityFile?: string;
  remoteRepo?: string;
  remoteInstallDir?: string;
  remoteHome?: string;
  remoteServerPort?: number;
  localPort?: number;
}

export interface RemoteServerConfig extends RemoteServerDraft {
  id: string;
  kind: "ssh";
  port?: number;
  remoteInstallDir: string;
  remoteHome: string;
  remoteServerPort: number;
  createdAt: number;
  updatedAt: number;
}

export type RemoteConnectionStage =
  | "idle"
  | "ssh-check"
  | "platform-detect"
  | "server-install"
  | "server-start"
  | "tunnel-start"
  | "health-check"
  | "connected"
  | "error";

export interface RemoteServerView extends RemoteServerConfig {
  runtimeId: RuntimeId;
  status: "connected" | "connecting" | "disconnected" | "error";
  defaultRuntime: boolean;
  stage?: RemoteConnectionStage;
  stageLabel?: string;
  statusUpdatedAt?: number;
  error?: string;
}

export interface RemoteServerStatusChangedPayload {
  servers: RemoteServerView[];
}
