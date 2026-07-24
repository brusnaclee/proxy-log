import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Package, Plus, Trash2, UserPlus, RefreshCw, Loader2, X, Pencil, Save } from "lucide-react";
import {
  addonsApi,
  globalSettings,
  type AddonAssignmentEntry,
  type AddonEntry,
} from "@/lib/api";

type AccessMode = "allowlist" | "all_except";

function CatalogPicker({
  label,
  hint,
  selected,
  onChange,
  catalog,
}: {
  label: string;
  hint: string;
  selected: string[];
  onChange: (next: string[]) => void;
  catalog: string[];
}) {
  const [query, setQuery] = useState("");
  const [manual, setManual] = useState("");

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return catalog.slice(0, 20);
    return catalog.filter((id) => id.toLowerCase().includes(q)).slice(0, 30);
  }, [catalog, query]);

  const toggle = (id: string) => {
    if (selected.includes(id)) onChange(selected.filter((x) => x !== id));
    else onChange([...selected, id]);
  };

  const addManual = () => {
    const p = manual.trim();
    if (!p) return;
    if (!selected.includes(p)) onChange([...selected, p]);
    setManual("");
  };

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <p className="text-[10px] text-muted-foreground">{hint}</p>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 max-h-28 overflow-y-auto p-1.5 border rounded-md bg-background/40">
          {selected.map((id) => (
            <span
              key={id}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/15 text-primary font-mono text-[10px]"
            >
              {id}
              <button type="button" onClick={() => toggle(id)} className="hover:text-destructive" aria-label={`Remove ${id}`}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <Input
        className="font-mono text-sm"
        placeholder="Cari di katalog… (glm, claude, chatgpt-5.6)"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="max-h-36 overflow-y-auto border rounded-md divide-y divide-border/50">
        {matches.length === 0 ? (
          <p className="p-2 text-xs text-muted-foreground">Tidak ada hasil.</p>
        ) : (
          matches.map((id) => {
            const on = selected.includes(id);
            return (
              <button
                key={id}
                type="button"
                onClick={() => toggle(id)}
                className={`w-full text-left px-2 py-1.5 text-[11px] font-mono hover:bg-accent/60 flex items-center gap-2 ${
                  on ? "bg-primary/10 text-primary" : "text-foreground"
                }`}
              >
                <span className={`h-3.5 w-3.5 rounded border flex items-center justify-center text-[9px] ${on ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"}`}>
                  {on ? "✓" : ""}
                </span>
                <span className="truncate">{id}</span>
              </button>
            );
          })
        )}
      </div>
      <div className="flex gap-2">
        <Input
          className="font-mono text-sm"
          placeholder="Pattern manual (substring)"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addManual();
            }
          }}
        />
        <Button type="button" variant="outline" size="sm" onClick={addManual}>
          Add
        </Button>
      </div>
    </div>
  );
}

