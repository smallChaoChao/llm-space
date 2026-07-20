import type {
  FileNode,
  FileSystem,
  Thread,
  ThreadStorage,
} from "@llm-space/core";
import { normalizeThreadForPath } from "@llm-space/ui/lib/thread-file";

import { electrobun } from "@/lib/electrobun";
import type { RuntimeId } from "@/shared/runtime";

/**
 * Client-side `FileSystem` + `ThreadStorage` that talks to the bun side over
 * Electrobun RPC (the `fs*` requests), the desktop counterpart to the web
 * {@link LocalFileSystemClient} that POSTs to `/api/fs/local/*`. Each method
 * issues a request and rejects with the bun handler's error on failure.
 */
export class LocalFileSystemClient implements FileSystem, ThreadStorage {
  constructor(private readonly _runtimeId?: RuntimeId) {}
  ls(path: string): Promise<FileNode[]> {
    return this._rpc().request.fsLs({ ...this._scope(), path });
  }

  async mkdir(path: string): Promise<void> {
    await this._rpc().request.fsMkdir({ ...this._scope(), path });
  }

  async cp(src: string, dest: string): Promise<void> {
    await this._rpc().request.fsCp({ ...this._scope(), src, dest });
  }

  async mv(src: string, dest: string): Promise<void> {
    await this._rpc().request.fsMv({ ...this._scope(), src, dest });
  }

  async rm(path: string): Promise<void> {
    await this._rpc().request.fsRm({ ...this._scope(), path });
  }

  async read(path: string): Promise<Thread> {
    const thread = await this._rpc().request.fsRead({
      ...this._scope(),
      path,
    });
    return normalizeThreadForPath(thread, path);
  }

  async write(path: string, thread: Thread): Promise<void> {
    await this._rpc().request.fsWrite({
      ...this._scope(),
      path,
      thread: normalizeThreadForPath(thread, path),
    });
  }

  /** Reveal a file/directory in the OS file manager (Finder/Explorer). */
  async reveal(path: string): Promise<void> {
    const { path: absolutePath } = await this._rpc().request.fsRealpath({
      ...this._scope(),
      path,
    });
    await this._rpc().request.fsReveal({ path: absolutePath });
  }

  /** Resolve a workspace-relative path to its absolute on-disk path. */
  async realpath(path: string): Promise<string> {
    const { path: abs } = await this._rpc().request.fsRealpath({
      ...this._scope(),
      path,
    });
    return abs;
  }

  private _scope() {
    return this._runtimeId ? { runtimeId: this._runtimeId } : {};
  }

  private _rpc() {
    const rpc = electrobun.rpc;
    if (!rpc) {
      throw new Error("Electrobun RPC is not initialized");
    }
    return rpc;
  }
}

export function createFileSystemClient(
  runtimeId?: RuntimeId
): LocalFileSystemClient {
  return new LocalFileSystemClient(runtimeId);
}

/** Shared client instance using the bun-side default runtime. */
export const localFs = createFileSystemClient();
