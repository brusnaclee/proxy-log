import { useEffect, useState } from "react";
import { settings, logs, type ModelLimitEntry } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, Save, Trash2, AlertTriangle } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

import { useRealtime } from "@/lib/realtime-context";
import { globalSettings, request } from "@/lib/api";
import { Switch } from "@/components/ui/switch";

export default function SettingsPage() {
  const { realtimeEnabled, setRealtimeEnabled } = useRealtime();
  const [globalMaxDevices, setGlobalMaxDevices] = useState(0);
  const [globalPromptLimit, setGlobalPromptLimit] = useState(50);
  const [globalPromptLimitWindow, setGlobalPromptLimitWindow] = useState("30m");
  const [globalPerModelPromptLimit, setGlobalPerModelPromptLimit] = useState(10);
  const [globalPerModelPromptLimitWindow, setGlobalPerModelPromptLimitWindow] = useState("30m");
  const [globalModelLimits, setGlobalModelLimits] = useState<ModelLimitEntry[]>([]);
  const [modelCatalog, setModelCatalog] = useState<string[]>([]);
  const [newModelOverride, setNewModelOverride] = useState("");
  const [newModelOverrideLimit, setNewModelOverrideLimit] = useState(0);
  const [upstreamEndpoint, setUpstreamEndpoint] = useState("");
  const [upstreamApiKey, setUpstreamApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [hasUpstreamKey, setHasUpstreamKey] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [clearDays, setClearDays] = useState(0);
  const [showClear, setShowClear] = useState(false);
  const [showNuke, setShowNuke] = useState(false);
  const [nukeConfirmText, setNukeConfirmText] = useState("");
  const [loading, setLoading] = useState(false);

  // Bot & Tokito states
  const [discordBotToken, setDiscordBotToken] = useState("");
  const [agverifChannelId, setAgverifChannelId] = useState("");
  const [tokitoChannelId, setTokitoChannelId] = useState("");
  const [requiredRoleId, setRequiredRoleId] = useState("");
  const [ownerGroupyRoleId, setOwnerGroupyRoleId] = useState("");
  const [verifiedRoleId, setVerifiedRoleId] = useState("");
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [verifAutoEnabled, setVerifAutoEnabled] = useState(false);
  const [tokitoApiKey, setTokitoApiKey] = useState("");

  useEffect(() => {
    loadSettings();
    loadBotSettings();
  }, []);

  const loadBotSettings = async () => {
    try {
      const b = await request<any>("/settings/bot");
      setDiscordBotToken(b.discordBotToken || "");
      setAgverifChannelId(b.agverifChannelId || "");
      setTokitoChannelId(b.tokitoChannelId || "");
      setRequiredRoleId(b.requiredRoleId || "");
      setOwnerGroupyRoleId(b.ownerGroupyRoleId || "");
      setVerifiedRoleId(b.verifiedRoleId || "");
      setGeminiApiKey(b.geminiApiKey || "");
      setVerifAutoEnabled(Boolean(b.verifAutoEnabled));
      setTokitoApiKey(b.tokitoApiKey || "");
    } catch {}
  };

  const loadSettings = async () => {
    try {
      const data = await settings.get();
      setUpstreamEndpoint(data.upstreamEndpoint);
      setUpstreamApiKey(data.upstreamApiKey);
      setHasUpstreamKey(data.hasUpstreamKey);
    } catch {}
    
    try {
      const g = await globalSettings.get();
      setGlobalMaxDevices(g.globalMaxDevices || 0);
      setGlobalPromptLimit(g.globalPromptLimit || 0);
      setGlobalPromptLimitWindow(g.globalPromptLimitWindow || "30m");
      setGlobalPerModelPromptLimit(g.globalPerModelPromptLimit || 0);
      setGlobalPerModelPromptLimitWindow(g.globalPerModelPromptLimitWindow || "30m");
    } catch {}

    try {
      const ml = await globalSettings.getModelLimits();
      setGlobalModelLimits(ml.data || []);
    } catch {}

    try {
      const catalog = await globalSettings.getModels();
      setModelCatalog(catalog.data || []);
    } catch {}
  };

  const handleSaveSettings = async () => {
    setLoading(true);
    setMessage("");
    setError("");
    try {
      const updates: any = {};
      updates.upstreamEndpoint = upstreamEndpoint;
      if (upstreamApiKey && !upstreamApiKey.includes("...")) {
        updates.upstreamApiKey = upstreamApiKey;
      }
      await settings.update(updates);
      await globalSettings.update({ globalMaxDevices, globalPromptLimit, globalPromptLimitWindow, globalPerModelPromptLimit, globalPerModelPromptLimitWindow });
      await request("/settings/bot", {
        method: "POST",
        body: JSON.stringify({
          discordBotToken,
          agverifChannelId,
          tokitoChannelId,
          requiredRoleId,
          ownerGroupyRoleId,
          verifiedRoleId,
          geminiApiKey,
          verifAutoEnabled,
          tokitoApiKey,
        }),
      });
      setMessage("Settings saved successfully");
      loadSettings();
    } catch (err: any) {
      setError(err.message || "Failed to save settings");
    }
    setLoading(false);
  };

  const handleChangePassword = async () => {
    setMessage("");
    setError("");

    if (newPassword !== confirmPassword) {
      setError("Passwords don't match");
      return;
    }

    if (newPassword.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }

    try {
      await settings.changePassword(currentPassword, newPassword);
      setMessage("Password changed successfully");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      setError(err.message || "Failed to change password");
    }
  };

  const handleClearLogs = async () => {
    try {
      const res = await logs.clear(clearDays);
      setMessage(`Deleted ${res.deletedCount} log entries`);
      setShowClear(false);
    } catch (err: any) {
      setError(err.message || "Failed to clear logs");
    }
  };

  return (
    <div className="space-y-8 max-w-2xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">Configure your proxy gateway</p>
      </div>

      {/* Status Messages */}
      {message && (
        <div className="text-sm text-emerald-400 bg-emerald-400/10 rounded-md px-4 py-3">
          {message}
        </div>
      )}
      {error && (
        <div className="text-sm text-red-400 bg-red-400/10 rounded-md px-4 py-3">
          {error}
        </div>
      )}

      {/* Global & Upstream Configuration */}
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-base">Upstream API Configuration</CardTitle>
          <CardDescription>
            Configure the upstream AI API endpoint that requests will be forwarded to
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="flex items-center justify-between p-4 border border-border/50 rounded-lg mb-6">
              <div>
                <Label className="text-base font-semibold">Live Updates</Label>
                <p className="text-xs text-muted-foreground mt-1">
                  When enabled, dashboard pages receive real-time updates via SSE without manual refresh.
                </p>
              </div>
              <Switch checked={realtimeEnabled} onCheckedChange={setRealtimeEnabled} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <Label>Global Max Devices</Label>
                <Input
                  type="number"
                  value={globalMaxDevices}
                  onChange={(e) => setGlobalMaxDevices(parseInt(e.target.value) || 0)}
                  placeholder="0 for unlimited"
                  className="mt-1"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Default limit for Discord keys.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Global Prompt Limit</Label>
                  <Input
                    type="number"
                    value={globalPromptLimit}
                    onChange={(e) => setGlobalPromptLimit(parseInt(e.target.value) || 0)}
                    placeholder="50"
                    className="mt-1"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Total prompts across all models (0 = unlimited)
                  </p>
                </div>
                <div>
                  <Label>Window</Label>
                  <Input
                    value={globalPromptLimitWindow}
                    onChange={(e) => setGlobalPromptLimitWindow(e.target.value)}
                    placeholder="30m"
                    className="mt-1"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    e.g. 30m, 1h, 1d
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Default Per-Model Limit</Label>
                  <Input
                    type="number"
                    value={globalPerModelPromptLimit}
                    onChange={(e) => setGlobalPerModelPromptLimit(parseInt(e.target.value) || 0)}
                    placeholder="10"
                    className="mt-1"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Default limit per model (0 = unlimited)
                  </p>
                </div>
                <div>
                  <Label>Window</Label>
                  <Input
                    value={globalPerModelPromptLimitWindow}
                    onChange={(e) => setGlobalPerModelPromptLimitWindow(e.target.value)}
                    placeholder="30m"
                    className="mt-1"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    e.g. 30m, 1h, 1d
                  </p>
                </div>
              </div>

              {/* Per-Model Override Limits */}
              <div className="space-y-2 border border-border/50 rounded-lg p-3">
                <Label className="text-sm font-medium">Model Limit Overrides</Label>
                <p className="text-[10px] text-muted-foreground">Override the default per-model limit for specific models. Cannot exceed Global Prompt Limit.</p>
                <div className="flex gap-2">
                  <select
                    className="flex-1 px-2 py-1.5 text-xs rounded border border-border bg-background"
                    value={newModelOverride}
                    onChange={(e) => setNewModelOverride(e.target.value)}
                  >
                    <option value="">Select model...</option>
                    {modelCatalog.filter(m => !globalModelLimits.some(ml => ml.model === m)).map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                  <Input
                    type="number"
                    value={newModelOverrideLimit}
                    onChange={(e) => setNewModelOverrideLimit(parseInt(e.target.value) || 0)}
                    placeholder="Limit"
                    className="w-20 text-xs"
                  />
                  <Button size="sm" variant="outline" onClick={async () => {
                    if (!newModelOverride || newModelOverrideLimit <= 0) return;
                    await globalSettings.setModelLimit(newModelOverride, newModelOverrideLimit);
                    setNewModelOverride(""); setNewModelOverrideLimit(0);
                    const ml = await globalSettings.getModelLimits(); setGlobalModelLimits(ml.data || []);
                  }}>Add</Button>
                </div>
                {globalModelLimits.length > 0 && (
                  <div className="space-y-1 mt-2">
                    {globalModelLimits.map(ml => (
                      <div key={ml.id} className="flex items-center justify-between px-2 py-1 bg-accent/30 rounded text-xs">
                        <code className="font-mono">{ml.model}</code>
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">{ml.promptLimit} prompts</span>
                          <Button size="icon" variant="ghost" className="h-5 w-5" onClick={async () => {
                            await globalSettings.deleteModelLimit(ml.model);
                            const r = await globalSettings.getModelLimits(); setGlobalModelLimits(r.data || []);
                          }}><Trash2 className="h-3 w-3" /></Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <Label>Upstream Endpoint URL</Label>
            <Input
              value={upstreamEndpoint}
              onChange={(e) => setUpstreamEndpoint(e.target.value)}
              placeholder="https://api.openai.com"
              className="mt-1"
            />
          </div>
          <div>
            <Label>Upstream API Key</Label>
            <div className="flex gap-2 mt-1">
              <div className="relative flex-1">
                <Input
                  type={showApiKey ? "text" : "password"}
                  value={upstreamApiKey}
                  onChange={(e) => setUpstreamApiKey(e.target.value)}
                  placeholder={hasUpstreamKey ? "Enter new key to update" : "sk-..."}
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowApiKey(!showApiKey)}
                >
                  {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            {hasUpstreamKey && (
              <p className="text-xs text-muted-foreground mt-1">
                A key is already configured. Enter a new one to replace it.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-base">Bot & Monitor Configuration</CardTitle>
          <CardDescription>Configure Discord Bot and Tokito Model Monitoring (Settings apply to proxy and bot logic)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Discord Bot Token</Label>
              <Input type="password" value={discordBotToken} onChange={(e) => setDiscordBotToken(e.target.value)} placeholder="MTA..." className="mt-1" />
            </div>
            <div className="flex items-center justify-between p-2 border border-border/50 rounded-lg">
              <div>
                <Label>Auto Verification</Label>
                <p className="text-[10px] text-muted-foreground mt-0.5">Enable auto role verification via Gemini</p>
              </div>
              <Switch checked={verifAutoEnabled} onCheckedChange={setVerifAutoEnabled} />
            </div>
            <div>
              <Label>Tokito API Key</Label>
              <Input type="password" value={tokitoApiKey} onChange={(e) => setTokitoApiKey(e.target.value)} placeholder="sk-..." className="mt-1" />
            </div>
            <div>
              <Label>Gemini API Key</Label>
              <Input type="password" value={geminiApiKey} onChange={(e) => setGeminiApiKey(e.target.value)} placeholder="AIzaSy..." className="mt-1" />
            </div>
            <div>
              <Label>Tokito Panel Channel ID</Label>
              <Input value={tokitoChannelId} onChange={(e) => setTokitoChannelId(e.target.value)} placeholder="1470313..." className="mt-1" />
            </div>
            <div>
              <Label>Agverif Ticket Channel ID</Label>
              <Input value={agverifChannelId} onChange={(e) => setAgverifChannelId(e.target.value)} placeholder="150764..." className="mt-1" />
            </div>
            <div>
              <Label>Required Role ID</Label>
              <Input value={requiredRoleId} onChange={(e) => setRequiredRoleId(e.target.value)} placeholder="13546..." className="mt-1" />
            </div>
            <div>
              <Label>Verified Role ID</Label>
              <Input value={verifiedRoleId} onChange={(e) => setVerifiedRoleId(e.target.value)} placeholder="15081..." className="mt-1" />
            </div>
            <div>
              <Label>Owner/Admin Role ID</Label>
              <Input value={ownerGroupyRoleId} onChange={(e) => setOwnerGroupyRoleId(e.target.value)} placeholder="13546..." className="mt-1" />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSaveSettings} disabled={loading} className="w-full md:w-auto">
          <Save className="h-4 w-4 mr-2" />
          {loading ? "Saving..." : "Save Settings"}
        </Button>
      </div>

      {/* Change Password */}
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-base">Change Admin Password</CardTitle>
          <CardDescription>Update your dashboard login password</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Current Password</Label>
            <Input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label>New Password</Label>
            <Input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label>Confirm New Password</Label>
            <Input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="mt-1"
            />
          </div>
          <Button
            onClick={handleChangePassword}
            disabled={!currentPassword || !newPassword || !confirmPassword}
          >
            Change Password
          </Button>
        </CardContent>
      </Card>

      {/* Danger Zone */}
      <Card className="border-red-500/30">
        <CardHeader>
          <CardTitle className="text-base text-red-400 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Danger Zone
          </CardTitle>
          <CardDescription>Destructive actions that cannot be undone</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 border border-red-500/20 rounded-lg">
            <div>
              <p className="text-sm font-medium">Clear Logs &amp; Sessions</p>
              <p className="text-xs text-muted-foreground mt-1">
                Delete request logs and chat sessions — older than N days, or all at once.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => { setClearDays(90); setShowClear(true); }}>
                <Trash2 className="h-3 w-3 mr-1" /> Older Than...
              </Button>
              <Button variant="destructive" size="sm" onClick={() => { setClearDays(0); setShowClear(true); }}>
                <Trash2 className="h-3 w-3 mr-1" /> Clear All
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-between p-4 border-2 border-red-600/50 rounded-lg bg-red-950/20">
            <div>
              <p className="text-sm font-bold text-red-400 flex items-center gap-1">
                <AlertTriangle className="h-4 w-4" /> Full Database Reset
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Delete <strong>everything</strong>: logs, sessions, <strong>API keys</strong>, devices, policies, and model monitor data. The admin account is kept.
              </p>
            </div>
            <Button variant="destructive" size="sm" className="bg-red-700 hover:bg-red-800 border border-red-500" onClick={() => { setNukeConfirmText(""); setShowNuke(true); }}>
              <AlertTriangle className="h-3 w-3 mr-1" /> Nuke Database
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Clear Logs Dialog */}
      <Dialog open={showClear} onOpenChange={setShowClear}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear Logs</DialogTitle>
            <DialogDescription>
              Delete request logs and chat sessions. Set 0 to delete everything.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Delete logs older than (days) — set 0 to delete ALL</Label>
              <Input
                type="number"
                min={0}
                value={clearDays}
                onChange={(e) => setClearDays(parseInt(e.target.value) >= 0 ? parseInt(e.target.value) : 90)}
                className="mt-1"
              />
            </div>
            {clearDays === 0 && (
              <p className="text-xs text-red-400 font-medium">
                Warning: Setting 0 will delete ALL logs and sessions immediately.
              </p>
            )}
            {clearDays > 0 && (
              <p className="text-xs text-muted-foreground">
                Will delete logs and sessions older than <strong>{clearDays} days</strong>.
                Logs from the past {clearDays} days will be kept.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowClear(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleClearLogs}>
              {clearDays === 0 ? "Delete All Logs" : `Delete Logs Older Than ${clearDays}d`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Nuke Database Dialog */}
      <Dialog open={showNuke} onOpenChange={(o) => { setShowNuke(o); setNukeConfirmText(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-red-400 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" /> Full Database Reset
            </DialogTitle>
            <DialogDescription className="space-y-2 pt-1">
              <span className="block text-red-400 font-medium">This will permanently delete:</span>
              <ul className="text-sm list-disc list-inside space-y-1">
                <li>All request logs</li>
                <li>All chat sessions</li>
                <li>All API keys (including Discord-provisioned keys)</li>
                <li>All devices and policies</li>
                <li>All model monitor data</li>
              </ul>
              <span className="block text-muted-foreground text-xs mt-2">Your admin account and settings will be kept.</span>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label className="text-sm">
              Type <strong className="text-red-400 font-mono">NUKE</strong> to confirm:
            </Label>
            <Input
              value={nukeConfirmText}
              onChange={(e) => setNukeConfirmText(e.target.value)}
              placeholder="Type NUKE here"
              className="border-red-500/50 focus:border-red-500"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowNuke(false); setNukeConfirmText(""); }}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="bg-red-700 hover:bg-red-800"
              disabled={nukeConfirmText !== "NUKE"}
              onClick={async () => {
                if (nukeConfirmText !== "NUKE") return;
                try {
                  await logs.nukeAll();
                  setShowNuke(false);
                  setNukeConfirmText("");
                  setMessage("Database fully reset. All keys, devices, logs, and sessions deleted.");
                } catch (err: any) {
                  setError(err.message || "Failed to nuke database");
                  setShowNuke(false);
                }
              }}
            >
              <AlertTriangle className="h-3 w-3 mr-1" /> Nuke Everything
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
