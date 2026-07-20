"use client";

import { Button } from "@llm-space/ui/ui/button";
import { Input } from "@llm-space/ui/ui/input";
import { Separator } from "@llm-space/ui/ui/separator";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import {
  addRemoteServer,
  connectRemoteServer,
  disconnectRemoteServer,
  listRemoteServers,
  removeRemoteServer,
  setDefaultRuntime,
  updateRemoteServer,
} from "@/client/remote-servers";
import type {
  RemoteServerDraft,
  RemoteServerView,
} from "@/shared/remote-servers";

import { SettingsPage } from "./settings-page";

interface FormState {
  id?: string;
  name: string;
  host: string;
  user: string;
  port: string;
  identityFile: string;
  remoteRepo: string;
  remoteHome: string;
  remoteServerPort: string;
  localPort: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  host: "",
  user: "",
  port: "22",
  identityFile: "",
  remoteRepo: "",
  remoteHome: "~/.llm-space-server",
  remoteServerPort: "39123",
  localPort: "",
};

export function RemoteServersPage() {
  const [servers, setServers] = useState<RemoteServerView[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setServers(await listRemoteServers());
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
    try {
      const draft = _draft(form);
      setServers(
        form.id
          ? await updateRemoteServer(form.id, draft)
          : await addRemoteServer(draft)
      );
      setForm(EMPTY_FORM);
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
    action: (id: string) => Promise<RemoteServerView[]>
  ) => {
    setBusyId(id);
    try {
      setServers(await action(id));
    } catch (error) {
      toast.error("Remote server action failed", {
        description:
          error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <SettingsPage
      title="Remote Servers"
      description="Configure SSH remote runtimes. The remote machine must already have this repository and dependencies installed."
    >
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(280px,360px)] gap-6">
        <div className="space-y-3">
          {servers.length === 0 ? (
            <div className="text-muted-foreground rounded-lg border border-dashed p-6 text-sm">
              No remote servers configured.
            </div>
          ) : (
            servers.map((server) => (
              <div key={server.id} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium">{server.name}</div>
                    <div className="text-muted-foreground truncate text-xs">
                      {server.user ? `${server.user}@` : ""}
                      {server.host}:{server.port}
                    </div>
                    <div className="text-muted-foreground mt-1 text-xs">
                      Runtime: <code>{server.runtimeId}</code>
                    </div>
                    {server.error ? (
                      <div className="text-destructive mt-1 text-xs">
                        {server.error}
                      </div>
                    ) : null}
                  </div>
                  <span className="text-muted-foreground text-xs capitalize">
                    {server.defaultRuntime ? "default · " : ""}
                    {server.status}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={
                      busyId === server.id || server.status === "connected"
                    }
                    onClick={() => void run(server.id, connectRemoteServer)}
                  >
                    Connect
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={
                      busyId === server.id || server.status !== "connected"
                    }
                    onClick={() => void run(server.id, disconnectRemoteServer)}
                  >
                    Disconnect
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={server.status !== "connected"}
                    onClick={() =>
                      void run(server.id, () =>
                        setDefaultRuntime(server.runtimeId)
                      )
                    }
                  >
                    Set default
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={server.status === "connected"}
                    onClick={() => setForm(_form(server))}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busyId === server.id}
                    onClick={() => void run(server.id, removeRemoteServer)}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="space-y-3 rounded-lg border p-3">
          <div className="text-sm font-medium">
            {form.id ? "Edit server" : "Add server"}
          </div>
          <Field
            label="Name"
            value={form.name}
            onChange={(name) => setForm({ ...form, name })}
          />
          <Field
            label="Host"
            value={form.host}
            onChange={(host) => setForm({ ...form, host })}
          />
          <Field
            label="User"
            value={form.user}
            onChange={(user) => setForm({ ...form, user })}
          />
          <Field
            label="SSH port"
            value={form.port}
            onChange={(port) => setForm({ ...form, port })}
          />
          <Field
            label="Identity file"
            value={form.identityFile}
            onChange={(identityFile) => setForm({ ...form, identityFile })}
          />
          <Separator />
          <Field
            label="Remote repo"
            value={form.remoteRepo}
            onChange={(remoteRepo) => setForm({ ...form, remoteRepo })}
          />
          <Field
            label="Remote home"
            value={form.remoteHome}
            onChange={(remoteHome) => setForm({ ...form, remoteHome })}
          />
          <Field
            label="Server port"
            value={form.remoteServerPort}
            onChange={(remoteServerPort) =>
              setForm({ ...form, remoteServerPort })
            }
          />
          <Field
            label="Local port"
            value={form.localPort}
            onChange={(localPort) => setForm({ ...form, localPort })}
          />
          <div className="flex gap-2 pt-1">
            <Button size="sm" onClick={() => void save()}>
              {form.id ? "Update" : "Add"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setForm(EMPTY_FORM)}
            >
              Cancel
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            Passwords and passphrases are not stored. Use ssh-agent or an
            identity file available to OpenSSH.
          </p>
        </div>
      </div>
    </SettingsPage>
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
    remoteRepo: form.remoteRepo,
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
    remoteRepo: server.remoteRepo,
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