export default function AddonsPage() {
  const [addons, setAddons] = useState<AddonEntry[]>([]);
  const [assignments, setAssignments] = useState<AddonAssignmentEntry[]>([]);
  const [catalog, setCatalog] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [accessMode, setAccessMode] = useState<AccessMode>("allowlist");
  const [allowlist, setAllowlist] = useState<string[]>([]);
  const [denylist, setDenylist] = useState<string[]>([]);
  const [dailyTokenLimit, setDailyTokenLimit] = useState(0);
  const [maxDevices, setMaxDevices] = useState(0);
  const [discordRoleId, setDiscordRoleId] = useState("");
  const [limitPattern, setLimitPattern] = useState("");
  const [limitValue, setLimitValue] = useState(5_000_000);
  const [modelDailyLimits, setModelDailyLimits] = useState<Record<string, number>>({});

  const [assignAddonId, setAssignAddonId] = useState<number | "">("");
  const [assignDiscordId, setAssignDiscordId] = useState("");
  const [assignExpires, setAssignExpires] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [a, asg, models] = await Promise.all([
        addonsApi.list(),
        addonsApi.listAssignments(),
        globalSettings.getModels().catch(() => ({ data: [] as string[] })),
      ]);
      setAddons(a.data || []);
      setAssignments(asg.data || []);
      setCatalog(models.data || []);
      setAssignAddonId((prev) => prev || a.data?.[0]?.id || "");
    } catch (e: any) {
      setError(e?.message || "Failed to load add-ons");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const resetForm = () => {
    setEditingId(null);
    setName("");
    setDescription("");
    setAccessMode("allowlist");
    setAllowlist([]);
    setDenylist([]);
    setDailyTokenLimit(0);
    setMaxDevices(0);
    setDiscordRoleId("");
    setModelDailyLimits({});
    setLimitPattern("");
    setLimitValue(5_000_000);
  };

  const startEdit = (addon: AddonEntry) => {
    setEditingId(addon.id);
    setName(addon.name || "");
    setDescription(addon.description || "");
    setAccessMode(addon.accessMode === "all_except" ? "all_except" : "allowlist");
    setAllowlist(addon.modelAllowlistParsed || []);
    setDenylist(addon.modelDenylistParsed || []);
    setDailyTokenLimit(addon.dailyTokenLimit || 0);
    setMaxDevices(addon.maxDevices || 0);
    setDiscordRoleId(addon.discordRoleId || "");
    setModelDailyLimits({ ...(addon.modelDailyLimitsParsed || {}) });
    setLimitPattern("");
    setLimitValue(5_000_000);
    setError(null);
    // Scroll form into view on mobile
    document.getElementById("addon-editor")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const saveAddon = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    const payload = {
      name: name.trim(),
      description: description.trim(),
      accessMode,
      modelAllowlist: allowlist,
      modelDenylist: denylist,
      modelDailyLimits,
      dailyTokenLimit,
      maxDevices,
      discordRoleId: discordRoleId.trim() || null,
    };
    try {
      if (editingId != null) {
        await addonsApi.update(editingId, payload);
      } else {
        await addonsApi.create({ ...payload, isActive: true });
      }
      resetForm();
      await load();
    } catch (e: any) {
      setError(e?.message || (editingId != null ? "Failed to update add-on" : "Failed to create add-on"));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (addon: AddonEntry) => {
    try {
      await addonsApi.update(addon.id, { isActive: !addon.isActive });
      await load();
    } catch (e: any) {
      setError(e?.message || "Failed to update add-on");
    }
  };

  const removeAddon = async (id: number) => {
    if (!confirm("Delete this add-on and all assignments?")) return;
    try {
      await addonsApi.remove(id);
      if (editingId === id) resetForm();
      await load();
    } catch (e: any) {
      setError(e?.message || "Failed to delete add-on");
    }
  };

  const assign = async () => {
    if (!assignAddonId || !assignDiscordId.trim()) return;
    setSaving(true);
    try {
      await addonsApi.assign({
        addonId: Number(assignAddonId),
        discordUserId: assignDiscordId.trim(),
        expiresAt: assignExpires ? new Date(assignExpires).toISOString() : null,
      });
      setAssignDiscordId("");
      setAssignExpires("");
      await load();
    } catch (e: any) {
      setError(e?.message || "Failed to assign add-on");
    } finally {
      setSaving(false);
    }
  };

  const removeAssignment = async (id: number) => {
    try {
      await addonsApi.removeAssignment(id);
      await load();
    } catch (e: any) {
      setError(e?.message || "Failed to remove assignment");
    }
  };

  const addDailyLimit = () => {
    const p = limitPattern.trim();
    if (!p || limitValue <= 0) return;
    setModelDailyLimits((prev) => ({ ...prev, [p]: limitValue }));
    setLimitPattern("");
  };

  const limitSuggestions = useMemo(() => {
    const set = new Set([...allowlist, ...denylist, ...Object.keys(modelDailyLimits)]);
    return Array.from(set).slice(0, 40);
  }, [allowlist, denylist, modelDailyLimits]);

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Package className="h-6 w-6" /> Add-ons
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Packs grant benefits (skip Claude/GPT-5.6 tease, token bonuses, per-model caps, device clamp).
            Allowlist = models this pack unlocks benefits for — it does <span className="font-medium text-foreground">not</span> lock
            those models for Phantom. Hard locks live in Settings → Models requiring add-on (empty by default).
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card id="addon-editor">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-base">
              {editingId != null ? `Edit add-on #${editingId}` : "Create add-on"}
            </CardTitle>
            {editingId != null && (
              <Button type="button" variant="ghost" size="sm" onClick={resetForm}>
                Cancel edit
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label>Name</Label>
              <Input className="mt-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="Vibecode" />
            </div>
            <div>
              <Label>Description</Label>
              <Input className="mt-1" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
            </div>

            <div>
              <Label>Access mode</Label>
              <div className="mt-1 flex gap-1">
                {([
                  ["allowlist", "Allowlist only"],
                  ["all_except", "All except denylist"],
                ] as const).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setAccessMode(mode)}
                    className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                      accessMode === mode
                        ? "bg-primary/15 text-primary"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                {accessMode === "all_except"
                  ? "Holder can use all models except denylist (e.g. exclude codex)."
                  : "Models this pack grants benefits for (skip tease / apply pack caps). Does not lock non-holders."}
              </p>
            </div>

            {accessMode === "allowlist" ? (
              <CatalogPicker
                label="Model allowlist"
                hint="Pilih dari katalog atau tambah pattern substring."
                selected={allowlist}
                onChange={setAllowlist}
                catalog={catalog}
              />
            ) : (
              <CatalogPicker
                label="Model denylist (excluded)"
                hint="Model yang di-exclude meski mode all_except — mis. codex."
                selected={denylist}
                onChange={setDenylist}
                catalog={catalog}
              />
            )}

            <div className="space-y-2 border border-border/50 rounded-lg p-3">
              <Label>Per-model daily token limits</Label>
              <p className="text-[10px] text-muted-foreground">
                Pattern substring → cap harian. Contoh: chatgpt-5.6 / terra / sol / kimi-k3 = 5,000,000.
              </p>
              {Object.keys(modelDailyLimits).length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {Object.entries(modelDailyLimits).map(([pat, lim]) => (
                    <span
                      key={pat}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 font-mono text-[10px]"
                    >
                      {pat}={lim.toLocaleString()}
                      <button
                        type="button"
                        onClick={() =>
                          setModelDailyLimits((prev) => {
                            const next = { ...prev };
                            delete next[pat];
                            return next;
                          })
                        }
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  className="font-mono text-sm"
                  list="addon-limit-suggestions"
                  placeholder="pattern"
                  value={limitPattern}
                  onChange={(e) => setLimitPattern(e.target.value)}
                />
                <datalist id="addon-limit-suggestions">
                  {limitSuggestions.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
                <Input
                  type="number"
                  value={limitValue}
                  onChange={(e) => setLimitValue(parseInt(e.target.value) || 0)}
                />
                <Button type="button" variant="outline" size="sm" onClick={addDailyLimit}>
                  Add
                </Button>
              </div>
            </div>

            <div>
              <Label>Pack daily token bonus (0 = none)</Label>
              <Input
                className="mt-1"
                type="number"
                value={dailyTokenLimit}
                onChange={(e) => setDailyTokenLimit(parseInt(e.target.value) || 0)}
              />
              <p className="text-[10px] text-muted-foreground mt-1">Stacked on account daily limit. Vibecode tiers: 3M / 5M / 10M.</p>
            </div>
            <div>
              <Label>Max devices (0 = no change)</Label>
              <Input
                className="mt-1"
                type="number"
                value={maxDevices}
                onChange={(e) => setMaxDevices(parseInt(e.target.value) || 0)}
              />
              <p className="text-[10px] text-muted-foreground mt-1">Applied to user keys on assign (e.g. 1 for Vibecode).</p>
            </div>
            <div>
              <Label>Discord role ID (optional note)</Label>
              <Input className="mt-1 font-mono text-sm" value={discordRoleId} onChange={(e) => setDiscordRoleId(e.target.value)} placeholder="role snowflake" />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void saveAddon()} disabled={saving || !name.trim()}>
                {editingId != null ? (
                  <>
                    <Save className="h-4 w-4 mr-1" /> Save changes
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4 mr-1" /> Create
                  </>
                )}
              </Button>
              {editingId != null && (
                <Button type="button" variant="outline" onClick={resetForm} disabled={saving}>
                  Cancel
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Assign to user</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label>Add-on</Label>
              <select
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={assignAddonId}
                onChange={(e) => {
                  const id = e.target.value ? Number(e.target.value) : "";
                  setAssignAddonId(id);
                  if (id === "") return;
                  const pack = addons.find((a) => a.id === id);
                  if (!pack) return;
                  const days =
                    pack.name === "vibecode-3m"
                      ? 7
                      : pack.name === "vibecode-5m"
                        ? 15
                        : pack.name === "vibecode-10m"
                          ? 30
                          : 0;
                  if (days > 0) {
                    const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
                    const pad = (n: number) => String(n).padStart(2, "0");
                    const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
                    setAssignExpires(local);
                  }
                }}
              >
                <option value="">Select…</option>
                {addons.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} {a.isActive ? "" : "(inactive)"}
                    {a.name === "vibecode-3m"
                      ? " · 7d"
                      : a.name === "vibecode-5m"
                        ? " · 15d"
                        : a.name === "vibecode-10m"
                          ? " · 30d"
                          : ""}
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-muted-foreground mt-1">
                Vibecode tiers auto-fill expiry: 3m=7d, 5m=15d, 10m=30d (editable).
              </p>
            </div>
            <div>
              <Label>Discord user ID</Label>
              <Input className="mt-1 font-mono text-sm" value={assignDiscordId} onChange={(e) => setAssignDiscordId(e.target.value)} placeholder="595540191310118934" />
            </div>
            <div>
              <Label>Expires (optional)</Label>
              <Input className="mt-1" type="datetime-local" value={assignExpires} onChange={(e) => setAssignExpires(e.target.value)} />
            </div>
            <Button onClick={() => void assign()} disabled={saving || !assignAddonId || !assignDiscordId.trim()}>
              <UserPlus className="h-4 w-4 mr-1" /> Assign
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Catalog</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {addons.length === 0 && !loading && (
            <p className="text-sm text-muted-foreground">No add-ons yet.</p>
          )}
          {addons.map((a) => {
            const mode = a.accessMode === "all_except" ? "all_except" : "allowlist";
            const allow = a.modelAllowlistParsed || [];
            const deny = a.modelDenylistParsed || [];
            const limits = a.modelDailyLimitsParsed || {};
            return (
              <div
                key={a.id}
                className={`flex flex-col gap-2 rounded-lg border p-3 md:flex-row md:items-start md:justify-between ${
                  editingId === a.id ? "border-primary/60 bg-primary/5" : "border-border/60"
                }`}
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{a.name}</span>
                    <Badge variant={a.isActive ? "default" : "secondary"}>{a.isActive ? "active" : "off"}</Badge>
                    <Badge variant="outline">{mode === "all_except" ? "all except" : "allowlist"}</Badge>
                    {(a.maxDevices || 0) > 0 && (
                      <span className="text-xs text-muted-foreground">{a.maxDevices} device(s)</span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      pack {(a.dailyTokenLimit || 0).toLocaleString()} tok/day
                    </span>
                  </div>
                  {mode === "allowlist" ? (
                    <div className="text-xs text-muted-foreground font-mono break-all">
                      allow: {allow.join(", ") || "(none)"}
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground font-mono break-all">
                      deny: {deny.join(", ") || "(none)"}
                    </div>
                  )}
                  {Object.keys(limits).length > 0 && (
                    <div className="text-xs text-amber-700 dark:text-amber-300 font-mono break-all">
                      limits:{" "}
                      {Object.entries(limits)
                        .map(([k, v]) => `${k}=${v.toLocaleString()}`)
                        .join(", ")}
                    </div>
                  )}
                  {a.description && <p className="text-xs text-muted-foreground">{a.description}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    variant={editingId === a.id ? "default" : "outline"}
                    size="sm"
                    onClick={() => startEdit(a)}
                    title="Edit add-on"
                  >
                    <Pencil className="h-3.5 w-3.5 mr-1" />
                    Edit
                  </Button>
                  <Switch checked={a.isActive} onCheckedChange={() => void toggleActive(a)} />
                  <Button variant="ghost" size="icon" onClick={() => void removeAddon(a.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Assignments</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground border-b">
                <th className="p-2">Add-on</th>
                <th className="p-2">Discord user</th>
                <th className="p-2">Expires</th>
                <th className="p-2">Status</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {assignments.map((row) => (
                <tr key={row.id} className="border-b border-border/40">
                  <td className="p-2">{row.addonName || row.addonId}</td>
                  <td className="p-2 font-mono text-xs">{row.discordUserId || "-"}</td>
                  <td className="p-2 text-xs">{row.expiresAt ? new Date(row.expiresAt).toLocaleString() : "never"}</td>
                  <td className="p-2">
                    <Badge variant={row.isActive ? "default" : "secondary"}>{row.isActive ? "active" : "off"}</Badge>
                  </td>
                  <td className="p-2">
                    <Button variant="ghost" size="icon" onClick={() => void removeAssignment(row.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </td>
                </tr>
              ))}
              {assignments.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-3 text-muted-foreground">No assignments yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
