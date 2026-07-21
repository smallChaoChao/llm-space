import type { NetworkSettings, SystemProxyDetection } from "@llm-space/core";

import { electrobun } from "@/lib/electrobun";
import type { RuntimeId } from "@/shared/runtime";

function _rpc() {
  if (!electrobun.rpc) {
    throw new Error("Electrobun RPC is not initialized");
  }
  return electrobun.rpc;
}

export async function getNetworkSettings(
  runtimeId?: RuntimeId
): Promise<NetworkSettings> {
  return _rpc().request.getNetworkSettings({ ..._scope(runtimeId) });
}

export async function setNetworkSettings(
  settings: NetworkSettings,
  runtimeId?: RuntimeId
): Promise<NetworkSettings> {
  return _rpc().request.setNetworkSettings({ ..._scope(runtimeId), settings });
}

export async function detectSystemProxy(
  runtimeId?: RuntimeId
): Promise<SystemProxyDetection> {
  return _rpc().request.detectSystemProxy({ ..._scope(runtimeId) });
}

function _scope(runtimeId: RuntimeId | undefined) {
  return runtimeId ? { runtimeId } : {};
}
