import { useEffect, useState } from "react";
import { settings, logs } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, Save, Trash2, AlertTriangle, X, Pencil } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter, DialogTrigger
} from "@/components/ui/dialog";

import { useRealtime } from "@/lib/realtime-context";
import { ProvidersManager } from "@/components/ProvidersManager";
import { useNotify } from "@/components/Notify";
import { globalSettings, request, type ModelLimitEntry } from "@/lib/api";
import { Switch } from "@/components/ui/switch";
import { TokenSaverAdminPanel } from "@/components/TokenSaverAdminPanel";

function bareModelId(id: string): string {
  const s = String(id || "");
  return s.includes("/") ? s.slice(s.lastIndexOf("/") + 1) : s;
}

/** True if model id matches any addon_required pattern (exact / bare / substring). */
function isLockedByPatterns(modelId: string, patterns: string[]): boolean {
  if (!patterns.length) return false;
  const lower = modelId.toLowerCase();
  const bare = bareModelId(modelId).toLowerCase();
  return patterns.some((p) => {
    const pl = String(p || "").toLowerCase().trim();
    if (!pl) return false;
    return lower === pl || bare === pl || lower.includes(pl) || bare.includes(pl);
  });
}

export default function SettingsPage() {
  const notify = useNotify();
  const { realtimeEnabled, setRealtimeEnabled } = useRealtime();
  const [globalMaxDevices, setGlobalMaxDevices] = useState(0);
  const [globalPromptLimit, setGlobalPromptLimit] = useState(50);
  const [globalPromptLimitWindow, setGlobalPromptLimitWindow] = useState("5h");
  const [globalRateLimit, setGlobalRateLimit] = useState(1000);
  const [globalRateLimitWindow, setGlobalRateLimitWindow] = useState("5h");
  const [tokenLimitWeightPercent, setTokenLimitWeightPercent] = useState(100);
  const [tokenLimitWeightMode, setTokenLimitWeightMode] = useState<
    "first_rest_flat" | "flat_all" | "peak" | "full" | "custom"
  >("first_rest_flat");
  const [tokenLimitWeightCustom, setTokenLimitWeightCustom] = useState<
    { fromHop: number; toHop: number; percent: number }[]
  >([]);
  const [addonRequiredModels, setAddonRequiredModels] = useState<string[]>([]);
  const [addonRequiredDraft, setAddonRequiredDraft] = useState("");
  const [globalPerModelPromptLimit, setGlobalPerModelPromptLimit] = useState(3);
  const [globalPerModelPromptLimitWindow, setGlobalPerModelPromptLimitWindow] = useState("5h");
  const [globalDailyTokenLimit, setGlobalDailyTokenLimit] = useState(0);
  const [globalMonthlyTokenLimit, setGlobalMonthlyTokenLimit] = useState(0);
  const [globalDailyInputTokenLimit, setGlobalDailyInputTokenLimit] = useState(0);
  const [globalDailyOutputTokenLimit, setGlobalDailyOutputTokenLimit] = useState(0);
  const [tokenSaverRtkEnabled, setTokenSaverRtkEnabled] = useState(true);
  const [tokenInputMode, setTokenInputMode] = useState<"per_turn_peak" | "full" | "billable">("per_turn_peak");
  const [tokenSaverRtkMaxChars, setTokenSaverRtkMaxChars] = useState(2000);
  const [tokenSaverRtkMode, setTokenSaverRtkMode] = useState("preset");
  const [tokenSaverRtkLevel, setTokenSaverRtkLevel] = useState("balanced");
  const [tokenSaverRtkCustom, setTokenSaverRtkCustom] = useState("{}");
  const [tokenSaverHeadroomEnabled, setTokenSaverHeadroomEnabled] = useState(false);
  const [tokenSaverHeadroomUrl, setTokenSaverHeadroomUrl] = useState("");
  const [tokenSaverHeadroomMode, setTokenSaverHeadroomMode] = useState("preset");
  const [tokenSaverHeadroomLevel, setTokenSaverHeadroomLevel] = useState("balanced");
  const [tokenSaverHeadroomCustom, setTokenSaverHeadroomCustom] = useState("{}");
  const [tokenSaverCavemanEnabled, setTokenSaverCavemanEnabled] = useState(false);
  const [tokenSaverCavemanLevel, setTokenSaverCavemanLevel] = useState(2);
  const [tokenSaverCavemanMode, setTokenSaverCavemanMode] = useState("preset");
  const [tokenSaverCavemanCustom, setTokenSaverCavemanCustom] = useState("{}");
  const [tokenSaverPonytailEnabled, setTokenSaverPonytailEnabled] = useState(false);
  const [tokenSaverPonytailLevel, setTokenSaverPonytailLevel] = useState("lite");
  const [tokenSaverPonytailMode, setTokenSaverPonytailMode] = useState("preset");
  const [tokenSaverPonytailCustom, setTokenSaverPonytailCustom] = useState("{}");
  const [tokenSaverGroupyCompactEnabled, setTokenSaverGroupyCompactEnabled] = useState(true);
  const [tokenSaverGroupyCompactLevel, setTokenSaverGroupyCompactLevel] = useState("balanced");
  const [tokenSaverGroupyCompactMode, setTokenSaverGroupyCompactMode] = useState("preset");
  const [tokenSaverGroupyCompactCustom, setTokenSaverGroupyCompactCustom] = useState("{}");
  const [tokenSaverBatchEnabled, setTokenSaverBatchEnabled] = useState(true);
  const [tokenSaverBatchMode, setTokenSaverBatchMode] = useState("preset");
  const [tokenSaverBatchLevel, setTokenSaverBatchLevel] = useState("balanced");
  const [tokenSaverBatchCustom, setTokenSaverBatchCustom] = useState("{}");
  const [tokenSaverAntiWasteEnabled, setTokenSaverAntiWasteEnabled] = useState(true);
  const [tokenSaverAntiWasteMode, setTokenSaverAntiWasteMode] = useState("preset");
  const [tokenSaverAntiWasteLevel, setTokenSaverAntiWasteLevel] = useState("balanced");
  const [tokenSaverAntiWasteCustom, setTokenSaverAntiWasteCustom] = useState("{}");
  const [tokenSaverStreamToNonstreamEnabled, setTokenSaverStreamToNonstreamEnabled] = useState(false);
  const [tokenSaverNonstreamToStreamEnabled, setTokenSaverNonstreamToStreamEnabled] = useState(false);
  const [globalModelLimits, setGlobalModelLimits] = useState<ModelLimitEntry[]>([]);
  const [modelCatalog, setModelCatalog] = useState<string[]>([]);
  const [newModelOverride, setNewModelOverride] = useState("");
  const [newModelOverrideIsPattern, setNewModelOverrideIsPattern] = useState(false);
  const [globalModelMatchPreview, setGlobalModelMatchPreview] = useState<{ ids: string[]; total: number }>({ ids: [], total: 0 });
  /** When on: matched models can be locked (addon-only) via per-row checkboxes. */
  const [matchLockEnabled, setMatchLockEnabled] = useState(false);
  const [matchLockedIds, setMatchLockedIds] = useState<string[]>([]);
  const [newModelOverrideLimit, setNewModelOverrideLimit] = useState(0);
  const [newModelOverrideDailyTokenLimit, setNewModelOverrideDailyTokenLimit] = useState(0);
  const [newModelOverrideMonthlyTokenLimit, setNewModelOverrideMonthlyTokenLimit] = useState(0);
  const [newModelOverrideDailyInputTokenLimit, setNewModelOverrideDailyInputTokenLimit] = useState(0);
  const [newModelOverrideDailyOutputTokenLimit, setNewModelOverrideDailyOutputTokenLimit] = useState(0);
  const [newModelOverrideDedicatedQuota, setNewModelOverrideDedicatedQuota] = useState(false);
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
  const [proRoleId, setProRoleId] = useState("1354682701453725857");
  const [trialRequiredRoleId, setTrialRequiredRoleId] = useState("1354682641961582632");
  const [contributorRoleId, setContributorRoleId] = useState("1354642624895778866");
  const [troubleshooterRoleId, setTroubleshooterRoleId] = useState("1354683007427936366");
  const [moderatorRoleId, setModeratorRoleId] = useState("1354683043478110309");
  const [roleLimitModes, setRoleLimitModes] = useState<Record<string, string>>({
    premium: "zero_unless_addon",
    pro: "zero_unless_addon",
    phantom: "follow_global",
    contributor: "follow_global",
    troubleshooter: "follow_global",
    moderator: "follow_global",
  });
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
      setRequiredRoleId(b.requiredRoleId || "1354646304042651728");
      setOwnerGroupyRoleId(b.ownerGroupyRoleId || "");
      setVerifiedRoleId(b.verifiedRoleId || "");
      setProRoleId((b as any).proRoleId || "1354682701453725857");
      setTrialRequiredRoleId((b as any).trialRequiredRoleId || "1354682641961582632");
      setContributorRoleId((b as any).contributorRoleId || "1354642624895778866");
      setTroubleshooterRoleId((b as any).troubleshooterRoleId || "1354683007427936366");
      setModeratorRoleId((b as any).moderatorRoleId || "1354683043478110309");
      const modes = (b as any).roleLimitModes || {};
      setRoleLimitModes({
        premium: modes.premium || "zero_unless_addon",
        pro: modes.pro || "zero_unless_addon",
        phantom: modes.phantom || "follow_global",
        contributor: modes.contributor || "follow_global",
        troubleshooter: modes.troubleshooter || "follow_global",
        moderator: modes.moderator || "follow_global",
      });
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
        typeof g.tokenLimitWeightPercent === "number" ? g.tokenLimitWeightPercent : 100,
      );
      const wm = String(g.tokenLimitWeightMode || "first_rest_flat");
      setTokenLimitWeightMode(
        wm === "flat_all" || wm === "peak" || wm === "full" || wm === "custom"
          ? wm
          : "first_rest_flat",
      );
      setTokenLimitWeightCustom(
        Array.isArray(g.tokenLimitWeightCustom)
          ? g.tokenLimitWeightCustom.map((r: any) => ({
              fromHop: Number(r.fromHop) || 1,
              toHop: Number(r.toHop) || 1,
              percent: Number(r.percent) || 0,
            }))
          : [],
      );
      setAddonRequiredModels(Array.isArray(g.addonRequiredModels) ? g.addonRequiredModels : []);
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
      setTokenSaverRtkMode(g.tokenSaverRtkMode || "preset");
      setTokenSaverRtkLevel(g.tokenSaverRtkLevel || "balanced");
      setTokenSaverRtkCustom(g.tokenSaverRtkCustom || "{}");
      setTokenSaverHeadroomEnabled(g.tokenSaverHeadroomEnabled ?? false);
      setTokenSaverHeadroomUrl(g.tokenSaverHeadroomUrl || "");
      setTokenSaverHeadroomMode(g.tokenSaverHeadroomMode || "preset");
      setTokenSaverHeadroomLevel(g.tokenSaverHeadroomLevel || "balanced");
      setTokenSaverHeadroomCustom(g.tokenSaverHeadroomCustom || "{}");
      setTokenSaverCavemanEnabled(g.tokenSaverCavemanEnabled ?? false);
      setTokenSaverCavemanLevel(g.tokenSaverCavemanLevel ?? 2);
      setTokenSaverCavemanMode(g.tokenSaverCavemanMode || "preset");
      setTokenSaverCavemanCustom(g.tokenSaverCavemanCustom || "{}");
      setTokenSaverPonytailEnabled(g.tokenSaverPonytailEnabled ?? false);
      setTokenSaverPonytailLevel(g.tokenSaverPonytailLevel || "lite");
      setTokenSaverPonytailMode(g.tokenSaverPonytailMode || "preset");
      setTokenSaverPonytailCustom(g.tokenSaverPonytailCustom || "{}");
      setTokenSaverGroupyCompactEnabled(g.tokenSaverGroupyCompactEnabled ?? true);
      setTokenSaverGroupyCompactLevel(g.tokenSaverGroupyCompactLevel || "balanced");
      setTokenSaverGroupyCompactMode(g.tokenSaverGroupyCompactMode || "preset");
      setTokenSaverGroupyCompactCustom(g.tokenSaverGroupyCompactCustom || "{}");
      setTokenSaverBatchEnabled(g.tokenSaverBatchEnabled ?? true);
      setTokenSaverBatchMode(g.tokenSaverBatchMode || "preset");
      setTokenSaverBatchLevel(g.tokenSaverBatchLevel || "balanced");
      setTokenSaverBatchCustom(g.tokenSaverBatchCustom || "{}");
      setTokenSaverAntiWasteEnabled(g.tokenSaverAntiWasteEnabled ?? true);
      setTokenSaverAntiWasteMode(g.tokenSaverAntiWasteMode || "preset");
      setTokenSaverAntiWasteLevel(g.tokenSaverAntiWasteLevel || "balanced");
      setTokenSaverAntiWasteCustom(g.tokenSaverAntiWasteCustom || "{}");
      setTokenSaverStreamToNonstreamEnabled(g.tokenSaverStreamToNonstreamEnabled ?? false);
      setTokenSaverNonstreamToStreamEnabled(g.tokenSaverNonstreamToStreamEnabled ?? false);
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

  const resetOverrideForm = () => {
    setNewModelOverride("");
    setNewModelOverrideIsPattern(false);
    setNewModelOverrideLimit(0);
    setNewModelOverrideDailyTokenLimit(0);
    setNewModelOverrideMonthlyTokenLimit(0);
    setNewModelOverrideDailyInputTokenLimit(0);
    setNewModelOverrideDailyOutputTokenLimit(0);
    setNewModelOverrideDedicatedQuota(false);
    setGlobalModelMatchPreview({ ids: [], total: 0 });
    setMatchLockEnabled(false);
    setMatchLockedIds([]);
  };

  const applyMatchPreview = (ids: string[], total: number, pattern: string, required: string[]) => {
    const capped = ids.slice(0, 200);
    setGlobalModelMatchPreview({ ids: capped, total });
    const already = capped.filter((id) => isLockedByPatterns(id, required));
    const patternLocked = isLockedByPatterns(pattern, required);
    if (already.length > 0 || patternLocked) {
      setMatchLockEnabled(true);
      setMatchLockedIds(already.length > 0 ? already : capped);
    } else {
      setMatchLockEnabled(false);
      setMatchLockedIds([]);
    }
  };

  /** Sync exact bare IDs for this match set into addon_required_models (drop covering pattern). */
  const syncAddonLocksForMatches = async (
    matchIds: string[],
    lockedIds: string[],
    pattern: string,
  ) => {
    const lockedSet = new Set(lockedIds);
    let next = addonRequiredModels.filter(
      (p) => p.toLowerCase() !== pattern.toLowerCase().trim(),
    );
    for (const id of matchIds) {
      const bare = bareModelId(id);
      next = next.filter((p) => p !== id && p !== bare);
      if (lockedSet.has(id)) next.push(bare);
    }
    next = Array.from(new Set(next.map((x) => x.trim()).filter(Boolean)));
    await globalSettings.update({ addonRequiredModels: next });
    setAddonRequiredModels(next);
    return next;
  };

  const startEditOverride = async (ml: ModelLimitEntry) => {
    setNewModelOverride(ml.model);
    setNewModelOverrideIsPattern(!!ml.isPattern);
    setNewModelOverrideLimit(ml.promptLimit || 0);
    setNewModelOverrideDailyTokenLimit(ml.dailyTokenLimit || 0);
    setNewModelOverrideMonthlyTokenLimit(ml.monthlyTokenLimit || 0);
    setNewModelOverrideDailyInputTokenLimit(ml.dailyInputTokenLimit || 0);
    setNewModelOverrideDailyOutputTokenLimit(ml.dailyOutputTokenLimit || 0);
    setNewModelOverrideDedicatedQuota(!!ml.dedicatedQuota);
    try {
      const r = await globalSettings.matchModelCatalog(ml.model);
      applyMatchPreview(r.data || [], r.total || 0, ml.model, addonRequiredModels);
    } catch {
      setGlobalModelMatchPreview({ ids: [], total: 0 });
      setMatchLockEnabled(isLockedByPatterns(ml.model, addonRequiredModels));
      setMatchLockedIds([]);
    }
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
        tokenLimitWeightMode,
        tokenLimitWeightCustom,
        addonRequiredModels,
        tokenSaverRtkEnabled, tokenSaverRtkMaxChars,
        tokenSaverRtkMode, tokenSaverRtkLevel, tokenSaverRtkCustom,
        tokenSaverHeadroomEnabled, tokenSaverHeadroomUrl,
        tokenSaverHeadroomMode, tokenSaverHeadroomLevel, tokenSaverHeadroomCustom,
        tokenSaverCavemanEnabled, tokenSaverCavemanLevel,
        tokenSaverCavemanMode, tokenSaverCavemanCustom,
        tokenSaverPonytailEnabled, tokenSaverPonytailLevel,
        tokenSaverPonytailMode, tokenSaverPonytailCustom,
        tokenSaverGroupyCompactEnabled, tokenSaverGroupyCompactLevel,
        tokenSaverGroupyCompactMode, tokenSaverGroupyCompactCustom,
        tokenSaverBatchEnabled, tokenSaverBatchMode, tokenSaverBatchLevel, tokenSaverBatchCustom,
        tokenSaverAntiWasteEnabled, tokenSaverAntiWasteMode, tokenSaverAntiWasteLevel, tokenSaverAntiWasteCustom,
        tokenSaverStreamToNonstreamEnabled, tokenSaverNonstreamToStreamEnabled,
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
          proRoleId,
          trialRequiredRoleId,
          contributorRoleId,
          troubleshooterRoleId,
          moderatorRoleId,
          roleLimitModes,
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
    <div className="space-y-8">
      {/* Header */}
      <div className="max-w-2xl">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">Configure your proxy gateway</p>
      </div>

      {/* Status Messages */}
      {message && (
        <div className="max-w-2xl text-sm text-emerald-400 bg-emerald-400/10 rounded-md px-4 py-3">
          {message}
        </div>
      )}
      {error && (
        <div className="max-w-2xl text-sm text-red-400 bg-red-400/10 rounded-md px-4 py-3">
          {error}
        </div>
      )}

      <ProvidersManager />

      <div className="space-y-8 max-w-2xl">
      {/* Token Saver — Groupy + classic */}
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-base">Token Saver</CardTitle>
          <CardDescription className="text-xs">
            See <code className="text-xs">docs/features/token_saver.md</code>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TokenSaverAdminPanel
            state={{
              tokenSaverAntiWasteEnabled,
              tokenSaverAntiWasteMode,
              tokenSaverAntiWasteLevel,
              tokenSaverAntiWasteCustom,
              tokenSaverGroupyCompactEnabled,
              tokenSaverGroupyCompactMode,
              tokenSaverGroupyCompactLevel,
              tokenSaverGroupyCompactCustom,
              tokenSaverBatchEnabled,
              tokenSaverBatchMode,
              tokenSaverBatchLevel,
              tokenSaverBatchCustom,
              tokenSaverStreamToNonstreamEnabled,
              tokenSaverNonstreamToStreamEnabled,
              tokenSaverRtkEnabled,
              tokenSaverRtkMode,
              tokenSaverRtkLevel,
              tokenSaverRtkCustom,
              tokenSaverRtkMaxChars,
              tokenSaverHeadroomEnabled,
              tokenSaverHeadroomUrl,
              tokenSaverHeadroomMode,
              tokenSaverHeadroomLevel,
              tokenSaverHeadroomCustom,
              tokenSaverCavemanEnabled,
              tokenSaverCavemanMode,
              tokenSaverCavemanLevel,
              tokenSaverCavemanCustom,
              tokenSaverPonytailEnabled,
              tokenSaverPonytailMode,
              tokenSaverPonytailLevel,
              tokenSaverPonytailCustom,
            }}
            set={(key, value) => {
              const map: Record<string, (v: any) => void> = {
                tokenSaverAntiWasteEnabled: setTokenSaverAntiWasteEnabled,
                tokenSaverAntiWasteMode: setTokenSaverAntiWasteMode,
                tokenSaverAntiWasteLevel: setTokenSaverAntiWasteLevel,
                tokenSaverAntiWasteCustom: setTokenSaverAntiWasteCustom,
                tokenSaverGroupyCompactEnabled: setTokenSaverGroupyCompactEnabled,
                tokenSaverGroupyCompactMode: setTokenSaverGroupyCompactMode,
                tokenSaverGroupyCompactLevel: setTokenSaverGroupyCompactLevel,
                tokenSaverGroupyCompactCustom: setTokenSaverGroupyCompactCustom,
                tokenSaverBatchEnabled: setTokenSaverBatchEnabled,
                tokenSaverBatchMode: setTokenSaverBatchMode,
                tokenSaverBatchLevel: setTokenSaverBatchLevel,
                tokenSaverBatchCustom: setTokenSaverBatchCustom,
                tokenSaverStreamToNonstreamEnabled: setTokenSaverStreamToNonstreamEnabled,
                tokenSaverNonstreamToStreamEnabled: setTokenSaverNonstreamToStreamEnabled,
                tokenSaverRtkEnabled: setTokenSaverRtkEnabled,
                tokenSaverRtkMode: setTokenSaverRtkMode,
                tokenSaverRtkLevel: setTokenSaverRtkLevel,
                tokenSaverRtkCustom: setTokenSaverRtkCustom,
                tokenSaverRtkMaxChars: setTokenSaverRtkMaxChars,
                tokenSaverHeadroomEnabled: setTokenSaverHeadroomEnabled,
                tokenSaverHeadroomUrl: setTokenSaverHeadroomUrl,
                tokenSaverHeadroomMode: setTokenSaverHeadroomMode,
                tokenSaverHeadroomLevel: setTokenSaverHeadroomLevel,
                tokenSaverHeadroomCustom: setTokenSaverHeadroomCustom,
                tokenSaverCavemanEnabled: setTokenSaverCavemanEnabled,
                tokenSaverCavemanMode: setTokenSaverCavemanMode,
                tokenSaverCavemanLevel: setTokenSaverCavemanLevel,
                tokenSaverCavemanCustom: setTokenSaverCavemanCustom,
                tokenSaverPonytailEnabled: setTokenSaverPonytailEnabled,
                tokenSaverPonytailMode: setTokenSaverPonytailMode,
                tokenSaverPonytailLevel: setTokenSaverPonytailLevel,
                tokenSaverPonytailCustom: setTokenSaverPonytailCustom,
              };
              map[key]?.(value);
            }}
          />
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
              <div className="grid grid-cols-1 gap-3">
                <div className="rounded-lg border border-border/50 p-3 space-y-3">
                  <div>
                    <Label>Token limit hop schedule (input)</Label>
                    <p className="text-[10px] text-muted-foreground leading-relaxed mt-1">
                      Controls daily/monthly <strong>input</strong> credit (gates + admin/client/Discord bars).
                      Output always 100%. Logs still store full tokens. Amanai-style full In stays admin-only.
                    </p>
                  </div>
                  <div>
                    <Label className="text-xs">Mode</Label>
                    <select
                      className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                      value={tokenLimitWeightMode}
                      onChange={(e) => {
                        const v = e.target.value;
                        setTokenLimitWeightMode(
                          v === "flat_all" || v === "peak" || v === "full" || v === "custom"
                            ? v
                            : "first_rest_flat",
                        );
                      }}
                    >
                      <option value="first_rest_flat">Hop 1 = 100%, later hops = flat % (recommended)</option>
                      <option value="flat_all">All hops = flat %</option>
                      <option value="peak">Peak only — MAX context once per prompt</option>
                      <option value="full">Full hop — 100% every hop (amanai-style limits)</option>
                      <option value="custom">Custom ranges (from–to hop → %)</option>
                    </select>
                  </div>
                  {(tokenLimitWeightMode === "first_rest_flat" || tokenLimitWeightMode === "flat_all") && (
                    <div>
                      <Label className="text-xs">Flat weight %</Label>
                      <Input
                        type="number"
                        value={tokenLimitWeightPercent}
                        onChange={(e) => setTokenLimitWeightPercent(parseInt(e.target.value) || 0)}
                        placeholder="100"
                        className="mt-1"
                        min={0}
                        max={100}
                      />
                      <p className="text-[10px] text-muted-foreground mt-1">
                        {tokenLimitWeightMode === "first_rest_flat"
                          ? `Hops 2+ use this % (current: ${tokenLimitWeightPercent}).`
                          : "Every hop (including hop 1) uses this %."}
                      </p>
                    </div>
                  )}
                  {tokenLimitWeightMode === "custom" && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs">Custom hop ranges</Label>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setTokenLimitWeightCustom((prev) => [
                              ...prev,
                              { fromHop: 1, toHop: 5, percent: 10 },
                            ])
                          }
                        >
                          Add range
                        </Button>
                      </div>
                      {tokenLimitWeightCustom.length === 0 && (
                        <p className="text-[10px] text-muted-foreground">No ranges — hops count as 0%.</p>
                      )}
                      {tokenLimitWeightCustom.map((row, idx) => (
                        <div key={idx} className="flex flex-wrap items-end gap-2">
                          <div>
                            <Label className="text-[10px]">From hop</Label>
                            <Input
                              type="number"
                              className="w-20 mt-0.5"
                              min={1}
                              value={row.fromHop}
                              onChange={(e) => {
                                const v = parseInt(e.target.value) || 1;
                                setTokenLimitWeightCustom((prev) =>
                                  prev.map((r, i) => (i === idx ? { ...r, fromHop: v } : r)),
                                );
                              }}
                            />
                          </div>
                          <div>
                            <Label className="text-[10px]">To hop</Label>
                            <Input
                              type="number"
                              className="w-20 mt-0.5"
                              min={1}
                              value={row.toHop}
                              onChange={(e) => {
                                const v = parseInt(e.target.value) || 1;
                                setTokenLimitWeightCustom((prev) =>
                                  prev.map((r, i) => (i === idx ? { ...r, toHop: v } : r)),
                                );
                              }}
                            />
                          </div>
                          <div>
                            <Label className="text-[10px]">%</Label>
                            <Input
                              type="number"
                              className="w-20 mt-0.5"
                              min={0}
                              max={100}
                              value={row.percent}
                              onChange={(e) => {
                                const v = parseInt(e.target.value) || 0;
                                setTokenLimitWeightCustom((prev) =>
                                  prev.map((r, i) => (i === idx ? { ...r, percent: v } : r)),
                                );
                              }}
                            />
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setTokenLimitWeightCustom((prev) => prev.filter((_, i) => i !== idx))
                            }
                          >
                            Remove
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="space-y-2 border border-border/50 rounded-lg p-3">
                <Label>Models requiring add-on</Label>
                <p className="text-[10px] text-muted-foreground">
                  Substring patterns that hard-lock without a pack. Empty = Phantom can use catalog models without add-on.
                  Non-addon tease caps come from Model Limit Overrides below
                  {globalModelLimits.filter((ml) => (ml.promptLimit || 0) > 0).length > 0
                    ? `: ${globalModelLimits
                        .filter((ml) => (ml.promptLimit || 0) > 0)
                        .map((ml) => `${ml.model} @ ${ml.promptLimit}`)
                        .join(", ")}`
                    : " (add pattern rows with prompt limit)."}
                  . Hard locks: patterns above in Models requiring add-on.
                </p>
                {addonRequiredModels.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {addonRequiredModels.map((pat) => (
                      <span
                        key={pat}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/15 text-primary font-mono text-[10px]"
                      >
                        {pat}
                        <button
                          type="button"
                          onClick={() =>
                            setAddonRequiredModels((prev) => prev.filter((x) => x !== pat))
                          }
                          aria-label={`Remove ${pat}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <Input
                    className="font-mono text-sm"
                    list="addon-required-suggestions"
                    placeholder="pattern (e.g. codex)"
                    value={addonRequiredDraft}
                    onChange={(e) => setAddonRequiredDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        const p = addonRequiredDraft.trim();
                        if (!p) return;
                        setAddonRequiredModels((prev) =>
                          prev.includes(p) ? prev : [...prev, p],
                        );
                        setAddonRequiredDraft("");
                      }
                    }}
                  />
                  <datalist id="addon-required-suggestions">
                    {modelCatalog.slice(0, 80).map((id) => (
                      <option key={id} value={id} />
                    ))}
                  </datalist>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const p = addonRequiredDraft.trim();
                      if (!p) return;
                      setAddonRequiredModels((prev) =>
                        prev.includes(p) ? prev : [...prev, p],
                      );
                      setAddonRequiredDraft("");
                    }}
                  >
                    Add
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Default Per-Model Prompt Limit</Label>
                  <Input
                    type="number"
                    value={globalPerModelPromptLimit}
                    onChange={(e) => setGlobalPerModelPromptLimit(parseInt(e.target.value) || 0)}
                    placeholder="3"
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
                  <p className="text-xs text-muted-foreground mt-1">
                    Phantom non-addon: set <strong>0 = Unlimited</strong> (Daily Total).
                    Nilai &gt;0 hanya dipakai sebagai base stack kalau user punya add-on.
                  </p>
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
                  <Label>Input token mode (stats / Discord only)</Label>
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
                    <option value="per_turn_peak">Per-turn peak — MAX context once per prompt (tables/Discord)</option>
                    <option value="full">Full hop sum — match upstream In / amanai (tables/Discord)</option>
                    <option value="billable">Billable / delta only (legacy tables/Discord)</option>
                  </select>
                  <p className="text-xs text-muted-foreground mt-1">
                    Does <strong>not</strong> change daily/monthly token limits. Limits use hop-weighted input
                    (hop 1 = 100%, hops 2+ = flat % from schedule above; default flat 100%; output always 100%).
                    Peak/full/billable only changes how input is shown in analytics, Discord, and Key Detail.
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
                      Pattern rows with prompt limit share one family quota (values from table below).
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
                          Prompt/token overrides per model atau pattern. Bisa Edit dari tabel.
                          Centang &quot;Lock matched models&quot; untuk pilih model yang wajib add-on (Select all / satu-satu).
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
                                  setMatchLockEnabled(false);
                                  setMatchLockedIds([]);
                                  return;
                                }
                                try {
                                  const r = await globalSettings.matchModelCatalog(v);
                                  if (!existing) {
                                    if (r.total >= 2) setNewModelOverrideIsPattern(true);
                                    else if (r.total === 1) setNewModelOverrideIsPattern(false);
                                  }
                                  applyMatchPreview(r.data || [], r.total || 0, v, addonRequiredModels);
                                } catch {
                                  setGlobalModelMatchPreview({ ids: [], total: 0 });
                                  setMatchLockedIds([]);
                                }
                              }, 300);
                              if (existing) {
                                setNewModelOverrideLimit(existing.promptLimit || 0);
                                setNewModelOverrideDailyTokenLimit(existing.dailyTokenLimit || 0);
                                setNewModelOverrideMonthlyTokenLimit(existing.monthlyTokenLimit || 0);
                                setNewModelOverrideDailyInputTokenLimit(existing.dailyInputTokenLimit || 0);
                                setNewModelOverrideDailyOutputTokenLimit(existing.dailyOutputTokenLimit || 0);
                                setNewModelOverrideIsPattern(!!existing.isPattern);
                                setNewModelOverrideDedicatedQuota(!!existing.dedicatedQuota);
                              } else {
                                setNewModelOverrideLimit(0);
                                setNewModelOverrideDailyTokenLimit(0);
                                setNewModelOverrideMonthlyTokenLimit(0);
                                setNewModelOverrideDailyInputTokenLimit(0);
                                setNewModelOverrideDailyOutputTokenLimit(0);
                                setNewModelOverrideDedicatedQuota(false);
                              }
                            }}
                          />
                          {newModelOverride.length > 0 && (
                            <div className="mt-1 space-y-2 text-xs text-muted-foreground">
                              {newModelOverrideIsPattern ? (
                                <div>
                                  Pattern limit apply ke <b>{globalModelMatchPreview.total}</b> model yang mengandung{" "}
                                  <span className="font-mono">"{newModelOverride}"</span>
                                  {globalModelMatchPreview.total === 0 && (
                                    <div className="text-amber-600 dark:text-amber-400 mt-1">
                                      Belum ada model di catalog yang cocok. Pattern tetap tersimpan untuk model baru.
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <div>
                                  {globalModelMatchPreview.total > 0
                                    ? `Cocok ${globalModelMatchPreview.total} model di catalog`
                                    : "Tidak ada model di catalog yang cocok (entry exact tetap bisa disimpan)"}
                                </div>
                              )}

                              {globalModelMatchPreview.ids.length > 0 && (
                                <div className="space-y-2 border rounded-md p-2 bg-background/50">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <label className="inline-flex items-center gap-1.5 cursor-pointer text-foreground">
                                      <input
                                        type="checkbox"
                                        checked={matchLockEnabled}
                                        onChange={(e) => {
                                          const on = e.target.checked;
                                          setMatchLockEnabled(on);
                                          setMatchLockedIds(on ? [...globalModelMatchPreview.ids] : []);
                                        }}
                                      />
                                      <span className="text-xs font-medium">
                                        Lock matched models (addon only)
                                      </span>
                                    </label>
                                    {matchLockEnabled && (
                                      <>
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="sm"
                                          className="h-6 text-[10px]"
                                          onClick={() => setMatchLockedIds([...globalModelMatchPreview.ids])}
                                        >
                                          Select all
                                        </Button>
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="sm"
                                          className="h-6 text-[10px]"
                                          onClick={() => setMatchLockedIds([])}
                                        >
                                          Clear locks
                                        </Button>
                                        <span className="text-[10px] text-muted-foreground">
                                          {matchLockedIds.length}/{globalModelMatchPreview.ids.length} locked
                                        </span>
                                      </>
                                    )}
                                  </div>
                                  <p className="text-[10px] text-muted-foreground">
                                    {matchLockEnabled
                                      ? "Ceklis model yang wajib add-on. Uncek = Phantom bisa pakai tanpa pack. Disimpan ke Models requiring add-on (exact id)."
                                      : "Centang \"Lock matched models\" lalu pilih satu-satu atau Select all."}
                                  </p>
                                  <div className="max-h-40 overflow-y-auto divide-y divide-border/40 border rounded bg-background/40">
                                    {globalModelMatchPreview.ids.map((m) => {
                                      const locked = matchLockedIds.includes(m);
                                      return (
                                        <label
                                          key={m}
                                          className={`flex items-center gap-2 px-2 py-1.5 font-mono text-[10px] cursor-pointer hover:bg-accent/40 ${
                                            matchLockEnabled && locked
                                              ? "text-amber-700 dark:text-amber-300"
                                              : "text-foreground"
                                          }`}
                                        >
                                          <input
                                            type="checkbox"
                                            disabled={!matchLockEnabled}
                                            checked={matchLockEnabled && locked}
                                            onChange={() => {
                                              setMatchLockedIds((prev) =>
                                                prev.includes(m)
                                                  ? prev.filter((x) => x !== m)
                                                  : [...prev, m],
                                              );
                                            }}
                                          />
                                          <span className="truncate flex-1">{m}</span>
                                          {matchLockEnabled && locked && (
                                            <span className="shrink-0 text-[9px] uppercase tracking-wide text-amber-600 dark:text-amber-400">
                                              lock
                                            </span>
                                          )}
                                        </label>
                                      );
                                    })}
                                  </div>
                                  {globalModelMatchPreview.total > globalModelMatchPreview.ids.length && (
                                    <p className="text-[10px] text-muted-foreground">
                                      Menampilkan {globalModelMatchPreview.ids.length} / {globalModelMatchPreview.total}{" "}
                                      match (sisanya tetap kena pattern limit jika pattern ON).
                                    </p>
                                  )}
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
                        <div className="col-span-2 md:col-span-3">
                          <label className="inline-flex items-start gap-2 cursor-pointer text-xs">
                            <input
                              type="checkbox"
                              className="mt-0.5"
                              checked={newModelOverrideDedicatedQuota}
                              onChange={(e) => setNewModelOverrideDedicatedQuota(e.target.checked)}
                            />
                            <span>
                              <b>Dedicated pool</b> — outside account daily / input / output (requires Daily Token Limit &gt; 0)
                            </span>
                          </label>
                        </div>
                        <div className="col-span-2 md:col-span-3 flex flex-wrap items-center justify-end gap-2">
                          {newModelOverrideIsPattern && globalModelMatchPreview.total > 0 && (
                            <Button
                              variant="outline"
                              disabled={loading}
                              onClick={async () => {
                                if (!newModelOverride) return;
                                if (!(await notify.confirm({
                                  title: "Buat exact entries?",
                                  message: `Buat ${globalModelMatchPreview.total} entry exact untuk semua model yang cocok?`,
                                  confirmLabel: "Buat",
                                }))) return;
                                setLoading(true);
                                try {
                                  const limits = {
                                    promptLimit: newModelOverrideLimit,
                                    dailyTokenLimit: newModelOverrideDailyTokenLimit,
                                    monthlyTokenLimit: newModelOverrideMonthlyTokenLimit,
                                    dailyInputTokenLimit: newModelOverrideDailyInputTokenLimit,
                                    dailyOutputTokenLimit: newModelOverrideDailyOutputTokenLimit,
                                    dedicatedQuota: newModelOverrideDedicatedQuota,
                                  };
                                  for (const m of globalModelMatchPreview.ids) {
                                    const bare = bareModelId(m);
                                    await globalSettings.setModelLimit(bare, { ...limits, isPattern: false });
                                  }
                                  if (matchLockEnabled || matchLockedIds.length > 0 || globalModelMatchPreview.ids.some((id) => isLockedByPatterns(id, addonRequiredModels))) {
                                    await syncAddonLocksForMatches(
                                      globalModelMatchPreview.ids,
                                      matchLockEnabled ? matchLockedIds : [],
                                      newModelOverride,
                                    );
                                  }
                                  setMessage(`Berhasil apply ke ${globalModelMatchPreview.ids.length} model exact${matchLockEnabled ? ` · ${matchLockedIds.length} locked` : ""}.`);
                                } catch (e: any) {
                                  setError(`Gagal bulk apply: ${e?.message || e}`);
                                } finally {
                                  setLoading(false);
                                }
                                resetOverrideForm();
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
                                  dedicatedQuota: newModelOverrideDedicatedQuota,
                                });
                                if (
                                  globalModelMatchPreview.ids.length > 0 &&
                                  (matchLockEnabled ||
                                    matchLockedIds.length > 0 ||
                                    globalModelMatchPreview.ids.some((id) =>
                                      isLockedByPatterns(id, addonRequiredModels),
                                    ))
                                ) {
                                  await syncAddonLocksForMatches(
                                    globalModelMatchPreview.ids,
                                    matchLockEnabled ? matchLockedIds : [],
                                    newModelOverride,
                                  );
                                }
                                if (newModelOverrideIsPattern) {
                                  setMessage(
                                    `Pattern "${newModelOverride}" tersimpan (${globalModelMatchPreview.total} model)${matchLockEnabled ? ` · ${matchLockedIds.length} locked add-on` : ""}.`,
                                  );
                                } else {
                                  setMessage(
                                    `Model override untuk "${newModelOverride}" tersimpan${matchLockEnabled && matchLockedIds.length ? " · locked" : ""}.`,
                                  );
                                }
                              } catch (e: any) {
                                setError(`Gagal simpan: ${e?.message || e}`);
                              } finally {
                                setLoading(false);
                              }
                              resetOverrideForm();
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
                                  <th className="p-2 font-medium">Addon lock</th>
                                  <th className="p-2"></th>
                                </tr>
                              </thead>
                              <tbody className="divide-y">
                                {globalModelLimits.map(ml => {
                                  const rowLocked = isLockedByPatterns(ml.model, addonRequiredModels)
                                    || (ml.matchedIds || []).some((id) => isLockedByPatterns(id, addonRequiredModels));
                                  const lockedCount = (ml.matchedIds || []).filter((id) =>
                                    isLockedByPatterns(id, addonRequiredModels),
                                  ).length;
                                  return (
                                  <tr key={ml.id} className="hover:bg-muted/50 align-top">
                                    <td className="p-2 font-mono">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span>{ml.model}</span>
                                        {ml.isPattern && (
                                          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide bg-amber-500/15 text-amber-600 dark:text-amber-400">
                                            PATTERN
                                          </span>
                                        )}
                                        {ml.dedicatedQuota && (
                                          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide bg-sky-500/15 text-sky-600 dark:text-sky-400">
                                            DEDICATED
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
                                            <span
                                              key={m}
                                              className={`px-1.5 py-0.5 rounded font-mono text-[10px] ${
                                                isLockedByPatterns(m, addonRequiredModels)
                                                  ? "bg-amber-500/20 text-amber-700 dark:text-amber-300"
                                                  : "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                                              }`}
                                            >
                                              {m}{isLockedByPatterns(m, addonRequiredModels) ? " 🔒" : ""}
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
                                    <td className="p-2 text-[10px]">
                                      {rowLocked ? (
                                        <span className="text-amber-600 dark:text-amber-400 font-medium">
                                          {ml.isPattern && lockedCount > 0
                                            ? `${lockedCount} locked`
                                            : "locked"}
                                        </span>
                                      ) : (
                                        <span className="text-muted-foreground">open</span>
                                      )}
                                    </td>
                                    <td className="p-2 text-right whitespace-nowrap">
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-6 w-6"
                                        title="Edit"
                                        onClick={() => void startEditOverride(ml)}
                                      >
                                        <Pencil className="h-3.5 w-3.5" />
                                      </Button>
                                      <Button size="icon" variant="ghost" className="h-6 w-6 text-red-500 hover:text-red-600 hover:bg-red-500/10" onClick={async () => {
                                        await globalSettings.deleteModelLimit(ml.model, !!ml.isPattern);
                                        const r = await globalSettings.getModelLimits(); setGlobalModelLimits(r.data || []);
                                      }}><Trash2 className="h-4 w-4" /></Button>
                                    </td>
                                  </tr>
                                  );
                                })}
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
            <div className="md:col-span-2 pt-2 border-t border-border/50">
              <Label className="text-base">Discord roles (proxy)</Label>
              <p className="text-[10px] text-muted-foreground mt-0.5 mb-3">
                Staff (mod/troubleshooter/contributor) above Phantom/Pro/Premium for limits. Premium/Pro default: 0 until add-on.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label>Premium</Label>
                  <Input value={trialRequiredRoleId} onChange={(e) => setTrialRequiredRoleId(e.target.value)} placeholder="1354682641961582632" className="mt-1 font-mono text-xs" />
                </div>
                <div>
                  <Label>Pro</Label>
                  <Input value={proRoleId} onChange={(e) => setProRoleId(e.target.value)} placeholder="1354682701453725857" className="mt-1 font-mono text-xs" />
                </div>
                <div>
                  <Label>Phantom</Label>
                  <Input value={requiredRoleId} onChange={(e) => setRequiredRoleId(e.target.value)} placeholder="1354646304042651728" className="mt-1 font-mono text-xs" />
                </div>
                <div>
                  <Label>Contributor</Label>
                  <Input value={contributorRoleId} onChange={(e) => setContributorRoleId(e.target.value)} placeholder="1354642624895778866" className="mt-1 font-mono text-xs" />
                </div>
                <div>
                  <Label>Troubleshooter</Label>
                  <Input value={troubleshooterRoleId} onChange={(e) => setTroubleshooterRoleId(e.target.value)} placeholder="1354683007427936366" className="mt-1 font-mono text-xs" />
                </div>
                <div>
                  <Label>Moderator</Label>
                  <Input value={moderatorRoleId} onChange={(e) => setModeratorRoleId(e.target.value)} placeholder="1354683043478110309" className="mt-1 font-mono text-xs" />
                </div>
              </div>
              <div className="mt-4 space-y-2">
                <Label className="text-sm">Role limit modes</Label>
                <p className="text-[10px] text-muted-foreground">follow_global = inherit Settings daily · zero_unless_addon = no shared/dedicated until add-on</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {(["premium", "pro", "phantom", "contributor", "troubleshooter", "moderator"] as const).map((role) => (
                    <div key={role}>
                      <Label className="capitalize text-xs">{role}</Label>
                      <select
                        className="mt-1 w-full h-9 rounded-md border border-input bg-background px-2 text-xs"
                        value={roleLimitModes[role] || "follow_global"}
                        onChange={(e) =>
                          setRoleLimitModes((prev) => ({ ...prev, [role]: e.target.value }))
                        }
                      >
                        <option value="follow_global">follow_global</option>
                        <option value="zero_unless_addon">zero_unless_addon</option>
                      </select>
                    </div>
                  ))}
                </div>
              </div>
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
                Scheduled every 10 minutes. <span className="text-foreground font-medium">Off</span> = no
                auto probes (no scheduled credit burn). Dashboard <span className="text-foreground font-medium">Test All</span> still
                works manually (probe only; does not flip Published).{" "}
                <span className="text-foreground font-medium">Notif only / On</span> still POST test
                chat/completions each cycle — that burns provider credits.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  { id: "off" as const, label: "Off", desc: "No scheduled probe — Test All still manual" },
                  { id: "notif_only" as const, label: "Notif only", desc: "STILL probes every 10m (burns credits); heal Online on OK; fail keeps catalog" },
                  { id: "auto" as const, label: "On (auto)", desc: "Probes every 10m + auto publish ON/OFF" },
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
      </div>
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
