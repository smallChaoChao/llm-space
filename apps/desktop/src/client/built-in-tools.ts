import type { BuiltinTool } from "@llm-space/core";

import { electrobun } from "@/lib/electrobun";
import type { RuntimeId } from "@/shared/runtime";

function _rpc() {
  if (!electrobun.rpc) {
    throw new Error("Electrobun RPC is not initialized");
  }
  return electrobun.rpc;
}

export async function listBuiltInTools(
  runtimeId?: RuntimeId
): Promise<BuiltinTool[]> {
  return _rpc().request.builtInListTools({ ..._scope(runtimeId) });
}

export async function callBuiltInTool(
  input: {
    name: string;
    arguments: Record<string, unknown>;
  },
  runtimeId?: RuntimeId
): Promise<{ contentText: string }> {
  return _rpc().request.builtInCallTool({ ..._scope(runtimeId), ...input });
}

/** Open a directory itself, or reveal a file selected in its parent folder. */
export async function fsReveal(path: string): Promise<void> {
  await _rpc().request.fsReveal({ path });
}

function _scope(runtimeId: RuntimeId | undefined) {
  return runtimeId ? { runtimeId } : {};
}
