"use client";

import { cn } from "@llm-space/ui/lib/utils";
import { Button } from "@llm-space/ui/ui/button";
import { Input } from "@llm-space/ui/ui/input";
import { Separator } from "@llm-space/ui/ui/separator";
import {
  CheckCircle2,
  Loader2,
  Plus,
  RefreshCw,
  Server,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  addRemoteServer,
  connectRemoteServer,
  disconnectRemoteServer,
  listRemoteServers,
  removeRemoteServer,
  updateRemoteServer,
} from "@/client/remote-servers";
import type {
  RemoteServerDraft,
  RemoteServerView,
} from "@/shared/remote-servers";
import type { RuntimeId } from "@/shared/runtime";

import { SettingsPage } from "./settings-page";

interface FormState {
  id?: string;
  name: string;
  host: string;
  user: string;
  port: string;
  identityFile: string;
  remoteRepo: string;
  remoteInstallDir: string;
  remoteHome: string;
  remoteServerPort: string;
  localPort: string;
}

const DEFAULT_REMOTE_HOME = "~/.llm-space-server";
const DEFAULT_REMOTE_INSTALL_DIR = "~/.llm-space/remote-runtime";

function _emptyForm(): FormState {
  return {
    name: "",
    host: "",
    user: "",
    port: "22",
    identityFile: "",
    remoteRepo: "",
    remoteInstallDir: DEFAULT_REMOTE_INSTALL_DIR,
    remoteHome: DEFAULT_REMOTE_HOME,
    remoteServerPort: "39123",
    localPort: "",
  };
}

