import type { Thread } from "@llm-space/core";

import { electrobun } from "@/lib/electrobun";
import type { RuntimeId } from "@/shared/runtime";
import type {
  TraceConnectedProjectInput,
  TraceImportFile,
  TraceLangfuseSearchInput,
} from "@/shared/traces";

function _rpc() {
  const rpc = electrobun.rpc;
  if (!rpc) {
    throw new Error("Electrobun RPC is not initialized");
  }
  return rpc;
}

export const traceClient = {
  /** List trace projects for the sidebar; returns an empty array on a fresh root. */
  listProjects(runtimeId?: RuntimeId) {
    return _rpc().request.traceListProjects({ ..._scope(runtimeId) });
  },
  /** Create a manual Langfuse project and return its persisted metadata. */
  createProject(name: string, runtimeId?: RuntimeId) {
    return _rpc().request.traceCreateProject({ ..._scope(runtimeId), name });
  },
  /** Validate and create a connected Langfuse project with local credentials. */
  createConnectedProject(
    input: TraceConnectedProjectInput,
    runtimeId?: RuntimeId
  ) {
    return _rpc().request.traceCreateConnectedProject({
      ..._scope(runtimeId),
      ...input,
    });
  },
  /** List trace summaries for one project, sorted by trace start time. */
  listTraces(projectId: string, runtimeId?: RuntimeId) {
    return _rpc().request.traceListTraces({ ..._scope(runtimeId), projectId });
  },
  /** Import already-read Langfuse JSON files into a trace project. */
  importLangfuseJson(
    projectId: string,
    files: TraceImportFile[],
    runtimeId?: RuntimeId
  ) {
    return _rpc().request.traceImportLangfuseJson({
      ..._scope(runtimeId),
      projectId,
      files,
    });
  },
  /** Search remote Langfuse traces for explicit user-selected sync. */
  searchLangfuseTraces(
    projectId: string,
    filters: TraceLangfuseSearchInput = {},
    runtimeId?: RuntimeId
  ) {
    return _rpc().request.traceSearchLangfuseTraces({
      ..._scope(runtimeId),
      projectId,
      filters,
    });
  },
  /** Sync selected remote Langfuse trace ids into local trace storage. */
  syncLangfuseTraces(
    projectId: string,
    traceIds: string[],
    runtimeId?: RuntimeId
  ) {
    return _rpc().request.traceSyncLangfuseTraces({
      ..._scope(runtimeId),
      projectId,
      traceIds,
    });
  },
  /** Read one trace summary, used to validate restored trace tabs. */
  readTrace(projectId: string, traceKey: string, runtimeId?: RuntimeId) {
    return _rpc().request.traceReadTrace({
      ..._scope(runtimeId),
      projectId,
      traceKey,
    });
  },
  /** Read or lazily create the editable workbench thread for a trace. */
  readOrCreateWorkbench(
    projectId: string,
    traceKey: string,
    runtimeId?: RuntimeId
  ) {
    return _rpc().request.traceReadOrCreateWorkbench({
      ..._scope(runtimeId),
      projectId,
      traceKey,
    });
  },
  /** Rename a trace and keep its editable workbench title aligned. */
  updateTraceTitle(
    projectId: string,
    traceKey: string,
    title: string,
    runtimeId?: RuntimeId
  ) {
    return _rpc().request.traceUpdateTraceTitle({
      ..._scope(runtimeId),
      projectId,
      traceKey,
      title,
    });
  },
  /** Persist the trace workbench thread without changing the raw trace payload. */
  async writeWorkbench(
    projectId: string,
    traceKey: string,
    thread: Thread,
    runtimeId?: RuntimeId
  ): Promise<void> {
    await _rpc().request.traceWriteWorkbench({
      ..._scope(runtimeId),
      projectId,
      traceKey,
      thread,
    });
  },
};

function _scope(runtimeId: RuntimeId | undefined) {
  return runtimeId ? { runtimeId } : {};
}
