import type { SearchSettings } from "@llm-space/core";

import { electrobun } from "@/lib/electrobun";
import type { RuntimeId } from "@/shared/runtime";

function _rpc() {
  if (!electrobun.rpc) {
    throw new Error("Electrobun RPC is not initialized");
  }
  return electrobun.rpc;
}

export async function getSearchSettings(
  runtimeId?: RuntimeId
): Promise<SearchSettings> {
  return _rpc().request.getSearchSettings({ ..._scope(runtimeId) });
}

export async function setSearchSettings(
  settings: SearchSettings,
  runtimeId?: RuntimeId
): Promise<SearchSettings> {
  return _rpc().request.setSearchSettings({ ..._scope(runtimeId), settings });
}

function _scope(runtimeId: RuntimeId | undefined) {
  return runtimeId ? { runtimeId } : {};
}
