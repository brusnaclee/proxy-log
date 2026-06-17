import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  trialSettings,
  type TrialDmTemplates,
  type TrialEmbedConfig,
  type TrialSettings,
  type TrialUserRow,
} from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Gift, Loader2, RefreshCw, Save, ExternalLink } from "lucide-react";

function keyDetailPath(u: TrialUserRow) {
  const slug = (u.keyName || "trial").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").substring(0, 40);
  return `/keys/${u.apiKeyId}-${slug}`;
}

const DURATION_OPTIONS = [7, 14, 30, 60, 90];
const PROMPT_WINDOWS = ["1h", "3h", "5h", "12h", "24h"];

function colorToHex(color?: number): string {
  if (!color) return "#57f287";
  return `#${(color & 0xffffff).toString(16).padStart(6, "0")}`;
}

function hexToColor(hex: string): number {
  const h = hex.replace("#", "");
  return parseInt(h, 16) || 0x57f287;
}

function EmbedPreview({ embed, buttonLabel }: { embed: TrialEmbedConfig; buttonLabel: string }) {
  const color = colorToHex(embed.color);
  return (
    <div className="rounded-lg border border-border/60 overflow-hidden max-w-md">
      <div className="h-1" style={{ backgroundColor: color }} />
      <div className="p-4 bg-[#2b2d31] space-y-2">
        <p className="font-semibold text-white text-sm">{embed.title || "Trial Panel"}</p>
        <p className="text-xs text-[#dbdee1] whitespace-pre-wrap leading-relaxed">
          {embed.description || "Embed description…"}
        </p>
        {embed.footer && (
          <p className="text-[10px] text-[#949ba4] pt-1">{embed.footer}</p>
        )}
        <div className="pt-2">
          <span className="inline-block px-3 py-1.5 rounded text-xs font-medium bg-[#5865f2] text-white">
            {buttonLabel || "Klaim Trial API"}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function TrialSettingsPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [users, setUsers] = useState<TrialUserRow[]>([]);
  const [settings, setSettings] = useState<TrialSettings | null>(null);
  const [embed, setEmbed] = useState<TrialEmbedConfig>({});
  const [dmTemplates, setDmTemplates] = useState<TrialDmTemplates>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [s, u] = await Promise.all([trialSettings.get(), trialSettings.listUsers()]);
      setSettings(s);
      setEmbed(s.trialEmbedConfig || {});
      setDmTemplates(s.trialDmTemplates || {});
      setUsers(u.data || []);
    } catch (e: any) {
      setError(e.message || "Failed to load trial settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const res = await trialSettings.update({
        ...settings,
        trialEmbedConfig: embed,
        trialDmTemplates: dmTemplates,
      });
      setSettings(res);
      setEmbed(res.trialEmbedConfig);
      setDmTemplates(res.trialDmTemplates);
      setMessage("Trial settings saved.");
    } catch (e: any) {
      setError(e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const toggleModel = (modelId: string) => {
    if (!settings) return;
    const list = settings.trialModelWhitelist || [];
    const next = list.includes(modelId) ? list.filter((m) => m !== modelId) : [...list, modelId];
    setSettings({ ...settings, trialModelWhitelist: next });
  };

  const runAction = async (discordUserId: string, action: string, extra: Record<string, unknown> = {}) => {
    try {
      await trialSettings.userAction({ action, discordUserId, ...extra });
      await load();
      setMessage(`Action "${action}" applied.`);
    } catch (e: any) {
      setError(e.message || "Action failed");
    }
  };

  if (loading || !settings) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading trial settings…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-2">
            <Gift className="h-6 w-6 text-emerald-500" /> Trial Mode
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Discord trial panel, limits, model whitelist, and user management
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw className="h-4 w-4 mr-2" /> Refresh
          </Button>
          <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Save
          </Button>
        </div>
      </div>

      {message && <p className="text-sm text-emerald-500">{message}</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">General</CardTitle>
          <CardDescription>Enable trial mode and configure access rules</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>Trial Mode Enabled</Label>
            <Switch
              checked={settings.trialEnabled}
              onCheckedChange={(v) => setSettings({ ...settings, trialEnabled: v })}
            />
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <Label>Access Mode</Label>
              <select
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={settings.trialAccessMode}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    trialAccessMode: e.target.value as TrialSettings["trialAccessMode"],
                  })
                }
              >
                <option value="groupy_members">Groupy role required</option>
                <option value="all_members">All server members</option>
              </select>
            </div>
            <div>
              <Label>Required Role ID</Label>
              <Input
                className="mt-1 font-mono text-xs"
                value={settings.trialRequiredRoleId}
                onChange={(e) => setSettings({ ...settings, trialRequiredRoleId: e.target.value })}
              />
            </div>
            <div>
              <Label>Default Duration (days)</Label>
              <select
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={settings.trialDefaultDurationDays}
                onChange={(e) =>
                  setSettings({ ...settings, trialDefaultDurationDays: Number(e.target.value) })
                }
              >
                {DURATION_OPTIONS.map((d) => (
                  <option key={d} value={d}>{d} days</option>
                ))}
              </select>
            </div>
            <div>
              <Label>Max Trials per Account</Label>
              <Input
                type="number"
                min={1}
                className="mt-1"
                value={settings.trialMaxPerAccount}
                onChange={(e) =>
                  setSettings({ ...settings, trialMaxPerAccount: Math.max(1, Number(e.target.value) || 1) })
                }
              />
            </div>
            <div>
              <Label>Daily Token Limit</Label>
              <Input
                type="number"
                min={0}
                className="mt-1"
                value={settings.trialDailyTokenLimit}
                onChange={(e) =>
                  setSettings({ ...settings, trialDailyTokenLimit: Number(e.target.value) || 0 })
                }
              />
            </div>
            <div>
              <Label>Prompt Limit / Window</Label>
              <div className="flex gap-2 mt-1">
                <Input
                  type="number"
                  min={0}
                  value={settings.trialPromptLimit}
                  onChange={(e) =>
                    setSettings({ ...settings, trialPromptLimit: Number(e.target.value) || 0 })
                  }
                />
                <select
                  className="rounded-md border border-border bg-background px-2 text-sm"
                  value={settings.trialPromptLimitWindow}
                  onChange={(e) =>
                    setSettings({ ...settings, trialPromptLimitWindow: e.target.value })
                  }
                >
                  {PROMPT_WINDOWS.map((w) => (
                    <option key={w} value={w}>{w}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Discord Embed</CardTitle>
            <CardDescription>Panel shown in Tokito channel when trial is enabled</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label>Title</Label>
              <Input className="mt-1" value={embed.title || ""} onChange={(e) => setEmbed({ ...embed, title: e.target.value })} />
            </div>
            <div>
              <Label>Description</Label>
              <textarea
                className="mt-1 min-h-[120px] w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
                value={embed.description || ""}
                onChange={(e) => setEmbed({ ...embed, description: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Accent Color</Label>
                <Input
                  type="color"
                  className="mt-1 h-10"
                  value={colorToHex(embed.color)}
                  onChange={(e) => setEmbed({ ...embed, color: hexToColor(e.target.value) })}
                />
              </div>
              <div>
                <Label>Button Label</Label>
                <Input
                  className="mt-1"
                  value={embed.buttonLabel || ""}
                  onChange={(e) => setEmbed({ ...embed, buttonLabel: e.target.value })}
                />
              </div>
            </div>
            <div>
              <Label>Footer</Label>
              <Input className="mt-1" value={embed.footer || ""} onChange={(e) => setEmbed({ ...embed, footer: e.target.value })} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Live Preview</CardTitle>
          </CardHeader>
          <CardContent>
            <EmbedPreview embed={embed} buttonLabel={embed.buttonLabel || "Klaim Trial API"} />
            {settings.trialPanelMessageId && (
              <p className="text-xs text-muted-foreground mt-3 font-mono">
                Panel message ID: {settings.trialPanelMessageId}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Model Whitelist (gpy)</CardTitle>
          <CardDescription>Trial users can only use gpy provider models</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-4">
            <Label>Selection</Label>
            <select
              className="rounded-md border border-border bg-background px-3 py-2 text-sm"
              value={settings.trialModelSelectionMode}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  trialModelSelectionMode: e.target.value as TrialSettings["trialModelSelectionMode"],
                })
              }
            >
              <option value="all_gpy">All gpy models</option>
              <option value="whitelist">Whitelist only</option>
            </select>
          </div>
          {settings.trialModelSelectionMode === "whitelist" && (
            <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto p-2 border rounded-md border-border/50">
              {(settings.gpyModels || []).map((m) => {
                const on = (settings.trialModelWhitelist || []).includes(m);
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => toggleModel(m)}
                    className={`text-xs px-2 py-1 rounded border transition-colors ${
                      on ? "bg-primary/20 border-primary text-primary" : "border-border text-muted-foreground"
                    }`}
                  >
                    {m}
                  </button>
                );
              })}
              {(settings.gpyModels || []).length === 0 && (
                <span className="text-xs text-muted-foreground">No gpy models in catalog</span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">DM Templates</CardTitle>
          <CardDescription>
            Placeholders: {"{endpoint}"} {"{apiKey}"} {"{expiresAt}"} {"{durationDays}"} {"{dailyTokenLimit}"}{" "}
            {"{promptLimit}"} {"{promptWindow}"} {"{modelList}"} {"{reason}"}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {(
            [
              ["claimed", "On Claim"],
              ["limitReached", "Limit Reached"],
              ["expired", "Expired"],
              ["terminated", "Terminated"],
              ["keyRotated", "Key Rotated"],
            ] as const
          ).map(([key, label]) => (
            <div key={key}>
              <Label>{label}</Label>
              <textarea
                className="mt-1 min-h-[80px] w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
                value={(dmTemplates as any)[key] || ""}
                onChange={(e) => setDmTemplates({ ...dmTemplates, [key]: e.target.value })}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Trial Users</CardTitle>
          <CardDescription>{users.length} record(s)</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[800px]">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="text-left py-2 px-4 text-muted-foreground font-medium">User</th>
                  <th className="text-left py-2 px-4 text-muted-foreground font-medium">Status</th>
                  <th className="text-left py-2 px-4 text-muted-foreground font-medium">Expires</th>
                  <th className="text-left py-2 px-4 text-muted-foreground font-medium">Key</th>
                  <th className="text-right py-2 px-4 text-muted-foreground font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr
                    key={u.id}
                    className="border-b border-border/30 cursor-pointer hover:bg-muted/40 transition-colors"
                    onClick={() => navigate(keyDetailPath(u))}
                  >
                    <td className="py-2 px-4">
                      <div className="font-medium">{u.discordUsername || u.discordUserId}</div>
                      <div className="text-xs text-muted-foreground font-mono">{u.discordUserId}</div>
                    </td>
                    <td className="py-2 px-4">
                      <Badge variant={u.status === "active" ? "default" : "secondary"}>{u.status}</Badge>
                    </td>
                    <td className="py-2 px-4 text-xs">{new Date(u.expiresAt).toLocaleString()}</td>
                    <td className="py-2 px-4 font-mono text-xs">{u.keyPrefix}…</td>
                    <td className="py-2 px-4 text-right space-x-1" onClick={(e) => e.stopPropagation()}>
                      <Button size="sm" variant="ghost" onClick={() => navigate(keyDetailPath(u))} title="View detail">
                        <ExternalLink className="h-3 w-3" />
                      </Button>
                      {u.status === "active" && (
                        <>
                          <Button size="sm" variant="outline" onClick={() => void runAction(u.discordUserId, "extend", { days: 7 })}>
                            +7d
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => void runAction(u.discordUserId, "suspend")}>
                            Suspend
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => void runAction(u.discordUserId, "terminate", { reason: "Admin" })}>
                            End
                          </Button>
                        </>
                      )}
                      {u.status !== "active" && (
                        <Button size="sm" variant="outline" onClick={() => void runAction(u.discordUserId, "grant_retry")}>
                          Grant Retry
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center py-8 text-muted-foreground">No trial users yet</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
