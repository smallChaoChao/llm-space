import { electrobun } from "@/lib/electrobun";
import type {
  RemoteServerDraft,
  RemoteServerView,
} from "@/shared/remote-servers";
import type { RuntimeId, RuntimeView } from "@/shared/runtime";

function _rpc() {
  if (!electrobun.rpc) {
    throw new Error("Electrobun RPC is not initialized");
  }
  return electrobun.rpc;
}

export function listRuntimes(): Promise<RuntimeView[]> {
  return _rpc().request.listRuntimes({});
}

export function listRemoteServers(): Promise<RemoteServerView[]> {
  return _rpc().request.remoteListServers({});
}

export function addRemoteServer(
  server: RemoteServerDraft
): Promise<RemoteServerView[]> {
  return _rpc().request.remoteAddServer({ server });
}

export function updateRemoteServer(
  serverId: string,
  server: RemoteServerDraft
): Promise<RemoteServerView[]> {
  return _rpc().request.remoteUpdateServer({ serverId, server });
}

export function removeRemoteServer(
  serverId: string
): Promise<RemoteServerView[]> {
  return _rpc().request.remoteRemoveServer({ serverId });
}

export function connectRemoteServer(
  serverId: string
): Promise<RemoteServerView[]> {
  return _rpc().request.remoteConnectServer({ serverId });
}

export function disconnectRemoteServer(
  serverId: string
): Promise<RemoteServerView[]> {
  return _rpc().request.remoteDisconnectServer({ serverId });
}

export function setDefaultRuntime(
  runtimeId: RuntimeId
): Promise<RemoteServerView[]> {
  return _rpc().request.remoteSetDefaultRuntime({ runtimeId });
}

export async function getDefaultRuntime(): Promise<RuntimeId> {
  const { runtimeId } = await _rpc().request.remoteGetDefaultRuntime({});
  return runtimeId;
}
