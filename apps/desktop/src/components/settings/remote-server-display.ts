import type {
  RemoteConnectionStage,
  RemoteConnectionStepView,
  RemoteServerView,
} from "@/shared/remote-servers";

const STAGE_SUMMARY: Record<RemoteConnectionStage, string> = {
  idle: "Idle",
  "ssh-check": "SSH",
  "host-key-check": "Host key",
  "platform-detect": "Platform",
  "server-install": "Installing",
  "server-start": "Starting",
  "tunnel-start": "Tunnel",
  "health-check": "Verifying",
  connected: "Connected",
  error: "Failed",
};

export function remoteStageSummary(server: RemoteServerView): string | null {
  if (server.status === "connected") return "Connected";
  if (server.status === "error") return "Failed";
  if (server.status === "trust-required") return "Host key";
  if (server.stage) return STAGE_SUMMARY[server.stage];
  return null;
}

export function remoteConnectionChecked(server: RemoteServerView): boolean {
  return server.status === "connected";
}

export function remoteConnectionDisabled(
  server: RemoteServerView,
  busy: boolean
): boolean {
  return (
    busy ||
    server.status === "connecting" ||
    server.status === "trust-required"
  );
}

export function remoteConnectionFlow(
  server: RemoteServerView
): RemoteConnectionStepView[] {
  return server.steps ?? [];
}

export interface RemoteConnectionAction {
  label: "Connect" | "Disconnect" | "Connecting" | "Trust required";
  action: "connect" | "disconnect" | null;
  disabled: boolean;
}

export function remoteConnectionAction(
  server: RemoteServerView,
  busy: boolean
): RemoteConnectionAction {
  if (server.status === "connecting") {
    return { label: "Connecting", action: null, disabled: true };
  }
  if (server.status === "trust-required") {
    return { label: "Trust required", action: null, disabled: true };
  }
  if (server.status === "connected") {
    return { label: "Disconnect", action: "disconnect", disabled: busy };
  }
  return { label: "Connect", action: "connect", disabled: busy };
}
