import { useEffect, useState } from "react";
import { settings, logs, type ModelLimitEntry } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, Save, Trash2, AlertTriangle } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter, DialogTrigger
} from "@/components/ui/dialog";

import { useRealtime } from "@/lib/realtime-context";
import { ProvidersManager } from "@/components/ProvidersManager";
import { globalSettings, request } from "@/lib/api";
import { Switch } from "@/components/ui/switch";

export default function SettingsPage() {
  const { realtimeEnabled, setRealtimeEnabled } = useRealtime();
  const [globalMaxDevices, setGlobalMaxDevices] = useState(0);
  const [globalPromptLimit, setGlobalPromptLimit] = useState(50);
  const [globalPromptLimitWindow, setGlobalPromptLimitWindow] = useState("5h");
  const [globalRateLimit, setGlobalRateLimit] = useState(1000);
  const [globalRateLimitWindow, setGlobalRateLimitWindow] = useState("5h");
  const [tokenLimitWeightPercent, setTokenLimitWeightPercent] = useState(10);
  const [globalPerModelPromptLimit, setGlobalPerModelPromptLimit] = useState(10);
  const [globalPerModelPromptLimitWindow, setGlobalPerModelPromptLimitWindow] = useState("5h");
  const [globalDailyTokenLimit, setGlobalDailyTokenLimit] = useState(0);
  const [globalMonthlyTokenLimit, setGlobalMonthlyTokenLimit] = useState(0);
  const [globalDailyInputTokenLimit, setGlobalDailyInputTokenLimit] = useState(0);
  const [globalDailyOutputTokenLimit, setGlobalDailyOutputTokenLimit] = useState(0);
  const [tokenSaverRtkEnabled, setTokenSaverRtkEnabled] = useState(true);
  const [tokenInputMode, setTokenInputMode] = useState<"per_turn_peak" | "full" | "billable">("per_turn_peak");
  const [tokenSaverRtkMaxChars, setTokenSaverRtkMaxChars] = useState(2000);
  const [tokenSaverHeadroomEnabled, setTokenSaverHeadroomEnabled] = useState(false);
  const [tokenSaverHeadroomUrl, setTokenSaverHeadroomUrl] = useState("");
  const [tokenSaverCavemanEnabled, setTokenSaverCavemanEnabled] = useState(false);
  const [tokenSaverCavemanLevel, setTokenSaverCavemanLevel] = useState(2);
  const [tokenSaverPonytailEnabled, setTokenSaverPonytailEnabled] = useState(false);
  const [tokenSaverPonytailLevel, setTokenSaverPonytailLevel] = useState("lite");
  const [globalModelLimits, setGlobalModelLimits] = useState<ModelLimitEntry[]>([]);
  const [modelCatalog, setModelCatalog] = useState<string[]>([]);
  const [newModelOverride, setNewModelOverride] = useState("");
  const [newModelOverrideIsPattern, setNewModelOverrideIsPattern] = useState(false);
  const [globalModelMatchPreview, setGlobalModelMatchPreview] = useState<{ ids: string[]; total: number }>({ ids: [], total: 0 });
  const [newModelOverrideLimit, setNewModelOverrideLimit] = useState(0);
  const [newModelOverrideDailyTokenLimit, setNewModelOverrideDailyTokenLimit] = useState(0);
  const [newModelOverrideMonthlyTokenLimit, setNewModelOverrideMonthlyTokenLimit] = useState(0);
  const [newModelOverrideDailyInputTokenLimit, setNewModelOverrideDailyInputTokenLimit] = useState(0);
  const [newModelOverrideDailyOutputTokenLimit, setNewModelOverrideDailyOutputTokenLimit] = useState(0);
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
  const [monitorAutoMode, setMonitorAutoMode] = useState<"off" | "notif_only" | "auto">("notif_only");

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
      const mode = String(b.monitorAutoMode || "notif_only");
      setMonitorAutoMode(mode === "off" || mode === "auto" || mode === "notif_only" ? mode : "notif_only");
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
      setGlobalPromptLimitWindow(g.globalPromptLimitWindow || "5h");
      setGlobalRateLimit(g.globalRateLimit || 0);
      setGlobalRateLimitWindow(g.globalRateLimitWindow || "5h");
      setTokenLimitWeightPercent(
        typeof g.tokenLimitWeightPercent === "number" ? g.tokenLimitWeightPercent : 10,
      );
      setGlobalPerModelPromptLimit(g.globalPerModelPromptLimit || 0);
      setGlobalPerModelPromptLimitWindow(g.globalPerModelPromptLimitWindow || "5h");
      setGlobalDailyTokenLimit(g.globalDailyTokenLimit || 0);
      setGlobalMonthlyTokenLimit(g.globalMonthlyTokenLimit || 0);
      setGlobalDailyInputTokenLimit(g.globalDailyInputTokenLimit || 0);
      setGlobalDailyOutputTokenLimit(g.globalDailyOutputTokenLimit || 0);
      setTokenInputMode(
        g.tokenInputMode === "full" || g.tokenInputMode === "billable"
          ? g.tokenInputMode
          : "per_turn_peak",
      );
      setTokenSaverRtkEnabled(g.tokenSaverRtkEnabled ?? true);
      setTokenSaverRtkMaxChars(g.tokenSaverRtkMaxChars ?? 2000);
      setTokenSaverHeadroomEnabled(g.tokenSaverHeadroomEnabled ?? false);
      setTokenSaverHeadroomUrl(g.tokenSaverHeadroomUrl || "");
      setTokenSaverCavemanEnabled(g.tokenSaverCavemanEnabled ?? false);
      setTokenSaverCavemanLevel(g.tokenSaverCavemanLevel ?? 2);
      setTokenSaverPonytailEnabled(g.tokenSaverPonytailEnabled ?? false);
      setTokenSaverPonytailLevel(g.tokenSaverPonytailLevel || "lite");
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
      await globalSettings.update({
        globalMaxDevices, globalPromptLimit, globalPromptLimitWindow,
        globalRateLimit, globalRateLimitWindow,
        globalPerModelPromptLimit, globalPerModelPromptLimitWindow,
        globalDailyTokenLimit, globalMonthlyTokenLimit,
        globalDailyInputTokenLimit, globalDailyOutputTokenLimit,
        tokenInputMode,
        tokenLimitWeightPercent,
        tokenSaverRtkEnabled, tokenSaverRtkMaxChars,
        tokenSaverHeadroomEnabled, tokenSaverHeadroomUrl,
        tokenSaverCavemanEnabled, tokenSaverCavemanLevel,
        tokenSaverPonytailEnabled, tokenSaverPonytailLevel,
      });
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
          monitorAutoMode,
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

      <ProvidersManager />

      {/* Token Saver (9router-style) */}
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-base">Token Saver</CardTitle>
          <CardDescription className="space-y-2">
            <p>
              Global defaults for all users. Pipeline order: <strong>RTK → Headroom → Caveman → Ponytail</strong>.
              Users can override per-feature in the portal (Default / On / Off). One-shot kill switch: header{" "}
              <code className="text-xs">X-Token-Saver: off</code>.
            </p>
            <p className="text-xs">
              RTK touches <em>input</em> (tool dumps). Caveman/Ponytail touch <em>style of output</em> via system prompts — keep them OFF unless you want terse agents.
            </p>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-3 border border-border/50 rounded-lg">
            <div className="pr-4">
              <Label className="font-medium">RTK (compress tool output)</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Truncates noisy tool_result content (git/grep/ls/read/shell). Keeps head+tail. Skips write/edit/apply tools and never mutates tool_calls JSON.
              </p>
              <p className="text-[11px] text-muted-foreground/80 mt-1">
                Effect: biggest saver for Cline/Roo/Kilo. Risk: middle of a long dump is dropped. Recommended default: ON.
              </p>
            </div>
            <Switch checked={tokenSaverRtkEnabled} onCheckedChange={setTokenSaverRtkEnabled} />
          </div>
          {tokenSaverRtkEnabled && (
            <div>
              <Label>RTK max chars per tool result</Label>
              <p className="text-[11px] text-muted-foreground mb-1">Budget after which middle is truncated (min 200). Default 2000.</p>
              <Input
                type="number"
                value={tokenSaverRtkMaxChars}
                onChange={(e) => setTokenSaverRtkMaxChars(parseInt(e.target.value) || 2000)}
                className="mt-1 max-w-xs"
              />
            </div>
          )}
          <div className="flex items-center justify-between p-3 border border-border/50 rounded-lg">
            <div className="pr-4">
              <Label className="font-medium">Headroom</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Optional external POST /compress service. 3s timeout, fail-open (request continues if service is down).
              </p>
              <p className="text-[11px] text-muted-foreground/80 mt-1">
                Effect: further shortens message history. Without a URL below, enabling does nothing. Recommended default: OFF.
              </p>
            </div>
            <Switch checked={tokenSaverHeadroomEnabled} onCheckedChange={setTokenSaverHeadroomEnabled} />
          </div>
          {tokenSaverHeadroomEnabled && (
            <div>
              <Label>Headroom URL</Label>
              <Input
                value={tokenSaverHeadroomUrl}
                onChange={(e) => setTokenSaverHeadroomUrl(e.target.value)}
                placeholder="https://headroom.example/v1/compress"
                className="mt-1"
              />
            </div>
          )}
          <div className="flex items-center justify-between p-3 border border-border/50 rounded-lg">
            <div className="pr-4">
              <Label className="font-medium">Caveman</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Injects a terse-reply system prompt (levels 1=light … 5=telegram). Does not alter tools — only reply style.
              </p>
              <p className="text-[11px] text-muted-foreground/80 mt-1">
                Effect: fewer completion tokens. Risk: curt/odd prose; can confuse agents that need rich explanations. Recommended default: OFF.
              </p>
            </div>
            <Switch checked={tokenSaverCavemanEnabled} onCheckedChange={setTokenSaverCavemanEnabled} />
          </div>
          {tokenSaverCavemanEnabled && (
            <div>
              <Label>Caveman level (1–5)</Label>
              <Input
                type="number"
                min={1}
                max={5}
                value={tokenSaverCavemanLevel}
                onChange={(e) => setTokenSaverCavemanLevel(Math.max(1, Math.min(5, parseInt(e.target.value) || 2)))}
                className="mt-1 max-w-xs"
              />
            </div>
          )}
          <div className="flex items-center justify-between p-3 border border-border/50 rounded-lg">
            <div className="pr-4">
              <Label className="font-medium">Ponytail</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Injects anti-boilerplate for IDE agents: skip &quot;Sure!&quot;, skip plan restatements, act directly (lite / full / ultra).
              </p>
              <p className="text-[11px] text-muted-foreground/80 mt-1">
                Effect: leaner agent loops (Cline/Roo). Risk: less narration. Recommended default: OFF.
              </p>
            </div>
            <Switch checked={tokenSaverPonytailEnabled} onCheckedChange={setTokenSaverPonytailEnabled} />
          </div>
          {tokenSaverPonytailEnabled && (
            <div>
              <Label>Ponytail level</Label>
              <select
                value={tokenSaverPonytailLevel}
                onChange={(e) => setTokenSaverPonytailLevel(e.target.value)}
                className="mt-1 flex h-9 w-full max-w-xs rounded-md border border-input bg-transparent px-3 py-1 text-sm"
              >
                <option value="lite">lite — skip acks / plan echo</option>
                <option value="full">full — + no post-tool summaries</option>
                <option value="ultra">ultra — + never restate file contents</option>
              </select>
            </div>
          )}
        </CardContent>
      </Card>

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
                    1 per user turn (distinct turn_id). 0 = unlimited. Default 50/5h.
                  </p>
                </div>
                <div>
                  <Label>Window</Label>
                  <Input
                    value={globalPromptLimitWindow}
                    onChange={(e) => setGlobalPromptLimitWindow(e.target.value)}
                    placeholder="5h"
                    className="mt-1"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    e.g. 5h, 1d
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Global API Call Limit</Label>
                  <Input
                    type="number"
                    value={globalRateLimit}
                    onChange={(e) => setGlobalRateLimit(parseInt(e.target.value) || 0)}
                    placeholder="1000"
                    className="mt-1"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Every successful upstream hop (tools/subagent). 0 = unlimited. Default 1000/5h.
                  </p>
                </div>
                <div>
                  <Label>Window</Label>
                  <Input
                    value={globalRateLimitWindow}
                    onChange={(e) => setGlobalRateLimitWindow(e.target.value)}
                    placeholder="5h"
                    className="mt-1"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    e.g. 5h, 1d
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Token limit weight %</Label>
                  <Input
                    type="number"
                    value={tokenLimitWeightPercent}
                    onChange={(e) => setTokenLimitWeightPercent(parseInt(e.target.value) || 10)}
                    placeholder="10"
                    className="mt-1"
                    min={1}
                    max={100}
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Each hop&apos;s In+Out counts this % toward daily/monthly token limits (logs stay 100%). Default 10.
                  </p>
                </div>
                <div className="flex items-end pb-1">
                  <p className="text-[10px] text-muted-foreground">
                    Example: 100 hops × 10k In → limit uses ~100k at 10% (not 1M). Visible on Key Detail / portal / Discord usage bars.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Default Per-Model Prompt Limit</Label>
                  <Input
                    type="number"
                    value={globalPerModelPromptLimit}
                    onChange={(e) => setGlobalPerModelPromptLimit(parseInt(e.target.value) || 0)}
                    placeholder="10"
                    className="mt-1"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Default prompt limit per model (0 = unlimited)
                  </p>
                </div>
                <div>
                  <Label>Window</Label>
                  <Input
                    value={globalPerModelPromptLimitWindow}
                    onChange={(e) => setGlobalPerModelPromptLimitWindow(e.target.value)}
                    placeholder="5h"
                    className="mt-1"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    e.g. 5h, 1d
                  </p>
                </div>
              </div>

              {/* Global Token Limits */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Daily Token Limit</Label>
                  <Input
                    type="number"
                    value={globalDailyTokenLimit}
                    onChange={(e) => setGlobalDailyTokenLimit(parseInt(e.target.value) || 0)}
                    placeholder="0 = unlimited"
                    className="mt-1"
                  />
                  <p className="text-xs text-muted-foreground mt-1">Max tokens per user per day (0 = unlimited)</p>
                </div>
                <div>
                  <Label>Monthly Token Limit</Label>
                  <Input
                    type="number"
                    value={globalMonthlyTokenLimit}
                    onChange={(e) => setGlobalMonthlyTokenLimit(parseInt(e.target.value) || 0)}
                    placeholder="0 = unlimited"
                    className="mt-1"
                  />
                  <p className="text-xs text-muted-foreground mt-1">Max tokens per user per month (0 = unlimited)</p>
                  </div>
                </div>
                <div>
                  <Label>Input token mode</Label>
                  <select
                    className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                    value={tokenInputMode}
                    onChange={(e) => {
                      const v = e.target.value;
                      setTokenInputMode(
                        v === "full" || v === "billable" ? v : "per_turn_peak",
                      );
                    }}
                  >
                    <option value="per_turn_peak">Per-turn peak (recommended) — MAX context once per prompt</option>
                    <option value="full">Full hop sum — match upstream In / amanai</option>
                    <option value="billable">Billable / delta only (legacy)</option>
                  </select>
                  <p className="text-xs text-muted-foreground mt-1">
                    Peak = cache+prompt counted once per user prompt (tool loops don’t multiply). Full = sum every API hop.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Daily Input Token Limit</Label>
                    <Input
                      type="number"
                      value={globalDailyInputTokenLimit}
                      onChange={(e) => setGlobalDailyInputTokenLimit(parseInt(e.target.value) || 0)}
                      placeholder="0 = unlimited"
                      className="mt-1"
                    />
                    <p className="text-xs text-muted-foreground mt-1">Max input tokens per user per day (0 = unlimited)</p>
                  </div>
                  <div>
                    <Label>Daily Output Token Limit</Label>
                    <Input
                      type="number"
                      value={globalDailyOutputTokenLimit}
                      onChange={(e) => setGlobalDailyOutputTokenLimit(parseInt(e.target.value) || 0)}
                      placeholder="0 = unlimited"
                      className="mt-1"
                    />
                    <p className="text-xs text-muted-foreground mt-1">Max output tokens per user per day (0 = unlimited)</p>
                  </div>
                </div>

              {/* Per-Model Override Limits */}
              <div className="md:col-span-2 space-y-2 border border-border/50 rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm font-medium">Model Limit Overrides</Label>
                    <p className="text-[10px] text-muted-foreground">
                      Override prompt and/or token caps per model (global). Token-only rows (daily/monthly without prompt limit) are enforced.
                      Pattern rows (e.g. <span className="font-mono">claude</span> / <span className="font-mono">gpt-5.6</span> @ 5 prompts) share one family quota.
                      Window for all overrides = <b>Default Per-Model Window</b> above (not per-row). Unlimited token users still get these prompt caps.
                    </p>
                  </div>
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button variant="outline" size="sm">Manage Model Limits</Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                      <DialogHeader>
                        <DialogTitle>Manage Global Model Limits</DialogTitle>
                        <DialogDescription>
                          Configure specific prompt and token limits for individual models globally.
                        </DialogDescription>
                      </DialogHeader>
                      
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 border p-4 rounded-lg bg-accent/10">
                        <div className="col-span-2 md:col-span-3">
                          <Label>Model (ketik pattern, mis. "claude" / "ag" / "qwen3.5")</Label>
                          <Input
                            className="mt-1"
                            placeholder="Ketik untuk cari model..."
                            value={newModelOverride}
                            onChange={(e) => {
                              const v = e.target.value;
                              setNewModelOverride(v);
                              if ((window as any).__globalMlMatchT) {
                                clearTimeout((window as any).__globalMlMatchT);
                              }
                              const existing = globalModelLimits.find(ml => ml.model === v);
                              (window as any).__globalMlMatchT = setTimeout(async () => {
                                if (!v || v.length < 1) {
                                  setGlobalModelMatchPreview({ ids: [], total: 0 });
                                  return;
                                }
                                try {
                                  const r = await globalSettings.matchModelCatalog(v);
                                  setGlobalModelMatchPreview({ ids: r.data, total: r.total });
                                  // Auto-detect pattern only when creating a new row (don't flip existing)
                                  if (!existing) {
                                    if (r.total >= 2) setNewModelOverrideIsPattern(true);
                                    else if (r.total === 1) setNewModelOverrideIsPattern(false);
                                  }
                                } catch {
                                  setGlobalModelMatchPreview({ ids: [], total: 0 });
                                }
                              }, 300);
                              if (existing) {
                                setNewModelOverrideLimit(existing.promptLimit || 0);
                                setNewModelOverrideDailyTokenLimit(existing.dailyTokenLimit || 0);
                                setNewModelOverrideMonthlyTokenLimit(existing.monthlyTokenLimit || 0);
                                setNewModelOverrideDailyInputTokenLimit(existing.dailyInputTokenLimit || 0);
                                setNewModelOverrideDailyOutputTokenLimit(existing.dailyOutputTokenLimit || 0);
                                setNewModelOverrideIsPattern(!!existing.isPattern);
                              } else {
                                setNewModelOverrideLimit(0);
                                setNewModelOverrideDailyTokenLimit(0);
                                setNewModelOverrideMonthlyTokenLimit(0);
                                setNewModelOverrideDailyInputTokenLimit(0);
                                setNewModelOverrideDailyOutputTokenLimit(0);
                              }
                            }}
                          />
                          {newModelOverride.length > 0 && (
                            <div className="mt-1 space-y-1 text-xs text-muted-foreground">
                              {newModelOverrideIsPattern ? (
                                <>
                                  <div>
                                    Pattern akan apply ke <b>{globalModelMatchPreview.total}</b> model yang mengandung substring <span className="font-mono">"{newModelOverride}"</span>:
                                  </div>
                                  {globalModelMatchPreview.total > 0 && (
                                    <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto p-1 border rounded bg-background/40">
                                      {globalModelMatchPreview.ids.map((m) => (
                                        <span key={m} className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 font-mono text-[10px]">
                                          {m}
                                        </span>
                                      ))}
                                      {globalModelMatchPreview.total > globalModelMatchPreview.ids.length && (
                                        <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-[10px]">
                                          ...{(globalModelMatchPreview.total - globalModelMatchPreview.ids.length).toLocaleString()} lagi
                                        </span>
                                      )}
                                    </div>
                                  )}
                                  {globalModelMatchPreview.total === 0 && (
                                    <div className="text-amber-600 dark:text-amber-400">
                                      Belum ada model di catalog yang cocok. Pattern tetap tersimpan dan akan apply ke model baru yang mengandung substring ini.
                                    </div>
                                  )}
                                </>
                              ) : (
                                <div>
                                  {globalModelMatchPreview.total > 0
                                    ? `Cocok dengan ${globalModelMatchPreview.total} model di catalog: ${globalModelMatchPreview.ids.slice(0, 3).join(", ")}${globalModelMatchPreview.total > 3 ? ` +${globalModelMatchPreview.total - 3}` : ""}`
                                    : "Tidak ada model di catalog yang cocok (entry exact akan tersimpan, tidak match ke model lain)"}
                                </div>
                              )}
                            </div>
                          )}
                          <div className="mt-2 flex items-center gap-2">
                            <input
                              id="newModelOverrideIsPattern"
                              type="checkbox"
                              checked={newModelOverrideIsPattern}
                              onChange={(e) => setNewModelOverrideIsPattern(e.target.checked)}
                            />
                            <Label htmlFor="newModelOverrideIsPattern" className="cursor-pointer text-xs">
                              <b>Pattern / batch</b> (auto-detect: ON saat ≥2 model cocok) — 1 entry ini auto-apply ke semua model yang substring mengandung "{newModelOverride}"
                            </Label>
                          </div>
                        </div>
                        <div>
                          <Label>Prompt Limit</Label>
                          <Input type="number" value={newModelOverrideLimit} onChange={(e) => setNewModelOverrideLimit(parseInt(e.target.value) || 0)} className="mt-1" />
                        </div>
                        <div>
                          <Label>Daily Token Limit</Label>
                          <Input type="number" value={newModelOverrideDailyTokenLimit} onChange={(e) => setNewModelOverrideDailyTokenLimit(parseInt(e.target.value) || 0)} className="mt-1" />
                        </div>
                        <div>
                          <Label>Monthly Token Limit</Label>
                          <Input type="number" value={newModelOverrideMonthlyTokenLimit} onChange={(e) => setNewModelOverrideMonthlyTokenLimit(parseInt(e.target.value) || 0)} className="mt-1" />
                        </div>
                        <div>
                          <Label>Daily Input Token Limit</Label>
                          <Input type="number" value={newModelOverrideDailyInputTokenLimit} onChange={(e) => setNewModelOverrideDailyInputTokenLimit(parseInt(e.target.value) || 0)} className="mt-1" />
                        </div>
                        <div>
                          <Label>Daily Output Token Limit</Label>
                          <Input type="number" value={newModelOverrideDailyOutputTokenLimit} onChange={(e) => setNewModelOverrideDailyOutputTokenLimit(parseInt(e.target.value) || 0)} className="mt-1" />
                        </div>
                        <div className="col-span-2 md:col-span-3 flex flex-wrap items-center justify-end gap-2">
                          {newModelOverrideIsPattern && globalModelMatchPreview.total > 0 && (
                            <Button
                              variant="outline"
                              disabled={loading}
                              onClick={async () => {
                                if (!newModelOverride) return;
                                if (!confirm(`Buat ${globalModelMatchPreview.total} entry exact untuk semua model yang cocok?`)) return;
                                setLoading(true);
                                try {
                                  const limits = {
                                    promptLimit: newModelOverrideLimit,
                                    dailyTokenLimit: newModelOverrideDailyTokenLimit,
                                    monthlyTokenLimit: newModelOverrideMonthlyTokenLimit,
                                    dailyInputTokenLimit: newModelOverrideDailyInputTokenLimit,
                                    dailyOutputTokenLimit: newModelOverrideDailyOutputTokenLimit,
                                  };
                                  for (const m of globalModelMatchPreview.ids) {
                                    // Store bare id (strip provider/) so runtime normalize matches.
                                    const bare = m.includes("/") ? m.slice(m.lastIndexOf("/") + 1) : m;
                                    await globalSettings.setModelLimit(bare, { ...limits, isPattern: false });
                                  }
                                  setMessage(`Berhasil apply ke ${globalModelMatchPreview.ids.length} model exact.`);
                                } catch (e: any) {
                                  setError(`Gagal bulk apply: ${e?.message || e}`);
                                } finally {
                                  setLoading(false);
                                }
                                setNewModelOverride("");
                                setNewModelOverrideIsPattern(false);
                                setNewModelOverrideLimit(0);
                                setNewModelOverrideDailyTokenLimit(0);
                                setNewModelOverrideMonthlyTokenLimit(0);
                                setNewModelOverrideDailyInputTokenLimit(0);
                                setNewModelOverrideDailyOutputTokenLimit(0);
                                setGlobalModelMatchPreview({ ids: [], total: 0 });
                                const ml = await globalSettings.getModelLimits(); setGlobalModelLimits(ml.data || []);
                              }}
                            >
                              Bulk Exact ke {globalModelMatchPreview.total} model
                            </Button>
                          )}
                          <Button
                            disabled={loading}
                            onClick={async () => {
                              if (!newModelOverride) return;
                              setLoading(true);
                              try {
                                await globalSettings.setModelLimit(newModelOverride, {
                                  promptLimit: newModelOverrideLimit,
                                  dailyTokenLimit: newModelOverrideDailyTokenLimit,
                                  monthlyTokenLimit: newModelOverrideMonthlyTokenLimit,
                                  dailyInputTokenLimit: newModelOverrideDailyInputTokenLimit,
                                  dailyOutputTokenLimit: newModelOverrideDailyOutputTokenLimit,
                                  isPattern: newModelOverrideIsPattern,
                                });
                                if (newModelOverrideIsPattern) {
                                  setMessage(`Pattern "${newModelOverride}" tersimpan. Akan auto-apply ke ${globalModelMatchPreview.total} model yang cocok.`);
                                } else {
                                  setMessage(`Model override untuk "${newModelOverride}" tersimpan.`);
                                }
                              } catch (e: any) {
                                setError(`Gagal simpan: ${e?.message || e}`);
                              } finally {
                                setLoading(false);
                              }
                              setNewModelOverride("");
                              setNewModelOverrideIsPattern(false);
                              setNewModelOverrideLimit(0);
                              setNewModelOverrideDailyTokenLimit(0);
                              setNewModelOverrideMonthlyTokenLimit(0);
                              setNewModelOverrideDailyInputTokenLimit(0);
                              setNewModelOverrideDailyOutputTokenLimit(0);
                              setGlobalModelMatchPreview({ ids: [], total: 0 });
                              const ml = await globalSettings.getModelLimits(); setGlobalModelLimits(ml.data || []);
                            }}
                          >
                            {newModelOverrideIsPattern
                              ? `Simpan Pattern (auto ke ${globalModelMatchPreview.total} model)`
                              : "Save Model Override"}
                          </Button>
                        </div>
                      </div>

                      <div className="mt-6 space-y-2">
                        <Label>Configured Limits</Label>
                        {globalModelLimits.length > 0 ? (
                          <div className="border rounded-md overflow-hidden">
                            <table className="w-full text-xs text-left">
                              <thead className="bg-muted text-muted-foreground">
                                <tr>
                                  <th className="p-2 font-medium">Model</th>
                                  <th className="p-2 font-medium">Prompts</th>
                                  <th className="p-2 font-medium">Daily Tokens</th>
                                  <th className="p-2 font-medium">Monthly Tokens</th>
                                  <th className="p-2 font-medium">Daily Input</th>
                                  <th className="p-2 font-medium">Daily Output</th>
                                  <th className="p-2"></th>
                                </tr>
                              </thead>
                              <tbody className="divide-y">
                                {globalModelLimits.map(ml => (
                                  <tr key={ml.id} className="hover:bg-muted/50 align-top">
                                    <td className="p-2 font-mono">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span>{ml.model}</span>
                                        {ml.isPattern && (
                                          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide bg-amber-500/15 text-amber-600 dark:text-amber-400">
                                            PATTERN
                                          </span>
                                        )}
                                        {ml.isPattern && (
                                          <span className="text-[10px] text-muted-foreground">
                                            ({ml.matchCount ?? 0} model ter-attach)
                                          </span>
                                        )}
                                      </div>
                                      {ml.isPattern && ml.matchedIds && ml.matchedIds.length > 0 && (
                                        <div className="mt-1 flex flex-wrap gap-1 max-h-20 overflow-y-auto p-1 border rounded bg-background/40">
                                          {ml.matchedIds.slice(0, 20).map((m) => (
                                            <span key={m} className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-300 font-mono text-[10px]">
                                              {m}
                                            </span>
                                          ))}
                                          {(ml.matchCount ?? 0) > (ml.matchedIds?.length ?? 0) && (
                                            <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-[10px]">
                                              +{(ml.matchCount ?? 0) - (ml.matchedIds?.length ?? 0)} lagi
                                            </span>
                                          )}
                                        </div>
                                      )}
                                      {ml.isPattern && ml.matchCount === 0 && (
                                        <div className="mt-1 text-[10px] text-amber-600 dark:text-amber-400">
                                          Belum ada model di catalog yang cocok dengan pattern ini.
                                        </div>
                                      )}
                                    </td>
                                    <td className="p-2">{ml.promptLimit || '-'}</td>
                                    <td className="p-2">{ml.dailyTokenLimit || '-'}</td>
                                    <td className="p-2">{ml.monthlyTokenLimit || '-'}</td>
                                    <td className="p-2">{ml.dailyInputTokenLimit || '-'}</td>
                                    <td className="p-2">{ml.dailyOutputTokenLimit || '-'}</td>
                                    <td className="p-2 text-right">
                                      <Button size="icon" variant="ghost" className="h-6 w-6 text-red-500 hover:text-red-600 hover:bg-red-500/10" onClick={async () => {
                                        await globalSettings.deleteModelLimit(ml.model, !!ml.isPattern);
                                        const r = await globalSettings.getModelLimits(); setGlobalModelLimits(r.data || []);
                                      }}><Trash2 className="h-4 w-4" /></Button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground text-center py-4 border rounded-md">No model limits configured.</p>
                        )}
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
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

          <div className="pt-2 border-t border-border/50 space-y-3">
            <div>
              <Label className="text-base">Model Monitor Auto Mode</Label>
              <p className="text-xs text-muted-foreground mt-1">
                Controls whether 10-min probes can publish Online/Offline to Discord &amp; client catalogs.
                Default is Notif only (manual ON/OFF publishes; probes only notify admin).
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  { id: "off" as const, label: "Off", desc: "No auto 10-min test" },
                  { id: "notif_only" as const, label: "Notif only", desc: "Probe notifies admin; catalog = manual" },
                  { id: "auto" as const, label: "On (auto)", desc: "Probe auto publishes ON/OFF" },
                ]
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setMonitorAutoMode(opt.id)}
                  className={`px-3 py-2 rounded-lg border text-left min-w-[140px] transition-colors ${
                    monitorAutoMode === opt.id
                      ? "border-violet-500 bg-violet-500/10 text-foreground"
                      : "border-border/50 hover:bg-accent/40 text-muted-foreground"
                  }`}
                >
                  <div className="text-sm font-medium text-foreground">{opt.label}</div>
                  <div className="text-[10px] mt-0.5">{opt.desc}</div>
                </button>
              ))}
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
