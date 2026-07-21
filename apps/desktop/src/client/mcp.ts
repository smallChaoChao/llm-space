import type {
  McpCallToolResponse,
  McpServerDraft,
  McpServerToolsResponse,
  McpServerView,
} from "@llm-space/core";

import { electrobun } from "@/lib/electrobun";
import type { RuntimeId } from "@/shared/runtime";

function _rpc() {
  if (!electrobun.rpc) {
    throw new Error("Electrobun RPC is not initialized");
  }
  return electrobun.rpc;
}

export async function listMcpServers(
  runtimeId?: RuntimeId
): Promise<McpServerView[]> {
  return _rpc().request.mcpListServers({ ..._scope(runtimeId) });
}

export async function addMcpServer(
  server: McpServerDraft,
  runtimeId?: RuntimeId
): Promise<McpServerView[]> {
  return _rpc().request.mcpAddServer({ ..._scope(runtimeId), server });
}

export async function updateMcpServer(
  serverId: string,
  server: McpServerDraft,
  runtimeId?: RuntimeId
): Promise<McpServerView[]> {
  return _rpc().request.mcpUpdateServer({
    ..._scope(runtimeId),
    serverId,
    server,
  });
}

export async function removeMcpServer(
  serverId: string,
  runtimeId?: RuntimeId
): Promise<McpServerView[]> {
  return _rpc().request.mcpRemoveServer({ ..._scope(runtimeId), serverId });
}

export async function disconnectMcpServer(
  serverId: string,
  runtimeId?: RuntimeId
): Promise<McpServerView[]> {
  return _rpc().request.mcpDisconnectServer({ ..._scope(runtimeId), serverId });
}

export async function listMcpTools(
  serverId: string,
  runtimeId?: RuntimeId
): Promise<McpServerToolsResponse> {
  return _rpc().request.mcpListTools({ ..._scope(runtimeId), serverId });
}

export async function callMcpTool(
  input: {
    serverId: string;
    toolName: string;
    arguments: Record<string, unknown>;
  },
  runtimeId?: RuntimeId
): Promise<McpCallToolResponse> {
  return _rpc().request.mcpCallTool({ ..._scope(runtimeId), ...input });
}

function _scope(runtimeId: RuntimeId | undefined) {
  return runtimeId ? { runtimeId } : {};
}
