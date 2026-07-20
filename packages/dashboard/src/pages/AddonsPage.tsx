import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Package, Plus, Trash2, UserPlus, RefreshCw, Loader2 } from "lucide-react";
import {
  addonsApi,
  type AddonAssignmentEntry,
  type AddonEntry,
} from "@/lib/api";

export default function AddonsPage() {
  const [addons, setAddons] = useState<AddonEntry[]>([]);
  const [assignments, setAssignments] = useState<AddonAssignmentEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [allowlist, setAllowlist] = useState("");
  const [dailyTokenLimit, setDailyTokenLimit] = useState(5_000_000);
  const [discordRoleId, setDiscordRoleId] = useState("");

  const [assignAddonId, setAssignAddonId] = useState<number | "">("");
  const [assignDiscordId, setAssignDiscordId] = useState("");
  const [assignExpires, setAssignExpires] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [a, asg] = await Promise.all([addonsApi.list(), addonsApi.listAssignments()]);
      setAddons(a.data || []);
      setAssignments(asg.data || []);
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

  const createAddon = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await addonsApi.create({
        name: name.trim(),
        description: description.trim(),
        modelAllowlist: allowlist,
        dailyTokenLimit,
        discordRoleId: discordRoleId.trim() || null,
        isActive: true,
      });
      setName("");
      setDescription("");
      setAllowlist("");
      setDiscordRoleId("");
      await load();
    } catch (e: any) {
      setError(e?.message || "Failed to create add-on");
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

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Package className="h-6 w-6" /> Add-ons
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Packs that unlock models (allowlist) and add daily token quota. Assign to Discord users.
            Models listed on any active add-on require that add-on; other models stay open.
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
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Create add-on</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label>Name</Label>
              <Input className="mt-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="ChatGPT 5.6 Pack" />
            </div>
            <div>
              <Label>Description</Label>
              <Input className="mt-1" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
            </div>
            <div>
              <Label>Model allowlist (comma-separated patterns)</Label>
              <Input
                className="mt-1 font-mono text-sm"
                value={allowlist}
                onChange={(e) => setAllowlist(e.target.value)}
                placeholder="chatgpt-5.6, gpt-5.6"
              />
            </div>
            <div>
              <Label>Daily token limit (bonus / model pack)</Label>
              <Input
                className="mt-1"
                type="number"
                value={dailyTokenLimit}
                onChange={(e) => setDailyTokenLimit(parseInt(e.target.value) || 0)}
              />
              <p className="text-[10px] text-muted-foreground mt-1">Default 5,000,000 = 5M/day for matching models</p>
            </div>
            <div>
              <Label>Discord role ID (optional note / future auto-assign)</Label>
              <Input className="mt-1 font-mono text-sm" value={discordRoleId} onChange={(e) => setDiscordRoleId(e.target.value)} placeholder="role snowflake" />
            </div>
            <Button onClick={() => void createAddon()} disabled={saving || !name.trim()}>
              <Plus className="h-4 w-4 mr-1" /> Create
            </Button>
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
                onChange={(e) => setAssignAddonId(e.target.value ? Number(e.target.value) : "")}
              >
                <option value="">Select…</option>
                {addons.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} {a.isActive ? "" : "(inactive)"}
                  </option>
                ))}
              </select>
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
          {addons.map((a) => (
            <div key={a.id} className="flex flex-col gap-2 rounded-lg border border-border/60 p-3 md:flex-row md:items-center md:justify-between">
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{a.name}</span>
                  <Badge variant={a.isActive ? "default" : "secondary"}>{a.isActive ? "active" : "off"}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {(a.dailyTokenLimit || 0).toLocaleString()} tok/day
                  </span>
                </div>
                <div className="text-xs text-muted-foreground font-mono break-all">
                  {(a.modelAllowlistParsed || []).join(", ") || a.modelAllowlist || "(no models)"}
                </div>
                {a.description && <p className="text-xs text-muted-foreground">{a.description}</p>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Switch checked={a.isActive} onCheckedChange={() => void toggleActive(a)} />
                <Button variant="ghost" size="icon" onClick={() => void removeAddon(a.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
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
