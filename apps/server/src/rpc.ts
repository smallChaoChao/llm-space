import type { Thread } from "@llm-space/core";
import type { RuntimeClient } from "@llm-space/runtime/runtime";

import { ServerError, toServerError } from "./errors";
import type { RuntimeRpcRequest, RuntimeRpcResponse } from "./rpc-contract";

export async function handleRuntimeRpc(
  runtime: RuntimeClient,
  input: unknown
): Promise<RuntimeRpcResponse> {
  const request = _parseRpcRequest(input);
  try {
    const result = await _dispatch(runtime, request);
    return { id: request.id, ok: true, result };
  } catch (error) {
    const serverError = toServerError(error);
    return {
      id: request.id,
      ok: false,
      error: {
        code: serverError.code,
        message: serverError.message,
        ...(serverError.detail === undefined
          ? {}
          : { detail: serverError.detail }),
      },
    };
  }
}

function _parseRpcRequest(input: unknown): RuntimeRpcRequest {
  if (!input || typeof input !== "object") {
    throw new ServerError("invalid_request", "RPC request must be an object.");
  }
  const candidate = input as Partial<RuntimeRpcRequest>;
  if (typeof candidate.id !== "string" || candidate.id.length === 0) {
    throw new ServerError("invalid_request", "RPC request id is required.");
  }
  if (typeof candidate.method !== "string" || candidate.method.length === 0) {
    throw new ServerError("invalid_request", "RPC request method is required.");
  }
  return candidate as RuntimeRpcRequest;
}

async function _dispatch(
  runtime: RuntimeClient,
  request: RuntimeRpcRequest
): Promise<unknown> {
  const params = (request.params ?? {}) as Record<string, unknown>;
  switch (request.method) {
    case "runtime.info":
      return runtime.info();
    case "fs.ls":
      return runtime.fsLs(_stringParam(params, "path"));
    case "fs.mkdir":
      await runtime.fsMkdir(_stringParam(params, "path"));
      return null;
    case "fs.read":
      return runtime.fsRead(_stringParam(params, "path"));
    case "fs.write":
      await runtime.fsWrite(_stringParam(params, "path"), _threadParam(params));
      return null;
    case "fs.realpath":
      return { path: await runtime.fsRealpath(_stringParam(params, "path")) };
    case "models.available":
      return runtime.availableModels();
    case "models.builtinProviders":
      return runtime.builtinProviders();
    case "models.getDefault":
      return runtime.getDefaultModel();
    case "models.resolveGeneratorEnv":
      return runtime.resolveGeneratorEnv({
        providerId: _stringParam(params, "providerId"),
        envNames: _stringArrayParam(params, "envNames"),
      });
    case "mcp.listServers":
      return runtime.mcpListServers();
    case "builtinTools.list":
      return runtime.builtInListTools();
    case "search.get":
      return runtime.getSearchSettings();
    case "network.get":
      return runtime.getNetworkSettings();
    case "skills.getSettings":
      return runtime.skillsGetSettings();
    default:
      throw new ServerError(
        "method_not_found",
        `Runtime RPC method not found: ${String(request.method)}`,
        404
      );
  }
}

function _stringParam(params: Record<string, unknown>, name: string): string {
  const value = params[name];
  if (typeof value !== "string") {
    throw new ServerError(
      "invalid_params",
      `RPC param "${name}" must be a string.`
    );
  }
  return value;
}

function _stringArrayParam(
  params: Record<string, unknown>,
  name: string
): string[] {
  const value = params[name];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new ServerError(
      "invalid_params",
      `RPC param "${name}" must be a string array.`
    );
  }
  return value;
}

function _threadParam(params: Record<string, unknown>): Thread {
  const value = params.thread;
  if (!value || typeof value !== "object") {
    throw new ServerError(
      "invalid_params",
      'RPC param "thread" must be an object.'
    );
  }
  return value;
}