export function RemoteServersPage({
  onConnected,
  onDisconnected,
}: {
  onConnected?: (runtimeId: RuntimeId) => void;
  onDisconnected?: (runtimeId: RuntimeId) => void;
}) {
  const [servers, setServers] = useState<RemoteServerView[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const selected = useMemo(
    () => servers.find((server) => server.id === selectedId) ?? null,
    [selectedId, servers]
  );

  const refresh = useCallback(async () => {
    const next = await listRemoteServers();
    setServers(next);
    setSelectedId((current) =>
      current && next.some((server) => server.id === current)
        ? current
        : (next[0]?.id ?? null)
    );
  }, []);

  useEffect(() => {
    void refresh().catch((error) =>
      toast.error("Failed to load remote servers", {
        description:
          error instanceof Error ? error.message : "Please try again.",
      })
    );
  }, [refresh]);

  const save = async () => {
    if (!form) return;
    try {
      const draft = _draft(form);
      const next = form.id
        ? await updateRemoteServer(form.id, draft)
        : await addRemoteServer(draft);
      setServers(next);
      const nextId = form.id ?? next.at(-1)?.id ?? null;
      setSelectedId(nextId);
      setForm(null);
      toast.success("Remote server saved");
    } catch (error) {
      toast.error("Failed to save remote server", {
        description:
          error instanceof Error ? error.message : "Please try again.",
      });
    }
  };

  const run = async (
    id: string,
    action: (id: string) => Promise<RemoteServerView[]>,
    options: { closeOnConnected?: boolean; notifyDisconnected?: boolean } = {}
  ) => {
    setBusyId(id);
    try {
      const previousRuntimeId = servers.find(
        (server) => server.id === id
      )?.runtimeId;
      const next = await action(id);
      setServers(next);
      setSelectedId(id);
      if (options.closeOnConnected) {
        const connected = next.find((server) => server.id === id);
        if (connected) onConnected?.(connected.runtimeId);
      }
      if (options.notifyDisconnected && previousRuntimeId) {
        onDisconnected?.(previousRuntimeId);
      }
    } catch (error) {
      toast.error("Remote server action failed", {
        description:
          error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setBusyId(null);
    }
  };

  const startAdd = () => {
    setSelectedId(null);
    setForm(_emptyForm());
  };

  const startEdit = (server: RemoteServerView) => {
    setSelectedId(server.id);
    setForm(_form(server));
  };

  return (
    <SettingsPage
      title="Remote Servers"
      description="Connect LLM Space to a prepared SSH server. Passwords and passphrases are not stored."
      className="p-0"
    >
      <div className="grid h-full min-h-0 grid-cols-[280px_minmax(0,1fr)] border-t">
        <aside className="bg-muted/20 flex min-h-0 flex-col border-r">
          <div className="flex h-11 items-center justify-between px-3">
            <span className="text-sm font-medium">Servers</span>
            <div className="flex gap-1">
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Refresh remote servers"
                onClick={() => void refresh()}
              >
                <RefreshCw className="size-4" />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Add remote server"
                onClick={startAdd}
              >
                <Plus className="size-4" />
              </Button>
            </div>
          </div>
          <Separator />
          <div className="min-h-0 flex-1 overflow-auto p-2">
            {servers.length === 0 ? (
              <div className="text-muted-foreground p-4 text-sm">
                No remote servers. Click + to add one.
              </div>
            ) : (
              <div className="space-y-1">
                {servers.map((server) => (
                  <button
                    key={server.id}
                    type="button"
                    className={cn(
                      "hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-2 text-left",
                      selectedId === server.id && "bg-accent"
                    )}
                    onClick={() => {
                      setSelectedId(server.id);
                      setForm(null);
                    }}
                  >
                    <Server className="text-muted-foreground size-4 shrink-0" />
                    <span className="min-w-0 grow">
                      <span className="block truncate text-sm font-medium">
                        {server.name}
                      </span>
                      <span className="text-muted-foreground block truncate text-xs">
                        {server.user ? `${server.user}@` : ""}
                        {server.host}:{server.port}
                      </span>
                    </span>
                    {server.status === "connected" ? (
                      <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
                    ) : busyId === server.id ||
                      server.status === "connecting" ? (
                      <Loader2 className="size-4 shrink-0 animate-spin" />
                    ) : null}
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>

        <section className="min-h-0 overflow-auto p-5">
          {form ? (
            <RemoteServerForm
              form={form}
              onChange={setForm}
              onCancel={() => setForm(null)}
              onSave={() => void save()}
            />
          ) : selected ? (
            <RemoteServerDetails
              server={selected}
              busy={busyId === selected.id}
              onConnect={() =>
                void run(selected.id, connectRemoteServer, {
                  closeOnConnected: true,
                })
              }
              onDisconnect={() =>
                void run(selected.id, disconnectRemoteServer, {
                  notifyDisconnected: true,
                })
              }
              onEdit={() => startEdit(selected)}
              onRemove={() =>
                void run(selected.id, removeRemoteServer, {
                  notifyDisconnected: true,
                })
              }
            />
          ) : (
            <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
              Select a server or click + to add one.
            </div>
          )}
        </section>
      </div>
    </SettingsPage>
  );
}

function RemoteServerDetails({
  server,
  busy,
  onConnect,
  onDisconnect,
  onEdit,
  onRemove,
}: {
  server: RemoteServerView;
  busy: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div>
        <h3 className="text-base font-medium">{server.name}</h3>
        <p className="text-muted-foreground text-sm">
          {server.user ? `${server.user}@` : ""}
          {server.host}:{server.port}
        </p>
      </div>
      <div className="grid gap-2 rounded-lg border p-3 text-sm">
        <Info label="Status" value={server.status} />
        <Info label="Runtime" value={server.runtimeId} />
        <Info label="Install dir" value={server.remoteInstallDir} />
        <Info label="Remote repo" value={server.remoteRepo ?? "Legacy only"} />
        <Info label="Remote home" value={server.remoteHome} />
        <Info label="Server port" value={String(server.remoteServerPort)} />
        <Info
          label="Local port"
          value={server.localPort ? String(server.localPort) : "Auto"}
        />
      </div>
      {server.error ? (
        <p className="text-destructive text-sm">{server.error}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {server.status === "connected" ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={onDisconnect}
          >
            Disconnect
          </Button>
        ) : (
          <Button size="sm" disabled={busy} onClick={onConnect}>
            Connect
          </Button>
        )}
        <Button
          size="sm"
          variant="secondary"
          disabled={server.status === "connected"}
          onClick={onEdit}
        >
          Edit
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onRemove}>
          <Trash2 className="size-4" />
          Remove
        </Button>
      </div>
    </div>
  );
}

function RemoteServerForm({
  form,
  onChange,
  onSave,
  onCancel,
}: {
  form: FormState;
  onChange: (form: FormState) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div>
        <h3 className="text-base font-medium">
          {form.id ? "Edit server" : "Add server"}
        </h3>
        <p className="text-muted-foreground text-sm">
          Usually only name, host and user are required for a prepared devbox.
        </p>
      </div>
      <div className="grid gap-3 rounded-lg border p-3">
        <Field
          label="Name"
          value={form.name}
          onChange={(name) => onChange({ ...form, name })}
        />
        <Field
          label="Host"
          value={form.host}
          onChange={(host) => onChange({ ...form, host })}
        />
        <Field
          label="User"
          value={form.user}
          onChange={(user) => onChange({ ...form, user })}
        />
      </div>
      <details className="rounded-lg border p-3">
        <summary className="cursor-pointer text-sm font-medium">
          Advanced
        </summary>
        <div className="mt-3 grid gap-3">
          <Field
            label="SSH port"
            value={form.port}
            onChange={(port) => onChange({ ...form, port })}
          />
          <Field
            label="Identity file"
            value={form.identityFile}
            onChange={(identityFile) => onChange({ ...form, identityFile })}
          />
          <Field
            label="Install directory"
            value={form.remoteInstallDir}
            onChange={(remoteInstallDir) =>
              onChange({ ...form, remoteInstallDir })
            }
          />
          <Field
            label="Remote repo (legacy source mode)"
            value={form.remoteRepo}
            onChange={(remoteRepo) => onChange({ ...form, remoteRepo })}
          />
          <Field
            label="Remote home"
            value={form.remoteHome}
            onChange={(remoteHome) => onChange({ ...form, remoteHome })}
          />
          <Field
            label="Server port"
            value={form.remoteServerPort}
            onChange={(remoteServerPort) =>
              onChange({ ...form, remoteServerPort })
            }
          />
          <Field
            label="Local port"
            value={form.localPort}
            onChange={(localPort) => onChange({ ...form, localPort })}
          />
        </div>
      </details>
      <div className="flex gap-2">
        <Button size="sm" onClick={onSave}>
          {form.id ? "Update" : "Add"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate">
        <code>{value}</code>
      </span>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <Input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function _draft(form: FormState): RemoteServerDraft {
  return {
    name: form.name,
    host: form.host,
    user: form.user || undefined,
    port: _number(form.port),
    identityFile: form.identityFile || undefined,
    remoteRepo: form.remoteRepo || undefined,
    remoteInstallDir: form.remoteInstallDir || undefined,
    remoteHome: form.remoteHome || undefined,
    remoteServerPort: _number(form.remoteServerPort),
    localPort: form.localPort ? _number(form.localPort) : undefined,
  };
}

function _form(server: RemoteServerView): FormState {
  return {
    id: server.id,
    name: server.name,
    host: server.host,
    user: server.user ?? "",
    port: String(server.port),
    identityFile: server.identityFile ?? "",
    remoteRepo: server.remoteRepo ?? "",
    remoteInstallDir: server.remoteInstallDir,
    remoteHome: server.remoteHome,
    remoteServerPort: String(server.remoteServerPort),
    localPort: server.localPort ? String(server.localPort) : "",
  };
}

function _number(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed)) throw new Error(`Invalid number: ${value}`);
  return parsed;
}
