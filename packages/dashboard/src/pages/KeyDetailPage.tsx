import { Fragment, useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { keys, logs, stats, trialSettings, type ApiKeyDetail, type KeyPeriodStats, type LogEntry, type SessionDetailResponse, type ModelLimitEntry, type TrialUserRow, globalSettings } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate, formatNumber, formatRelativeTime, copyToClipboard, formatCost, formatInputBreakdown, statusLabel, statusDetail, formatChartPeriod } from "@/lib/utils";
import { ArrowLeft, Copy, Check, RotateCw, Trash2, Shield, ShieldOff, X, Download, DollarSign, Gift, Info, ExternalLink, CalendarClock, ChevronDown, ChevronRight } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter, DialogTrigger
} from "@/components/ui/dialog";
import { useRealtimeSSE } from "@/lib/use-realtime-sse";
import { exportXlsx, buildLogsSection, buildSessionsSection, fmtCost } from "@/lib/export-xlsx";
import { LiveUsageCard } from "@/components/LiveUsageCard";
import { DayOverrideDialog } from "@/components/DayOverrideDialog";
import { useNotify } from "@/components/Notify";
import { PeriodSelector, type PeriodKey } from "@/components/PeriodSelector";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, 
} from "recharts";
import { ChartBox } from "@/components/ChartBox";

const TOOLTIP_STYLE  = { backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "12px", color: "hsl(var(--foreground))" };
const ITEM_STYLE     = { color: "hsl(var(--foreground))" };
const LABEL_STYLE    = { color: "hsl(var(--foreground))" };
const MODEL_COLORS   = ["#818cf8", "#34d399", "#f59e0b", "#f87171", "#a78bfa", "#38bdf8", "#fb923c", "#e879f9"];
const KEY_CHART_DAYS: Record<PeriodKey, number> = {
  today: 1, "3d": 3, "7d": 7, "30d": 30, thisMonth: 62, lastMonth: 62, allTime: 90,
};

export default function KeyDetailPage() {
  const { id: idSlug } = useParams<{ id: string }>();
  // Slug format is "{numericId}-{name-slug}" ? extract just the numeric ID prefix
  const id = idSlug?.split("-")[0] ?? "";
  const navigate = useNavigate();
  const [keyData, setKeyData] = useState<ApiKeyDetail | null>(null);
  const [deviceList, setDeviceList] = useState<any[]>([]);
  const [keyLogs, setKeyLogs] = useState<LogEntry[]>([]);
  const [keyLogsLoading, setKeyLogsLoading] = useState(false);
  const [keyLogsError, setKeyLogsError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editMaxDevices, setEditMaxDevices] = useState(0);
  const [editDevicePolicy, setEditDevicePolicy] = useState("none");
  const [editIpPolicy, setEditIpPolicy] = useState("none");
  const [editIdePolicy, setEditIdePolicy] = useState("none");
  const [editMonthlyLimit, setEditMonthlyLimit] = useState(0);
  const [editDailyTokenLimit, setEditDailyTokenLimit] = useState(0);
  const [editDailyInputTokenLimit, setEditDailyInputTokenLimit] = useState(0);
  const [editDailyOutputTokenLimit, setEditDailyOutputTokenLimit] = useState(0);
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showRotate, setShowRotate] = useState(false);
  const [showDayOverride, setShowDayOverride] = useState(false);
  const notify = useNotify();
  const [rotatedKey, setRotatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [statusText, setStatusText] = useState<string>("");
  const [accessTargetType, setAccessTargetType] = useState<"fingerprint" | "ip">("fingerprint");
  const [accessListType, setAccessListType] = useState<"allow" | "block">("allow");
  const [accessValue, setAccessValue] = useState("");
  const [accessLabel, setAccessLabel] = useState("");
  const [ideRuleType, setIdeRuleType] = useState<"allow" | "block">("allow");
  const [ideRuleValue, setIdeRuleValue] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState<string>("");
  const [selectedSessionDetail, setSelectedSessionDetail] = useState<SessionDetailResponse | null>(null);
  const [sessionDetailLoading, setSessionDetailLoading] = useState(false);

  // Stats period filter
  type StatsPeriod = "today" | "week" | "month" | "allTime";
  const [statsPeriod, setStatsPeriod] = useState<StatsPeriod>("allTime");
  const PERIOD_LABELS: Record<StatsPeriod, string> = { today: "Today", week: "Last 7 Days", month: "Last 30 Days", allTime: "All Time" };

  // Logs period filter
  const [logsPeriod, setLogsPeriod] = useState<1 | 7 | 30 | 0>(0); // 0 = all
  const [expandedLogId, setExpandedLogId] = useState<number | null>(null);

  // Per-key overview charts (same metrics as admin Overview)
  const [chartPeriod, setChartPeriod] = useState<PeriodKey>("7d");
  const [chartMetric, setChartMetric] = useState<"prompts" | "apiCalls">("prompts");
  const [keyTimeseries, setKeyTimeseries] = useState<any[]>([]);
  const [keyChartModels, setKeyChartModels] = useState<any[]>([]);
  const [chartsLoading, setChartsLoading] = useState(false);

  // Models tab state
  const [modelTabDays, setModelTabDays] = useState(0); // 0 = all time
  const [modelTabData, setModelTabData] = useState<any[]>([]);
  const [modelTabSort, setModelTabSort] = useState<"tokens" | "requests">("tokens");
  const [modelTabLoading, setModelTabLoading] = useState(false);

  // Per-key model limits state
  const [keyModelLimits, setKeyModelLimits] = useState<ModelLimitEntry[]>([]);
  const [keyModelCatalog, setKeyModelCatalog] = useState<string[]>([]);
  const [newKeyModelOverride, setNewKeyModelOverride] = useState("");
  const [newKeyModelOverrideIsPattern, setNewKeyModelOverrideIsPattern] = useState(false);
  const [newKeyModelOverrideLimit, setNewKeyModelOverrideLimit] = useState(0);
  const [newKeyModelOverrideDailyTokenLimit, setNewKeyModelOverrideDailyTokenLimit] = useState(0);
  const [newKeyModelOverrideMonthlyTokenLimit, setNewKeyModelOverrideMonthlyTokenLimit] = useState(0);
  const [newKeyModelOverrideDailyInputTokenLimit, setNewKeyModelOverrideDailyInputTokenLimit] = useState(0);
  const [newKeyModelOverrideDailyOutputTokenLimit, setNewKeyModelOverrideDailyOutputTokenLimit] = useState(0);
  const [newKeyModelOverrideDedicatedQuota, setNewKeyModelOverrideDedicatedQuota] = useState(false);
  const [keyModelMatchPreview, setKeyModelMatchPreview] = useState<{ ids: string[]; total: number }>({ ids: [], total: 0 });
  const [trialInfo, setTrialInfo] = useState<TrialUserRow | null>(null);
  const [trialHistory, setTrialHistory] = useState<Array<{
    id: number;
    apiKeyId: number;
    keyName: string;
    keyPrefix: string;
    isActive: boolean;
    claimedAt: string;
    expiresAt: string;
    endedAt: string | null;
    endReason: string | null;
    suspended: boolean;
    overrideMaxTrials: number | null;
    overrideDays: number | null;
  }> | null>(null);
  const [lastIssuedKey, setLastIssuedKey] = useState<{ apiKey: string; endpoint: string; durationDays: number; expiresAt: string } | null>(null);
  const [copiedIssued, setCopiedIssued] = useState(false);

  useEffect(() => {
    if (id) loadAll();
  }, [id]);

  const handleSSEMessage = useCallback((row: any) => {
    if (String(row?.apiKeyId) !== String(id)) return;
    void loadAll();
    if (selectedSessionId) {
      void loadSessionDetail(selectedSessionId);
    }
  }, [id, selectedSessionId]);
  // Soft refresh only — avoid hammering /keys on every proxy hop
  useRealtimeSSE(handleSSEMessage, 5000);

  // Load per-key model breakdown
  const loadModelData = useCallback(async () => {
    if (!id) return;
    setModelTabLoading(true);
    try {
      const data = await stats.byModel(modelTabDays, parseInt(id));
      const sorted = [...data].sort((a, b) =>
        modelTabSort === "tokens" ? b.tokens - a.tokens : b.requests - a.requests
      );
      setModelTabData(sorted);
    } catch {}
    setModelTabLoading(false);
  }, [id, modelTabDays, modelTabSort]);

  useEffect(() => { void loadModelData(); }, [loadModelData]);

  const loadLogs = useCallback(async (period: 0 | 1 | 7 | 30 = 0) => {
    if (!id) return;
    setKeyLogsLoading(true);
    setKeyLogsError(null);
    try {
      const params: Record<string, string> = {
        api_key_id: id,
        limit: "100",
        // Full rows so expand can show error / request / response previews (like portal Activity)
      };
      if (period === 0) {
        params.period = "allTime";
      } else if (period === 1) {
        params.period = "today";
      } else if (period === 7) {
        params.period = "7d";
      } else if (period === 30) {
        params.period = "30d";
      }
      const l = await logs.list(params);
      setKeyLogs(Array.isArray(l?.data) ? l.data : []);
    } catch (err: any) {
      console.error("[KeyDetail] Failed to load logs:", err);
      setKeyLogs([]);
      setKeyLogsError(err?.message || "Failed to load logs");
    } finally {
      setKeyLogsLoading(false);
    }
  }, [id]);

  useEffect(() => { void loadLogs(logsPeriod); }, [logsPeriod, loadLogs]);

  const loadKeyCharts = useCallback(async () => {
    if (!id) return;
    const keyId = parseInt(id, 10);
    if (!Number.isFinite(keyId) || keyId <= 0) return;
    setChartsLoading(true);
    try {
      const days = KEY_CHART_DAYS[chartPeriod];
      const tsperiod = days <= 1 ? "hourly" : "daily";
      // Prefer named period keys when possible for consistent WIB ranges
      const periodArg =
        chartPeriod === "today" || chartPeriod === "3d" || chartPeriod === "7d" ||
        chartPeriod === "30d" || chartPeriod === "thisMonth" || chartPeriod === "lastMonth" ||
        chartPeriod === "allTime"
          ? chartPeriod
          : tsperiod;
      const [ts, ms] = await Promise.all([
        stats.timeseries(periodArg, days, keyId),
        stats.byModel(days <= 1 ? 1 : days >= 90 ? 0 : days, keyId),
      ]);
      setKeyTimeseries(Array.isArray(ts) ? ts : []);
      setKeyChartModels(Array.isArray(ms) ? ms : []);
    } catch {
      setKeyTimeseries([]);
      setKeyChartModels([]);
    } finally {
      setChartsLoading(false);
    }
  }, [id, chartPeriod]);

  useEffect(() => { void loadKeyCharts(); }, [loadKeyCharts]);

  const loadAll = async () => {
    if (!id) return;
    try {
      const k = await keys.get(parseInt(id));
      setKeyData(k);
      setEditName(k.name);
      setEditMaxDevices(k.maxDevices);
      setEditDevicePolicy(k.devicePolicy);
      setEditIpPolicy(k.ipPolicy);
      setEditIdePolicy(k.idePolicy);
      setEditMonthlyLimit(k.monthlyTokenLimit);
      setEditDailyTokenLimit(k.dailyTokenLimit);
      setEditDailyInputTokenLimit(k.dailyInputTokenLimit);
      setEditDailyOutputTokenLimit(k.dailyOutputTokenLimit);
      setStatusText("");
      if (k.isTrial) {
        try {
          const t = await trialSettings.getUserByKey(parseInt(id));
          setTrialInfo(t);
        } catch {
          setTrialInfo(null);
        }
        try {
          if (k.discordUserId) {
            const h = await trialSettings.getHistory(k.discordUserId);
            setTrialHistory(h.history);
          } else {
            setTrialHistory([]);
          }
        } catch {
          setTrialHistory([]);
        }
      } else {
        setTrialInfo(null);
        setTrialHistory(null);
      }
    } catch (err) {
      console.error("[KeyDetail] Failed to load key data:", err);
    }
    try {
      const d = await keys.getDevices(parseInt(id));
      setDeviceList(d);
    } catch (err) {
      console.error("[KeyDetail] Failed to load devices:", err);
    }
    void loadLogs(logsPeriod);
    try {
      const ml = await keys.getModelLimits(parseInt(id));
      setKeyModelLimits(ml.data || []);
    } catch {}
    try {
      const catalog = await globalSettings.getModels();
      setKeyModelCatalog(catalog.data || []);
    } catch {}
  };

  const loadSessionDetail = async (sessionId: string) => {
    if (!sessionId) {
      setSelectedSessionDetail(null);
      return;
    }

    try {
      setSessionDetailLoading(true);
      const detail = await logs.sessionDetail(sessionId);
      setSelectedSessionDetail(detail);
    } catch {
      setSelectedSessionDetail(null);
    } finally {
      setSessionDetailLoading(false);
    }
  };

  const handleSave = async () => {
    if (!id) return;
    try {
      await keys.update(parseInt(id), {
        name: editName,
        maxDevices: editMaxDevices,
        devicePolicy: editDevicePolicy,
        ipPolicy: editIpPolicy,
        idePolicy: editIdePolicy,
        monthlyTokenLimit: editMonthlyLimit,
        dailyTokenLimit: editDailyTokenLimit,
        dailyInputTokenLimit: editDailyInputTokenLimit,
        dailyOutputTokenLimit: editDailyOutputTokenLimit,
        rateLimit: keyData?.rateLimit || 0,
        rateLimitWindow: keyData?.rateLimitWindow || "",
        promptLimit: keyData?.promptLimit || 0,
        promptLimitWindow: keyData?.promptLimitWindow || "",
        perModelPromptLimit: keyData?.perModelPromptLimit || 0,
        perModelPromptLimitWindow: keyData?.perModelPromptLimitWindow || "",
      });
      setEditing(false);
      loadAll();
    } catch {}
  };

  const handleToggleActive = async () => {
    if (!id || !keyData) return;
    await keys.update(parseInt(id), { isActive: !keyData.isActive });
    loadAll();
  };

  const handleDelete = async () => {
    if (!id) return;
    setDeleting(true);
    try {
      await keys.delete(parseInt(id, 10));
      notify.success(`Deleted key "${keyData?.name || id}"`);
      setShowDelete(false);
      navigate("/keys");
    } catch (error: any) {
      const msg = error?.message || "Failed to delete API key.";
      setShowDelete(false);
      setStatusText(msg);
      notify.error(msg);
    } finally {
      setDeleting(false);
    }
  };

  const handleRotate = async () => {
    if (!id) return;
    const res = await keys.rotate(parseInt(id));
    setRotatedKey(res.key);
    loadAll();
  };

  const runTrialAction = async (action: string, extra: Record<string, unknown> = {}) => {
    if (!trialInfo) return;
    try {
      const res = await trialSettings.userAction({ action, discordUserId: trialInfo.discordUserId, ...extra });
      if (action === "grant_retry" && (res as any).apiKey) {
        setLastIssuedKey({
          apiKey: (res as any).apiKey,
          endpoint: (res as any).endpoint || "",
          durationDays: (res as any).durationDays || 0,
          expiresAt: (res as any).expiresAt || "",
        });
        setStatusText(`Trial action "${action}" applied ? new key sent to user via DM.`);
      } else {
        setLastIssuedKey(null);
        setStatusText(`Trial action "${action}" applied.`);
      }
      await loadAll();
    } catch (error: any) {
      setStatusText(error?.message || "Trial action failed.");
    }
  };

  const handleBlockDevice = async (fingerprint: string) => {
    if (!id) return;
    await keys.blockDevice(parseInt(id), fingerprint);
    loadAll();
  };

  const handleAllowDevice = async (fingerprint: string) => {
    if (!id) return;
    await keys.allowDevice(parseInt(id), fingerprint);
    loadAll();
  };

  const handleCopy = async (text: string) => {
    await copyToClipboard(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleAddDeviceRule = async () => {
    if (!id || !accessValue.trim()) return;
    try {
      await keys.addDevicePolicyRule(parseInt(id), {
        targetType: accessTargetType,
        value: accessValue.trim(),
        listType: accessListType,
        label: accessLabel.trim() || undefined,
      });
      setAccessValue("");
      setAccessLabel("");
      setStatusText("Device/IP rule added.");
      await loadAll();
    } catch (error: any) {
      setStatusText(error?.message || "Failed to add device/IP rule.");
    }
  };

  const handleRemoveDeviceRule = async (ruleId: number) => {
    if (!id) return;
    try {
      await keys.removeDevicePolicyRule(parseInt(id), ruleId);
      setStatusText("Device/IP rule removed.");
      await loadAll();
    } catch (error: any) {
      setStatusText(error?.message || "Failed to remove rule.");
    }
  };

  const handleAddIdeRule = async () => {
    if (!id || !ideRuleValue.trim()) return;
    try {
      await keys.addIdePolicyRule(parseInt(id), {
        ideName: ideRuleValue.trim(),
        listType: ideRuleType,
      });
      setIdeRuleValue("");
      setStatusText("IDE rule added.");
      await loadAll();
    } catch (error: any) {
      setStatusText(error?.message || "Failed to add IDE rule.");
    }
  };

  const handleRemoveIdeRule = async (ruleId: number) => {
    if (!id) return;
    try {
      await keys.removeIdePolicyRule(parseInt(id), ruleId);
      setStatusText("IDE rule removed.");
      await loadAll();
    } catch (error: any) {
      setStatusText(error?.message || "Failed to remove IDE rule.");
    }
  };

  const handleExportLogs = () => {
    const dateStr = new Date().toISOString().split("T")[0];
    const periodLabel = logsPeriod === 0 ? "All Time" : logsPeriod === 1 ? "Today" : `Last ${logsPeriod} Days`;

    const sheets = [];

    // Sheet 1: Stats summary across all 4 periods
    if (keyData?.stats) {
      const s = keyData.stats;
      sheets.push({
        name: "Summary",
        note: "Usage stats across all time periods",
        headers: ["Metric", "Today", "Last 7 Days", "Last 30 Days", "All Time"],
        rows: [
          ["Prompts",         s.today.requests,         s.week.requests,         s.month.requests,         s.allTime.requests],
          ["Total Tokens",    s.today.tokens,           s.week.tokens,           s.month.tokens,           s.allTime.tokens],
          ["Input Tokens",    s.today.promptTokens,     s.week.promptTokens,     s.month.promptTokens,     s.allTime.promptTokens],
          ["Output Tokens",   s.today.completionTokens, s.week.completionTokens, s.month.completionTokens, s.allTime.completionTokens],
          ["Context Tokens",  s.today.contextTokens,    s.week.contextTokens,    s.month.contextTokens,    s.allTime.contextTokens],
          ["Est. Cost",       fmtCost(s.today.estimatedCost), fmtCost(s.week.estimatedCost), fmtCost(s.month.estimatedCost), fmtCost(s.allTime.estimatedCost)],
        ],
      });
    }

    // Sheet 2: Request logs (filtered by period)
    sheets.push(buildLogsSection(keyLogs, `API Call Logs (${periodLabel})`));

    exportXlsx(sheets, `key-${id}-logs-${dateStr}`, {
      title: `API Key Report: ${keyData?.name || id}`,
      period: periodLabel,
      keyName: keyData?.name,
    });
  };

  const handleExportSessions = () => {
    const dateStr = new Date().toISOString().split("T")[0];
    const sessions = keyData?.analytics?.deviceSessions || [];

    const sheets = [];

    // Sheet 1: Stats summary
    if (keyData?.stats) {
      const s = keyData.stats;
      sheets.push({
        name: "Summary",
        note: "Usage stats for this API key across all time periods",
        headers: ["Metric", "Today", "Last 7 Days", "Last 30 Days", "All Time"],
        rows: [
          ["Prompts",    s.today.requests,  s.week.requests,  s.month.requests,  s.allTime.requests],
          ["Tokens",     s.today.tokens,    s.week.tokens,    s.month.tokens,    s.allTime.tokens],
          ["Input",      s.today.promptTokens, s.week.promptTokens, s.month.promptTokens, s.allTime.promptTokens],
          ["Output",     s.today.completionTokens, s.week.completionTokens, s.month.completionTokens, s.allTime.completionTokens],
          ["Est. Cost",  fmtCost(s.today.estimatedCost), fmtCost(s.week.estimatedCost), fmtCost(s.month.estimatedCost), fmtCost(s.allTime.estimatedCost)],
        ],
      });
    }

    // Sheet 2: Sessions
    sheets.push(buildSessionsSection(sessions, "Chat Sessions"));

    exportXlsx(sheets, `key-${id}-sessions-${dateStr}`, {
      title: `API Key Sessions: ${keyData?.name || id}`,
      period: "All Time",
      keyName: keyData?.name,
    });
  };

  if (!keyData) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate("/keys")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{keyData.name}</h1>
            <Badge variant={keyData.isActive ? "success" : "secondary"}>
              {keyData.isActive ? "Active" : "Disabled"}
            </Badge>
            {keyData.isTrial && (
              <Badge variant="outline" className="gap-1 border-purple-500/50 text-purple-400">
                <Gift className="h-3 w-3" /> Trial
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            <code className="font-mono">{keyData.keyMasked}</code>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={keyData.isActive} onCheckedChange={handleToggleActive} />
          <Button variant="outline" size="sm" onClick={() => setShowRotate(true)}>
            <RotateCw className="h-3 w-3 mr-1" /> Rotate
          </Button>
          {keyData.canDelete !== false && !keyData.isPrimary ? (
            <Button variant="destructive" size="sm" onClick={() => setShowDelete(true)}>
              <Trash2 className="h-3 w-3 mr-1" /> Delete
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground px-2">Primary key ? cannot delete</span>
          )}
        </div>
      </div>

      {trialInfo && (
        <Card className="border-purple-500/30 bg-purple-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Gift className="h-4 w-4 text-purple-400" /> Trial User
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Discord User</p>
                <p className="font-medium">{trialInfo.discordUsername || trialInfo.discordUserId}</p>
                <p className="text-xs font-mono text-muted-foreground">{trialInfo.discordUserId}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Status</p>
                <Badge variant={trialInfo.status === "active" ? "default" : "secondary"}>{trialInfo.status}</Badge>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Claimed</p>
                <p>{formatDate(trialInfo.claimedAt)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Expires</p>
                <p>{formatDate(trialInfo.expiresAt)}</p>
              </div>
            </div>
            {(trialInfo.overrideDailyTokenLimit || trialInfo.overridePromptLimit || trialInfo.overrideDays) && (
              <div className="text-xs text-muted-foreground border-t border-border/40 pt-2">
                Overrides:
                {trialInfo.overrideDays != null && ` duration ${trialInfo.overrideDays}d`}
                {trialInfo.overrideDailyTokenLimit != null && ` ? daily tokens ${trialInfo.overrideDailyTokenLimit.toLocaleString()}`}
                {trialInfo.overridePromptLimit != null && ` ? prompt ${trialInfo.overridePromptLimit}/${trialInfo.overridePromptLimitWindow || "5h"}`}
              </div>
            )}
            <div className="flex flex-wrap gap-2 pt-1">
              {trialInfo.status === "active" && (
                <>
                  <Button size="sm" variant="outline" onClick={() => void runTrialAction("extend", { days: 7 })}>+7 days</Button>
                  <Button size="sm" variant="outline" onClick={() => void runTrialAction("suspend")}>Suspend</Button>
                  <Button size="sm" variant="destructive" onClick={() => void runTrialAction("terminate", { reason: "Admin" })}>End Trial</Button>
                </>
              )}
              {trialInfo.status !== "active" && (
                <Button size="sm" variant="outline" onClick={() => void runTrialAction("grant_retry")}>Grant Retry</Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => navigate("/trial")}>Back to Trial Settings</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {lastIssuedKey && (
        <Card className="border-emerald-500/40 bg-emerald-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2 text-emerald-400">
              <Gift className="h-4 w-4" /> Last Issued Key (Grant Retry)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-muted-foreground">Endpoint</p>
                <code className="font-mono text-xs break-all">{lastIssuedKey.endpoint}</code>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">API Key</p>
                <div className="flex items-center gap-2">
                  <code className="font-mono text-xs break-all flex-1 bg-background/60 p-1.5 rounded border border-border/40">{lastIssuedKey.apiKey}</code>
                  <Button size="sm" variant="outline" onClick={() => void handleCopy(lastIssuedKey.apiKey).then(() => setCopiedIssued(true)).finally(() => setTimeout(() => setCopiedIssued(false), 2000))}>
                    {copiedIssued ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  </Button>
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Duration</p>
                <p>{lastIssuedKey.durationDays} hari</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Expires</p>
                <p>{formatDate(lastIssuedKey.expiresAt)}</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Key ini sudah dikirim ke user via DM template <code className="font-mono">claimed</code>. User tidak perlu claim manual.
            </p>
          </CardContent>
        </Card>
      )}

      {trialHistory && trialHistory.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Trial History ({trialHistory.length} cycle{trialHistory.length === 1 ? "" : "s"})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground border-b border-border/40">
                    <th className="py-2 pr-3 font-medium">Claimed</th>
                    <th className="py-2 pr-3 font-medium">Expires</th>
                    <th className="py-2 pr-3 font-medium">Ended</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-3 font-medium">Reason</th>
                    <th className="py-2 pr-3 font-medium">Key</th>
                  </tr>
                </thead>
                <tbody>
                  {trialHistory.map((h) => {
                    const status = h.endedAt
                      ? (h.endReason || "ended")
                      : (h.suspended ? "suspended" : "active");
                    const isGrant = h.endReason === "admin_grant_retry";
                    return (
                      <tr key={h.id} className={`border-b border-border/20 ${isGrant ? "bg-amber-500/5" : ""}`}>
                        <td className="py-2 pr-3">{formatDate(h.claimedAt)}</td>
                        <td className="py-2 pr-3">{formatDate(h.expiresAt)}</td>
                        <td className="py-2 pr-3">{h.endedAt ? formatDate(h.endedAt) : "?"}</td>
                        <td className="py-2 pr-3">
                          <Badge variant={status === "active" ? "default" : "secondary"}>{status}</Badge>
                        </td>
                        <td className="py-2 pr-3">{h.endReason || "?"}</td>
                        <td className="py-2 pr-3 font-mono text-[10px] text-muted-foreground">
                          {h.keyName} <span className="opacity-60">#{h.apiKeyId}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {keyData.isActive && (
        <Card className="border-blue-500/30 bg-blue-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2 text-blue-400">
              <Info className="h-4 w-4" /> Setup di IDE / CLI
              {keyData.isTrial ? (
                <Badge variant="outline" className="text-[10px] border-amber-500/50 text-amber-400">Trial template</Badge>
              ) : (
                <Badge variant="outline" className="text-[10px] border-emerald-500/50 text-emerald-400">Phantom template</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <div className="font-medium mb-1 flex items-center gap-2">
                <span className="text-emerald-400">A.</span> OpenAI-compatible clients
                <span className="text-xs text-muted-foreground">(Cline, Codex, OpenCode, Cursor)</span>
              </div>
              <pre className="bg-background/60 p-3 rounded font-mono text-xs whitespace-pre-wrap break-all">
{`Endpoint: ${(import.meta as any).env?.VITE_PROXY_PUBLIC_BASE_URL || "https://api.tokito.xyz"}/v1
Authorization: Bearer ${keyData.keyMasked}`}
              </pre>
            </div>
            {!keyData.isTrial && (
            <div>
              <div className="font-medium mb-1 flex items-center gap-2">
                <span className="text-orange-400">B.</span> Anthropic clients
                <span className="text-xs text-muted-foreground">(Claude Code, Anthropic SDK)</span>
              </div>
              <pre className="bg-background/60 p-3 rounded font-mono text-xs whitespace-pre-wrap break-all">
{`export ANTHROPIC_BASE_URL="${(import.meta as any).env?.VITE_PROXY_PUBLIC_BASE_URL || "https://api.tokito.xyz"}/v1"
export ANTHROPIC_AUTH_TOKEN="${keyData.keyMasked}"
export ANTHROPIC_DEFAULT_SONNET_MODEL="<groupy-model-id>"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="<groupy-model-id>"
export ANTHROPIC_DEFAULT_OPUS_MODEL="<groupy-model-id>"
export API_TIMEOUT_MS=500000`}
              </pre>
              <p className="text-xs text-muted-foreground mt-2">
                Setting <code className="font-mono">ANTHROPIC_BASE_URL</code> ke path di atas otomatis route ke <code className="font-mono">/v1/messages</code> di proxy dengan translation ke OpenAI Chat Completions. Tidak perlu install CCProxy / ccrouter lagi.
                {" "}Sama seperti template Phantom — Override/Pro/Premium memakai template ini; Trial beda (model terbatas).
              </p>
            </div>
            )}
            {keyData.isTrial && (
              <p className="text-xs text-muted-foreground">
                Trial: pakai endpoint OpenAI-compatible di atas. Model mengikuti aturan trial (lihat Trial Mode). Bukan template Phantom penuh.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Live usage ? same semantics as client portal */}
      <div className="flex flex-col sm:flex-row sm:items-start gap-3">
        <div className="flex-1 min-w-0">
          <LiveUsageCard live={keyData.liveUsage} />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 self-start"
          onClick={() => setShowDayOverride(true)}
        >
          <CalendarClock className="h-4 w-4 mr-1.5" />
          Today override
        </Button>
      </div>
      <DayOverrideDialog
        keyId={keyData.id}
        open={showDayOverride}
        onOpenChange={setShowDayOverride}
        onChanged={() => {
          // refresh key detail after override / reset
          void keys.get(keyData.id).then(setKeyData).catch(() => undefined);
        }}
      />

      {/* Stats Cards with period filter */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          {(["today","week","month","allTime"] as const).map(p => (
            <button key={p} onClick={() => setStatsPeriod(p)}
              className={`px-3 py-1 text-xs rounded transition-colors ${statsPeriod === p ? "bg-primary text-primary-foreground font-medium" : "text-muted-foreground hover:text-foreground border border-border/50"}`}>
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
        {(() => {
          const s: KeyPeriodStats = keyData.stats[statsPeriod];
          return (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
              {[
                { label: "Prompts", value: formatNumber(s.requests), sub: "User turns" },
                { label: "API Calls", value: formatNumber(s.hopCount || 0), sub: "Upstream hops" },
                { label: "Total Tokens",  value: formatNumber(s.tokens), sub: "limit in+out" },
                {
                  label: "Input (limit)",
                  value: formatNumber(s.promptTokens),
                  sub: [
                    (s as any).peakPromptTokens
                      ? `peak ${formatNumber((s as any).peakPromptTokens)}`
                      : null,
                    (s.fullInputTokens || 0) > 0
                      ? `full ${formatNumber(s.fullInputTokens || 0)} (amanai)`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || undefined,
                },
                { label: "Output Tokens", value: formatNumber(s.completionTokens) },
                { label: "Context Tokens",value: formatNumber(s.contextTokens) },
                { label: "Est. Cost",     value: `$${(s.estimatedCost/1e6).toFixed(4)}` },
                { label: "Devices",       value: keyData.stats.deviceCount.toString() },
              ].map(c => (
                <Card key={c.label} className="border-border/50 transition-all duration-200 hover:border-border hover:bg-accent/10">
                  <CardContent className="p-3">
                    <p className="text-[10px] text-muted-foreground">{c.label}</p>
                    <p className="text-lg font-bold mt-1 truncate tabular-nums">{c.value}</p>
                    {c.sub && <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{c.sub}</p>}
                  </CardContent>
                </Card>
              ))}
            </div>
          );
        })()}
      </div>

      {/* Per-key charts ? same Prompts / API Calls / Tokens views as Overview */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">Usage charts</h2>
            <p className="text-[11px] text-muted-foreground">Scoped to this API key only</p>
          </div>
          <PeriodSelector value={chartPeriod} onChange={setChartPeriod} />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="border-border/50">
            <CardHeader className="pb-2 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <CardTitle className="text-base font-medium">
                  {chartMetric === "prompts" ? "Prompts Over Time" : "API Calls Over Time"}
                </CardTitle>
                {chartsLoading && <span className="text-[10px] text-muted-foreground">Loading?</span>}
              </div>
              <div className="inline-flex rounded-lg border border-border/60 p-0.5 bg-accent/20">
                {([
                  { key: "prompts" as const, label: "Prompts" },
                  { key: "apiCalls" as const, label: "API Calls" },
                ]).map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setChartMetric(opt.key)}
                    className={`px-3 py-1 text-xs rounded-md transition-all duration-200 ${
                      chartMetric === opt.key
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </CardHeader>
            <CardContent>
              {keyTimeseries.length === 0 && !chartsLoading ? (
                <p className="text-sm text-muted-foreground py-10 text-center">No activity in this period.</p>
              ) : (
                <ChartBox>
                  <LineChart data={keyTimeseries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="period"
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      tickFormatter={formatChartPeriod}
                    />
                    <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={ITEM_STYLE} labelStyle={LABEL_STYLE} />
                    <Line
                      type="monotone"
                      dataKey={chartMetric === "prompts" ? "requests" : "apiCalls"}
                      name={chartMetric === "prompts" ? "Prompts" : "API Calls"}
                      stroke={chartMetric === "prompts" ? "#818cf8" : "#34d399"}
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive
                      animationDuration={450}
                    />
                  </LineChart>
                </ChartBox>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium">Tokens Over Time</CardTitle>
            </CardHeader>
            <CardContent>
              {keyTimeseries.length === 0 && !chartsLoading ? (
                <p className="text-sm text-muted-foreground py-10 text-center">No activity in this period.</p>
              ) : (
                <ChartBox>
                  <LineChart data={keyTimeseries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="period"
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      tickFormatter={formatChartPeriod}
                    />
                    <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => formatNumber(v)} />
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      itemStyle={ITEM_STYLE}
                      labelStyle={LABEL_STYLE}
                      formatter={(value: number) => formatNumber(value)}
                    />
                    <Line
                      type="monotone"
                      dataKey="tokens"
                      name="Tokens"
                      stroke="#38bdf8"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive
                      animationDuration={450}
                    />
                  </LineChart>
                </ChartBox>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/50 lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium">Token Usage by Model</CardTitle>
            </CardHeader>
            <CardContent>
              {keyChartModels.length === 0 && !chartsLoading ? (
                <p className="text-sm text-muted-foreground py-10 text-center">No model usage in this period.</p>
              ) : (
                <ChartBox>
                  <BarChart data={keyChartModels.slice(0, 10)}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="model"
                      tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                      tickFormatter={(v) => String(v || "").split("/").pop()?.replace("claude-", "c-").replace("gpt-", "").substring(0, 14) || ""}
                    />
                    <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => formatNumber(v)} />
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      itemStyle={ITEM_STYLE}
                      labelStyle={LABEL_STYLE}
                      formatter={(value: number) => formatNumber(value)}
                    />
                    <Bar dataKey="tokens" fill="#818cf8" radius={[4, 4, 0, 0]} name="Tokens" isAnimationActive animationDuration={450} />
                  </BarChart>
                </ChartBox>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {[
          { label: "Device Allowlist", value: keyData.policyStats?.deviceAllowCount || 0 },
          { label: "Device Blacklist", value: keyData.policyStats?.deviceBlockCount || 0 },
          { label: "IP Allow / Block", value: `${keyData.policyStats?.ipAllowCount || 0} / ${keyData.policyStats?.ipBlockCount || 0}` },
          { label: "IDE Allow / Block", value: `${keyData.policyStats?.ideAllowCount || 0} / ${keyData.policyStats?.ideBlockCount || 0}` },
          { label: "Device Rules Saved", value: (keyData.policyEntries?.devices?.length || 0).toString() },
          { label: "IDE Rules Saved", value: (keyData.policyEntries?.ides?.length || 0).toString() },
        ].map((s) => (
          <Card key={s.label} className="border-border/50">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="text-xl font-bold mt-1">{typeof s.value === "number" ? formatNumber(s.value) : s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="config">
        <TabsList>
          <TabsTrigger value="config">Configuration</TabsTrigger>
          <TabsTrigger value="access">Access Lists</TabsTrigger>
          <TabsTrigger value="devices">Devices ({deviceList.length})</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
          <TabsTrigger value="sessions">Device Sessions</TabsTrigger>
          <TabsTrigger value="models">Top Models</TabsTrigger>
        </TabsList>

        {/* Config Tab */}
        <TabsContent value="config">
          <Card className="border-border/50">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Key Configuration</CardTitle>
                <Button
                  variant={editing ? "default" : "outline"}
                  size="sm"
                  onClick={() => editing ? handleSave() : setEditing(true)}
                >
                  {editing ? "Save Changes" : "Edit"}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
    <div>
      <Label>Name</Label>
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    disabled={!editing}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>Max Devices (0 = unlimited)</Label>
                  <Input
                    type="number"
                    value={editMaxDevices}
                    onChange={(e) => setEditMaxDevices(parseInt(e.target.value) || 0)}
                    disabled={!editing}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>Device Policy</Label>
                  <Select
                    value={editDevicePolicy}
                    onValueChange={setEditDevicePolicy}
                    disabled={!editing}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="allowlist">Allowlist</SelectItem>
                      <SelectItem value="blacklist">Blacklist</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>IP Policy</Label>
                  <Select
                    value={editIpPolicy}
                    onValueChange={setEditIpPolicy}
                    disabled={!editing}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="allowlist">Allowlist</SelectItem>
                      <SelectItem value="blacklist">Blacklist</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>IDE Policy</Label>
                  <Select
                    value={editIdePolicy}
                    onValueChange={setEditIdePolicy}
                    disabled={!editing}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="allowlist">Allowlist</SelectItem>
                      <SelectItem value="blacklist">Blacklist</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
    <div>
      <Label>Daily Token Limit (0 = use global)</Label>
      <Input
        type="number"
        value={editDailyTokenLimit}
        onChange={(e) => setEditDailyTokenLimit(parseInt(e.target.value) || 0)}
        disabled={!editing}
        className="mt-1"
      />
    </div>
    <div>
      <Label>Monthly Token Limit (0 = use global)</Label>
      <Input
        type="number"
        value={editMonthlyLimit}
        onChange={(e) => setEditMonthlyLimit(parseInt(e.target.value) || 0)}
        disabled={!editing}
        className="mt-1"
      />
    </div>
    <div>
      <Label>Daily Input Token Limit (0 = use global)</Label>
      <Input
        type="number"
        value={editDailyInputTokenLimit}
        onChange={(e) => setEditDailyInputTokenLimit(parseInt(e.target.value) || 0)}
        disabled={!editing}
        className="mt-1"
      />
    </div>
    <div>
      <Label>Daily Output Token Limit (0 = use global)</Label>
      <Input
        type="number"
        value={editDailyOutputTokenLimit}
        onChange={(e) => setEditDailyOutputTokenLimit(parseInt(e.target.value) || 0)}
        disabled={!editing}
        className="mt-1"
      />
    </div>
    <div>
      <Label>Prompt Limit (0 = use global)</Label>
      <Input
        type="number"
        value={keyData?.promptLimit || 0}
        onChange={(e) => {
          if (!editing) return;
          const val = parseInt(e.target.value) || 0;
          setKeyData(prev => prev ? { ...prev, promptLimit: val } : prev);
        }}
        disabled={!editing}
        className="mt-1"
      />
      <p className="text-[10px] text-muted-foreground mt-1">1 per user turn</p>
    </div>
    <div>
      <Label>Prompt Limit Window</Label>
      <Input
        value={keyData?.promptLimitWindow || "5h"}
        onChange={(e) => {
          if (!editing) return;
          setKeyData(prev => prev ? { ...prev, promptLimitWindow: e.target.value } : prev);
        }}
        disabled={!editing}
        className="mt-1"
      />
    </div>
    <div>
      <Label>API Call Limit (0 = use global)</Label>
      <Input
        type="number"
        value={keyData?.rateLimit || 0}
        onChange={(e) => {
          if (!editing) return;
          const val = parseInt(e.target.value) || 0;
          setKeyData(prev => prev ? { ...prev, rateLimit: val } : prev);
        }}
        disabled={!editing}
        className="mt-1"
      />
      <p className="text-[10px] text-muted-foreground mt-1">Every successful upstream hop</p>
    </div>
    <div>
      <Label>API Call Limit Window</Label>
      <Input
        value={keyData?.rateLimitWindow || "5h"}
        onChange={(e) => {
          if (!editing) return;
          setKeyData(prev => prev ? { ...prev, rateLimitWindow: e.target.value } : prev);
        }}
        disabled={!editing}
        className="mt-1"
      />
    </div>
    <div>
      <Label>Default Per-Model Prompt Limit (0 = use global)</Label>
      <Input
        type="number"
        value={keyData?.perModelPromptLimit || 0}
        onChange={(e) => {
          if (!editing) return;
          const val = parseInt(e.target.value) || 0;
          setKeyData(prev => prev ? { ...prev, perModelPromptLimit: val } : prev);
        }}
        disabled={!editing}
        className="mt-1"
      />
    </div>
    <div>
      <Label>Per-Model Window</Label>
      <Input
        value={keyData?.perModelPromptLimitWindow || "1d"}
        onChange={(e) => {
          if (!editing) return;
          setKeyData(prev => prev ? { ...prev, perModelPromptLimitWindow: e.target.value } : prev);
        }}
        disabled={!editing}
        className="mt-1"
      />
    </div>
    <div className="md:col-span-2 space-y-2 border border-border/50 rounded-lg p-3">
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm font-medium">Per-Key Model Limit Overrides</Label>
          <p className="text-[10px] text-muted-foreground">
            Override prompt and/or token caps for this key. Pattern rows share one family quota.
            Window = Per-Model Prompt Window above. Unlimited token keys still respect these prompt caps.
          </p>
        </div>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">Manage Model Limits</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Manage Per-Key Model Limits</DialogTitle>
              <DialogDescription>
                Configure specific prompt and token limits for individual models for this key.
              </DialogDescription>
            </DialogHeader>
            
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 border p-4 rounded-lg bg-accent/10">
              <div className="col-span-2 md:col-span-3">
                <Label>Model (ketik pattern, mis. "claude" / "ag" / "qwen3.5")</Label>
                <Input
                  className="mt-1"
                  placeholder="Ketik untuk cari model..."
                  value={newKeyModelOverride}
                  onChange={(e) => {
                    const v = e.target.value;
                    setNewKeyModelOverride(v);
                    // Debounced catalog match
                    if ((window as any).__mlMatchT) {
                      clearTimeout((window as any).__mlMatchT);
                    }
                    const existing = keyModelLimits.find(ml => ml.model === v);
                    (window as any).__mlMatchT = setTimeout(async () => {
                      if (!v || v.length < 1) {
                        setKeyModelMatchPreview({ ids: [], total: 0 });
                        return;
                      }
                      try {
                        const r = await keys.matchModelCatalog(parseInt(id), v);
                        setKeyModelMatchPreview({ ids: r.data, total: r.total });
                        // Auto-detect pattern only for new rows
                        if (!existing) {
                          if (r.total >= 2) setNewKeyModelOverrideIsPattern(true);
                          else if (r.total === 1) setNewKeyModelOverrideIsPattern(false);
                        }
                      } catch {
                        setKeyModelMatchPreview({ ids: [], total: 0 });
                      }
                    }, 300);
                    // Pre-fill limits if an existing override matches exactly
                    if (existing) {
                      setNewKeyModelOverrideLimit(existing.promptLimit || 0);
                      setNewKeyModelOverrideDailyTokenLimit(existing.dailyTokenLimit || 0);
                      setNewKeyModelOverrideMonthlyTokenLimit(existing.monthlyTokenLimit || 0);
                      setNewKeyModelOverrideDailyInputTokenLimit(existing.dailyInputTokenLimit || 0);
                      setNewKeyModelOverrideDailyOutputTokenLimit(existing.dailyOutputTokenLimit || 0);
                      setNewKeyModelOverrideIsPattern(!!existing.isPattern);
                      setNewKeyModelOverrideDedicatedQuota(!!existing.dedicatedQuota);
                    } else {
                      setNewKeyModelOverrideLimit(0);
                      setNewKeyModelOverrideDailyTokenLimit(0);
                      setNewKeyModelOverrideMonthlyTokenLimit(0);
                      setNewKeyModelOverrideDailyInputTokenLimit(0);
                      setNewKeyModelOverrideDailyOutputTokenLimit(0);
                      setNewKeyModelOverrideDedicatedQuota(false);
                    }
                  }}
                />
                {newKeyModelOverride.length > 0 && (
                  <div className="mt-1 space-y-1 text-xs text-muted-foreground">
                    {newKeyModelOverrideIsPattern ? (
                      <>
                        <div>
                          Pattern akan apply ke <b>{keyModelMatchPreview.total}</b> model yang mengandung substring <span className="font-mono">"{newKeyModelOverride}"</span>:
                        </div>
                        {keyModelMatchPreview.total > 0 && (
                          <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto p-1 border rounded bg-background/40">
                            {keyModelMatchPreview.ids.map((m) => (
                              <span key={m} className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 font-mono text-[10px]">
                                {m}
                              </span>
                            ))}
                            {keyModelMatchPreview.total > keyModelMatchPreview.ids.length && (
                              <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-[10px]">
                                ...{(keyModelMatchPreview.total - keyModelMatchPreview.ids.length).toLocaleString()} lagi
                              </span>
                            )}
                          </div>
                        )}
                        {keyModelMatchPreview.total === 0 && (
                          <div className="text-amber-600 dark:text-amber-400">
                            Belum ada model di catalog yang cocok. Pattern tetap tersimpan dan akan apply ke model baru yang mengandung substring ini.
                          </div>
                        )}
                      </>
                    ) : (
                      <div>
                        {keyModelMatchPreview.total > 0
                          ? `Cocok dengan ${keyModelMatchPreview.total} model di catalog: ${keyModelMatchPreview.ids.slice(0, 3).join(", ")}${keyModelMatchPreview.total > 3 ? ` +${keyModelMatchPreview.total - 3}` : ""}`
                          : "Tidak ada model di catalog yang cocok (entry exact akan tersimpan, tidak match ke model lain)"}
                      </div>
                    )}
                  </div>
                )}
                <div className="mt-2 flex items-center gap-2">
                  <input
                    id="newKeyModelOverrideIsPattern"
                    type="checkbox"
                    checked={newKeyModelOverrideIsPattern}
                    onChange={(e) => setNewKeyModelOverrideIsPattern(e.target.checked)}
                  />
                  <Label htmlFor="newKeyModelOverrideIsPattern" className="cursor-pointer text-xs">
                    <b>Pattern / batch</b> (auto-detect: ON saat =2 model cocok) ? 1 entry ini auto-apply ke semua model yang substring mengandung "{newKeyModelOverride}"
                  </Label>
                </div>
              </div>
              <div>
                <Label>Prompt Limit</Label>
                <Input type="number" value={newKeyModelOverrideLimit} onChange={(e) => setNewKeyModelOverrideLimit(parseInt(e.target.value) || 0)} className="mt-1" />
              </div>
              <div>
                <Label>Daily Token Limit</Label>
                <Input type="number" value={newKeyModelOverrideDailyTokenLimit} onChange={(e) => setNewKeyModelOverrideDailyTokenLimit(parseInt(e.target.value) || 0)} className="mt-1" />
              </div>
              <div>
                <Label>Monthly Token Limit</Label>
                <Input type="number" value={newKeyModelOverrideMonthlyTokenLimit} onChange={(e) => setNewKeyModelOverrideMonthlyTokenLimit(parseInt(e.target.value) || 0)} className="mt-1" />
              </div>
              <div>
                <Label>Daily Input Token Limit</Label>
                <Input type="number" value={newKeyModelOverrideDailyInputTokenLimit} onChange={(e) => setNewKeyModelOverrideDailyInputTokenLimit(parseInt(e.target.value) || 0)} className="mt-1" />
              </div>
              <div>
                <Label>Daily Output Token Limit</Label>
                <Input type="number" value={newKeyModelOverrideDailyOutputTokenLimit} onChange={(e) => setNewKeyModelOverrideDailyOutputTokenLimit(parseInt(e.target.value) || 0)} className="mt-1" />
              </div>
              <div className="col-span-2 md:col-span-3">
                <label className="inline-flex items-start gap-2 cursor-pointer text-xs">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={newKeyModelOverrideDedicatedQuota}
                    onChange={(e) => setNewKeyModelOverrideDedicatedQuota(e.target.checked)}
                  />
                  <span>
                    <b>Dedicated pool</b> — outside account daily / input / output (requires Daily Token Limit &gt; 0)
                  </span>
                </label>
              </div>
              <div className="col-span-2 md:col-span-3 flex flex-wrap items-center justify-end gap-2">
                {newKeyModelOverrideIsPattern && keyModelMatchPreview.total > 0 && (
                  <Button
                    variant="outline"
                    onClick={async () => {
                      if (!id || !newKeyModelOverride) return;
                      if (!(await notify.confirm({
                        title: "Buat exact entries?",
                        message: `Buat ${keyModelMatchPreview.total} entry exact untuk semua model yang cocok?`,
                        confirmLabel: "Buat",
                      }))) return;
                      const limits = {
                        promptLimit: newKeyModelOverrideLimit,
                        dailyTokenLimit: newKeyModelOverrideDailyTokenLimit,
                        monthlyTokenLimit: newKeyModelOverrideMonthlyTokenLimit,
                        dailyInputTokenLimit: newKeyModelOverrideDailyInputTokenLimit,
                        dailyOutputTokenLimit: newKeyModelOverrideDailyOutputTokenLimit,
                        dedicatedQuota: newKeyModelOverrideDedicatedQuota,
                      };
                      for (const m of keyModelMatchPreview.ids) {
                        const bare = m.includes("/") ? m.slice(m.lastIndexOf("/") + 1) : m;
                        await keys.setModelLimit(parseInt(id), bare, { ...limits, isPattern: false });
                      }
                      setNewKeyModelOverride("");
                      setNewKeyModelOverrideIsPattern(false);
                      setNewKeyModelOverrideLimit(0);
                      setNewKeyModelOverrideDailyTokenLimit(0);
                      setNewKeyModelOverrideMonthlyTokenLimit(0);
                      setNewKeyModelOverrideDailyInputTokenLimit(0);
                      setNewKeyModelOverrideDailyOutputTokenLimit(0);
                      setNewKeyModelOverrideDedicatedQuota(false);
                      setKeyModelMatchPreview({ ids: [], total: 0 });
                      const ml = await keys.getModelLimits(parseInt(id)); setKeyModelLimits(ml.data || []);
                    }}
                  >
                    Bulk Exact ke {keyModelMatchPreview.total} model
                  </Button>
                )}
                <Button onClick={async () => {
                  if (!id || !newKeyModelOverride) return;
                  await keys.setModelLimit(parseInt(id), newKeyModelOverride, {
                    promptLimit: newKeyModelOverrideLimit,
                    dailyTokenLimit: newKeyModelOverrideDailyTokenLimit,
                    monthlyTokenLimit: newKeyModelOverrideMonthlyTokenLimit,
                    dailyInputTokenLimit: newKeyModelOverrideDailyInputTokenLimit,
                    dailyOutputTokenLimit: newKeyModelOverrideDailyOutputTokenLimit,
                    isPattern: newKeyModelOverrideIsPattern,
                    dedicatedQuota: newKeyModelOverrideDedicatedQuota,
                  });
                  setNewKeyModelOverride("");
                  setNewKeyModelOverrideIsPattern(false);
                  setNewKeyModelOverrideLimit(0);
                  setNewKeyModelOverrideDailyTokenLimit(0);
                  setNewKeyModelOverrideMonthlyTokenLimit(0);
                  setNewKeyModelOverrideDailyInputTokenLimit(0);
                  setNewKeyModelOverrideDailyOutputTokenLimit(0);
                  setNewKeyModelOverrideDedicatedQuota(false);
                  setKeyModelMatchPreview({ ids: [], total: 0 });
                  const ml = await keys.getModelLimits(parseInt(id)); setKeyModelLimits(ml.data || []);
                }}>
                  {newKeyModelOverrideIsPattern
                    ? `Simpan Pattern (auto ke ${keyModelMatchPreview.total} model)`
                    : "Save Model Override"}
                </Button>
              </div>
            </div>

            <div className="mt-6 space-y-2">
              <Label>Configured Limits</Label>
              {keyModelLimits.length > 0 ? (
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
                      {keyModelLimits.map(ml => (
                        <tr key={ml.id} className="hover:bg-muted/50 align-top">
                          <td className="p-2 font-mono">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span>{ml.model}</span>
                              {ml.isPattern && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30" title="Pattern: applies to all models whose ID contains this substring">
                                  PATTERN
                                </span>
                              )}
                              {ml.dedicatedQuota && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-sky-500/20 text-sky-300 border border-sky-500/30" title="Dedicated pool outside account daily/input/output">
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
                              if (!id) return;
                              await keys.deleteModelLimit(parseInt(id), ml.model, !!ml.isPattern);
                              const r = await keys.getModelLimits(parseInt(id)); setKeyModelLimits(r.data || []);
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
            </CardContent>
          </Card>
        </TabsContent>

        {/* Access Lists Tab */}
        <TabsContent value="access" className="space-y-4">
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="text-base">Add Device/IP Rule</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div>
                  <Label>Target Type</Label>
                  <Select value={accessTargetType} onValueChange={(v) => setAccessTargetType(v as "fingerprint" | "ip")}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fingerprint">Fingerprint</SelectItem>
                      <SelectItem value="ip">IP Address</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Rule Type</Label>
                  <Select value={accessListType} onValueChange={(v) => setAccessListType(v as "allow" | "block")}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="allow">Allow</SelectItem>
                      <SelectItem value="block">Block</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="md:col-span-2">
                  <Label>{accessTargetType === "ip" ? "IP Address" : "Fingerprint"}</Label>
                  <Input className="mt-1" value={accessValue} onChange={(e) => setAccessValue(e.target.value)} placeholder={accessTargetType === "ip" ? "e.g. 1.2.3.4" : "e.g. abcd1234..."} />
                </div>
              </div>
              <div className="flex flex-col md:flex-row gap-3">
                <Input value={accessLabel} onChange={(e) => setAccessLabel(e.target.value)} placeholder="Optional label..." className="md:flex-1" />
                <Button onClick={handleAddDeviceRule}>Add Device/IP Rule</Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="text-base">Device/IP Rules</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[720px]">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="text-left py-3 px-4 text-muted-foreground font-medium">Type</th>
                    <th className="text-left py-3 px-4 text-muted-foreground font-medium">Target</th>
                    <th className="text-left py-3 px-4 text-muted-foreground font-medium">Label</th>
                    <th className="text-left py-3 px-4 text-muted-foreground font-medium">Created</th>
                    <th className="text-center py-3 px-4 text-muted-foreground font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {(keyData.policyEntries?.devices || []).map((rule) => (
                    <tr key={`dev-rule-${rule.id}`} className="border-b border-border/30 hover:bg-accent/30">
                      <td className="py-2 px-4 text-xs">
                        <Badge variant={rule.listType === "block" ? "destructive" : "success"} className="text-[10px]">
                          {rule.listType === "block" ? "Block" : "Allow"}
                        </Badge>
                      </td>
                      <td className="py-2 px-4 text-xs font-mono">{rule.fingerprint || rule.ipAddress || "-"}</td>
                      <td className="py-2 px-4 text-xs">{rule.label || "-"}</td>
                      <td className="py-2 px-4 text-xs text-muted-foreground">
                        <div>{formatDate(rule.createdAt)}</div>
                        <div className="text-[10px]">{formatRelativeTime(rule.createdAt)}</div>
                      </td>
                      <td className="py-2 px-4 text-center">
                        <Button size="icon" variant="ghost" onClick={() => handleRemoveDeviceRule(rule.id)}>
                          <X className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {(keyData.policyEntries?.devices || []).length === 0 && (
                    <tr>
                      <td colSpan={5} className="text-center py-8 text-muted-foreground">No device/IP rules saved.</td>
                    </tr>
                  )}
                </tbody>
              </table>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="text-base">Add IDE Rule</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <Label>Rule Type</Label>
                  <Select value={ideRuleType} onValueChange={(v) => setIdeRuleType(v as "allow" | "block")}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="allow">Allow</SelectItem>
                      <SelectItem value="block">Block</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="md:col-span-2">
                  <Label>IDE Name</Label>
                  <Input className="mt-1" value={ideRuleValue} onChange={(e) => setIdeRuleValue(e.target.value)} placeholder="e.g. cursor, vscode, windsurf" />
                </div>
              </div>
              <Button onClick={handleAddIdeRule}>Add IDE Rule</Button>
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="text-base">IDE Rules</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[720px]">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="text-left py-3 px-4 text-muted-foreground font-medium">Type</th>
                    <th className="text-left py-3 px-4 text-muted-foreground font-medium">IDE</th>
                    <th className="text-left py-3 px-4 text-muted-foreground font-medium">Created</th>
                    <th className="text-center py-3 px-4 text-muted-foreground font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {(keyData.policyEntries?.ides || []).map((rule) => (
                    <tr key={`ide-rule-${rule.id}`} className="border-b border-border/30 hover:bg-accent/30">
                      <td className="py-2 px-4 text-xs">
                        <Badge variant={rule.listType === "block" ? "destructive" : "success"} className="text-[10px]">
                          {rule.listType === "block" ? "Block" : "Allow"}
                        </Badge>
                      </td>
                      <td className="py-2 px-4 text-xs font-mono">{rule.ideName}</td>
                      <td className="py-2 px-4 text-xs text-muted-foreground">
                        <div>{formatDate(rule.createdAt)}</div>
                        <div className="text-[10px]">{formatRelativeTime(rule.createdAt)}</div>
                      </td>
                      <td className="py-2 px-4 text-center">
                        <Button size="icon" variant="ghost" onClick={() => handleRemoveIdeRule(rule.id)}>
                          <X className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {(keyData.policyEntries?.ides || []).length === 0 && (
                    <tr>
                      <td colSpan={4} className="text-center py-8 text-muted-foreground">No IDE rules saved.</td>
                    </tr>
                  )}
                </tbody>
              </table>
              </div>
            </CardContent>
          </Card>

          {statusText ? <p className="text-xs text-muted-foreground">{statusText}</p> : null}
        </TabsContent>

        {/* Devices Tab */}
        <TabsContent value="devices">
          <Card className="border-border/50">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[720px]">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="text-left py-3 px-4 text-muted-foreground font-medium">Fingerprint</th>
                    <th className="text-left py-3 px-4 text-muted-foreground font-medium">IP</th>
                    <th className="text-left py-3 px-4 text-muted-foreground font-medium">IDE</th>
                    <th className="text-left py-3 px-4 text-muted-foreground font-medium">OS</th>
                    <th className="text-left py-3 px-4 text-muted-foreground font-medium">Device Name</th>
                    <th className="text-left py-3 px-4 text-muted-foreground font-medium">First Seen</th>
                    <th className="text-left py-3 px-4 text-muted-foreground font-medium">Last Seen</th>
                    <th className="text-right py-3 px-4 text-muted-foreground font-medium">Requests</th>
                    <th className="text-center py-3 px-4 text-muted-foreground font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {deviceList.map((d) => (
                    <tr key={d.id} className="border-b border-border/30 hover:bg-accent/30">
                      <td className="py-2 px-4">
                        <code className="text-xs font-mono">{d.fingerprint?.substring(0, 16)}...</code>
                      </td>
                      <td className="py-2 px-4 text-sm">{d.ipAddress || "?"}</td>
                      <td className="py-2 px-4 text-sm">{d.ideDetected || "?"}</td>
                      <td className="py-2 px-4 text-sm">{d.osDetected || "?"}</td>
                      <td className="py-2 px-4 text-xs">{d.deviceName || "?"}</td>
                      <td className="py-2 px-4 text-xs text-muted-foreground">
                        {d.firstSeen ? (
                          <>
                            <div>{formatDate(d.firstSeen)}</div>
                            <div className="text-[10px]">{formatRelativeTime(d.firstSeen)}</div>
                          </>
                        ) : "?"}
                      </td>
                      <td className="py-2 px-4 text-xs text-muted-foreground">
                        {d.lastSeen ? (
                          <>
                            <div>{formatDate(d.lastSeen)}</div>
                            <div className="text-[10px]">{formatRelativeTime(d.lastSeen)}</div>
                          </>
                        ) : "?"}
                      </td>
                      <td className="py-2 px-4 text-right font-mono">{d.requestCount}</td>
                      <td className="py-2 px-4 text-center">
                        {d.isBlocked ? (
                          <Button size="sm" variant="outline" onClick={() => handleAllowDevice(d.fingerprint)}>
                            <Shield className="h-3 w-3 mr-1" /> Unblock
                          </Button>
                        ) : (
                          <Button size="sm" variant="destructive" onClick={() => handleBlockDevice(d.fingerprint)}>
                            <ShieldOff className="h-3 w-3 mr-1" /> Block
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {deviceList.length === 0 && (
                    <tr>
                      <td colSpan={9} className="text-center py-8 text-muted-foreground">
                        No devices have used this key yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Logs Tab */}
        <TabsContent value="logs">
          <Card className="border-border/50 overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between pb-2 flex-wrap gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <CardTitle className="text-base">Request Logs</CardTitle>
                <div className="flex gap-1">
                  {([{l:"Today",v:1},{l:"7 Days",v:7},{l:"30 Days",v:30},{l:"All",v:0}] as const).map(o => (
                    <button key={o.v} onClick={() => { setLogsPeriod(o.v as 0|1|7|30); setExpandedLogId(null); }}
                      className={`px-2 py-0.5 text-xs rounded transition-colors ${logsPeriod === o.v ? "bg-primary text-primary-foreground font-medium" : "text-muted-foreground hover:text-foreground border border-border/50"}`}>
                      {o.l}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground w-full sm:w-auto">Click a row to inspect error / request / response</p>
              </div>
              <Button variant="outline" size="sm" onClick={handleExportLogs}>
                <Download className="h-4 w-4 mr-2" /> Export XLSX
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[1100px]">
                  <thead>
                    <tr className="border-b border-border/50">
                      <th className="text-left py-3 px-3 text-muted-foreground font-medium w-8" />
                      <th className="text-left py-3 px-3 text-muted-foreground font-medium whitespace-nowrap">Time</th>
                      <th className="text-left py-3 px-3 text-muted-foreground font-medium min-w-[260px]">Model</th>
                      <th className="text-left py-3 px-3 text-muted-foreground font-medium whitespace-nowrap">IDE</th>
                      <th className="text-left py-3 px-3 text-muted-foreground font-medium whitespace-nowrap">Provider</th>
                      <th className="text-left py-3 px-3 text-muted-foreground font-medium whitespace-nowrap">OS / Client</th>
                      <th className="text-left py-3 px-3 text-muted-foreground font-medium whitespace-nowrap">IP</th>
                      <th className="text-left py-3 px-3 text-muted-foreground font-medium">Tools</th>
                      <th className="text-right py-3 px-3 text-muted-foreground font-medium whitespace-nowrap">Tokens</th>
                      <th className="text-right py-3 px-3 text-muted-foreground font-medium whitespace-nowrap">Latency</th>
                      <th className="text-left py-3 px-3 text-muted-foreground font-medium whitespace-nowrap">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {keyLogs.map((log) => {
                      const open = expandedLogId === log.id;
                      const tools = Array.isArray(log.toolsUsed) ? log.toolsUsed.filter(Boolean) : [];
                      const requestFull =
                        (Array.isArray(log.transcript) && log.transcript.length > 0
                          ? log.transcript.map((e) => `${e.role}: ${e.content}`).join("\n\n")
                          : "") ||
                        log.requestPreview ||
                        "";
                      const responseFull = log.responsePreview || "";
                      return (
                        <Fragment key={log.id}>
                          <tr
                            className={`border-b border-border/30 hover:bg-accent/30 cursor-pointer ${open ? "bg-accent/20" : ""}`}
                            onClick={() => setExpandedLogId(open ? null : log.id)}
                          >
                            <td className="py-2 px-3 text-muted-foreground">
                              {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                            </td>
                            <td className="py-2 px-3 text-xs text-muted-foreground font-mono whitespace-nowrap">
                              <div>{formatDate(log.createdAt)}</div>
                              <div className="text-[10px]">{formatRelativeTime(log.createdAt)}</div>
                            </td>
                            <td className="py-2 px-3 min-w-[260px] max-w-[420px]">
                              <code
                                className="text-xs bg-accent/50 px-1.5 py-0.5 rounded inline-block max-w-full whitespace-nowrap overflow-hidden text-ellipsis align-middle"
                                title={log.model}
                              >
                                {log.model}
                              </code>
                            </td>
                            <td className="py-2 px-3 text-xs whitespace-nowrap">{log.ideDetected || "-"}</td>
                            <td className="py-2 px-3 text-xs whitespace-nowrap">{log.provider || "unknown"}</td>
                            <td className="py-2 px-3 text-xs text-muted-foreground whitespace-nowrap">
                              <div>{log.osDetected || "Unknown"}</div>
                              <div className="text-[10px]">{log.clientName || "-"}</div>
                            </td>
                            <td className="py-2 px-3 text-xs font-mono whitespace-nowrap">{log.ipAddress || "-"}</td>
                            <td className="py-2 px-3 text-xs max-w-[160px] truncate" title={tools.join(", ") || undefined}>
                              {tools.length ? tools.slice(0, 2).join(", ") : "?"}
                            </td>
                            <td className="py-2 px-3 text-right font-mono text-xs whitespace-nowrap">{formatNumber(log.totalTokens)}</td>
                            <td className="py-2 px-3 text-right text-xs text-muted-foreground whitespace-nowrap">{log.latencyMs}ms</td>
                            <td className="py-2 px-3 whitespace-nowrap">
                              <Badge variant={log.statusCode >= 400 ? "destructive" : "success"} className="text-[10px]">
                                {log.statusCode} {statusLabel(log.statusCode)}
                              </Badge>
                            </td>
                          </tr>
                          {open && (
                            <tr className="border-b border-border/50">
                              <td colSpan={11} className="px-4 py-3 bg-accent/15">
                                <div className="space-y-3 text-sm w-full min-w-0">
                                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                                    <span className={`font-medium ${log.statusCode >= 400 ? "text-destructive" : "text-emerald-400"}`}>
                                      {log.statusCode} {statusLabel(log.statusCode)}
                                    </span>
                                    {statusDetail(log.statusCode) && (
                                      <span className="text-muted-foreground text-xs">? {statusDetail(log.statusCode)}</span>
                                    )}
                                  </div>
                                  {(log.errorMessage || log.statusCode >= 400) && (
                                    <div>
                                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Error / reason</p>
                                      <pre className="text-xs text-red-400/90 bg-red-400/5 border border-red-400/15 rounded-md px-2.5 py-2 font-mono whitespace-pre-wrap break-words max-h-[50vh] overflow-y-auto">
                                        {log.errorMessage || "(no error message stored ? check upstream response below)"}
                                      </pre>
                                    </div>
                                  )}
                                  {requestFull ? (
                                    <div>
                                      <div className="flex items-center justify-between gap-2 mb-1">
                                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                          Request {Array.isArray(log.transcript) && log.transcript.length > 0 ? "(full transcript)" : "(stored preview)"}
                                        </p>
                                        <span className="text-[10px] text-muted-foreground font-mono">{requestFull.length.toLocaleString()} chars</span>
                                      </div>
                                      <pre className="text-xs font-mono text-foreground/90 bg-background/60 border border-border rounded-md px-2.5 py-2 whitespace-pre-wrap break-words max-h-[70vh] overflow-y-auto">
                                        {requestFull}
                                      </pre>
                                    </div>
                                  ) : null}
                                  {responseFull ? (
                                    <div>
                                      <div className="flex items-center justify-between gap-2 mb-1">
                                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Upstream response</p>
                                        <span className="text-[10px] text-muted-foreground font-mono">{responseFull.length.toLocaleString()} chars</span>
                                      </div>
                                      <pre className="text-xs font-mono text-foreground/90 bg-background/60 border border-border rounded-md px-2.5 py-2 whitespace-pre-wrap break-words max-h-[70vh] overflow-y-auto">
                                        {responseFull}
                                      </pre>
                                    </div>
                                  ) : null}
                                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-xs text-muted-foreground">
                                    {log.endpointPath && (
                                      <div>Endpoint: <span className="font-mono text-foreground/80">{log.endpointPath}</span></div>
                                    )}
                                    {log.sessionId && (
                                      <div>Session: <span className="font-mono text-foreground/80">{log.sessionId}</span></div>
                                    )}
                                    {tools.length > 0 && (
                                      <div className="sm:col-span-2 lg:col-span-3">Tools: <span className="font-mono text-foreground/80">{tools.join(", ")}</span></div>
                                    )}
                                    <div>
                                      Tokens: in {formatNumber(log.promptTokens || 0)} / out {formatNumber(log.completionTokens || 0)} / total {formatNumber(log.totalTokens || 0)}
                                    </div>
                                  </div>
                                  {!log.errorMessage && !requestFull && !responseFull && log.statusCode < 400 && (
                                    <p className="text-xs text-muted-foreground">No stored preview for this successful request.</p>
                                  )}
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-7 text-xs"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const paste = [
                                        `Status: ${log.statusCode} ${statusLabel(log.statusCode)}`,
                                        statusDetail(log.statusCode) ? `Detail: ${statusDetail(log.statusCode)}` : "",
                                        log.errorMessage ? `Error: ${log.errorMessage}` : "",
                                        `Model: ${log.model}`,
                                        `Provider: ${log.provider || "-"}`,
                                        `IDE: ${log.ideDetected || "-"}`,
                                        `Endpoint: ${log.endpointPath || "-"}`,
                                        `Latency: ${log.latencyMs}ms`,
                                        `Time: ${formatDate(log.createdAt)}`,
                                        requestFull ? `\nRequest:\n${requestFull}` : "",
                                        responseFull ? `\nResponse:\n${responseFull}` : "",
                                      ].filter(Boolean).join("\n");
                                      void copyToClipboard(paste).then(() => notify.success("Copied log detail"));
                                    }}
                                  >
                                    <Copy className="h-3 w-3 mr-1.5" /> Copy for debug
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                    {keyLogs.length === 0 && (
                      <tr>
                        <td colSpan={11} className="text-center py-8 text-muted-foreground">
                          {keyLogsLoading
                            ? "Loading logs..."
                            : keyLogsError
                              ? `Failed to load logs: ${keyLogsError}`
                              : "No request logs for this period."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Device Sessions Tab */}
        <TabsContent value="sessions" className="space-y-4">
          <Card className="border-border/50">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base">Top Devices by Token Usage</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[720px]">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="text-left py-3 px-4 text-muted-foreground font-medium">Device</th>
                    <th className="text-left py-3 px-4 text-muted-foreground font-medium">IP</th>
                    <th className="text-left py-3 px-4 text-muted-foreground font-medium">IDE / OS</th>
                    <th className="text-right py-3 px-4 text-muted-foreground font-medium">Sessions</th>
                    <th className="text-right py-3 px-4 text-muted-foreground font-medium">Prompts</th>
                    <th className="text-right py-3 px-4 text-muted-foreground font-medium">Tokens</th>
                    <th className="text-left py-3 px-4 text-muted-foreground font-medium">Last Seen</th>
                  </tr>
                </thead>
                <tbody>
                  {(keyData.analytics?.topDevices || []).map((d, idx) => (
                    <tr key={`top-device-${idx}`} className="border-b border-border/30 hover:bg-accent/30">
                      <td className="py-2 px-4 text-xs font-mono">{d.deviceFingerprint ? `${d.deviceFingerprint.substring(0, 16)}...` : "unknown"}</td>
                      <td className="py-2 px-4 text-xs font-mono">{d.ipAddress || "?"}</td>
                      <td className="py-2 px-4 text-xs">
                        <div>{d.ideDetected || "Unknown IDE"}</div>
                        <div className="text-[10px] text-muted-foreground">{d.osDetected || "Unknown OS"}</div>
                      </td>
                      <td className="py-2 px-4 text-right font-mono text-xs">{d.sessions || 0}</td>
                      <td className="py-2 px-4 text-right font-mono text-xs">{d.requests || 0}</td>
                      <td className="py-2 px-4 text-right font-mono text-xs">{formatNumber(d.tokens || 0)}</td>
                      <td className="py-2 px-4 text-xs text-muted-foreground">
                        {d.lastSeen ? (
                          <>
                            <div>{formatDate(d.lastSeen)}</div>
                            <div className="text-[10px]">{formatRelativeTime(d.lastSeen)}</div>
                          </>
                        ) : "?"}
                      </td>
                    </tr>
                  ))}
                  {(keyData.analytics?.topDevices || []).length === 0 && (
                    <tr>
                      <td colSpan={7} className="text-center py-8 text-muted-foreground">No device usage analytics yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base">Session Timeline per Device</CardTitle>
              <Button variant="outline" size="sm" onClick={handleExportSessions}>
                <Download className="h-4 w-4 mr-2" /> Export XLSX
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[720px]">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="text-left py-3 px-4 text-muted-foreground font-medium">Session</th>
                    <th className="text-left py-3 px-4 text-muted-foreground font-medium">Device</th>
                    <th className="text-left py-3 px-4 text-muted-foreground font-medium">Model</th>
                    <th className="text-right py-3 px-4 text-muted-foreground font-medium">Requests</th>
                    <th className="text-right py-3 px-4 text-muted-foreground font-medium">Tokens</th>
                    <th className="text-right py-3 px-4 text-muted-foreground font-medium">Context</th>
                    <th className="text-left py-3 px-4 text-muted-foreground font-medium">Last Seen</th>
                  </tr>                </thead>
                <tbody>
                  {(keyData.analytics?.deviceSessions || []).map((s, idx) => (
                    <tr
                      key={`session-row-${idx}`}
                      className={`border-b border-border/30 hover:bg-accent/30 cursor-pointer ${selectedSessionId === s.sessionId ? "bg-accent/30" : ""}`}
                      onClick={() => {
                        setSelectedSessionId(s.sessionId);
                        void loadSessionDetail(s.sessionId);
                        navigate(`/sessions/${encodeURIComponent(s.sessionId)}`);
                      }}
                    >
                      <td className="py-2 px-4 text-xs">
                        <div className="font-medium truncate max-w-[220px]" title={s.sessionName || s.sessionId}>
                          {s.sessionName && s.sessionName.trim() ? s.sessionName : "Untitled Chat"}
                        </div>
                        <div className="text-[10px] font-mono text-muted-foreground">{s.sessionId ? `${s.sessionId.substring(0, 16)}?` : "?"}</div>
                      </td>
                      <td className="py-2 px-4 text-xs font-mono">{s.deviceFingerprint ? `${s.deviceFingerprint.substring(0, 16)}...` : "unknown"}</td>
                      <td className="py-2 px-4 text-xs"><code className="text-[10px] bg-accent/50 px-1.5 py-0.5 rounded">{s.model || "unknown"}</code></td>
                      <td className="py-2 px-4 text-right font-mono text-xs">{s.requestCount || 0}</td>
                      <td className="py-2 px-4 text-right font-mono text-xs">{formatNumber(s.totalTokens || 0)}</td>
                      <td className="py-2 px-4 text-right font-mono text-xs">{formatNumber(s.lastContextTokens || 0)}</td>
                      <td className="py-2 px-4 text-xs text-muted-foreground">
                        {s.lastSeenAt ? (
                          <>
                            <div>{formatDate(s.lastSeenAt)}</div>
                            <div className="text-[10px]">{formatRelativeTime(s.lastSeenAt)}</div>
                          </>
                        ) : "?"}
                      </td>
                    </tr>
                  ))}
                  {(keyData.analytics?.deviceSessions || []).length === 0 && (
                    <tr>
                      <td colSpan={7} className="text-center py-8 text-muted-foreground">No session timeline recorded for this key yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="text-base">Selected Session Detail</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {sessionDetailLoading ? (
                <div className="text-sm text-muted-foreground">Loading selected session...</div>
              ) : !selectedSessionDetail ? (
                <div className="text-sm text-muted-foreground">Click one session row above to inspect activity timeline.</div>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="rounded-lg border border-border/50 p-3">
                      <p className="text-[11px] text-muted-foreground">Session</p>
                      <p className="font-mono text-xs mt-1">{selectedSessionDetail.session.sessionId}</p>
                    </div>
                    <div className="rounded-lg border border-border/50 p-3">
                      <p className="text-[11px] text-muted-foreground">Device / IDE</p>
                      <p className="text-xs mt-1">{selectedSessionDetail.session.ideDetected || "Unknown"}</p>
                      <p className="font-mono text-[10px] text-muted-foreground mt-1">{selectedSessionDetail.session.deviceFingerprint || "-"}</p>
                    </div>
                    <div className="rounded-lg border border-border/50 p-3">
                      <p className="text-[11px] text-muted-foreground">Requests / Tokens</p>
                      <p className="text-sm mt-1">{formatNumber(selectedSessionDetail.session.requestCount)} / {formatNumber(selectedSessionDetail.session.totalTokens)}</p>
                    </div>
                  </div>

                  <div className="overflow-x-auto rounded-lg border border-border/50">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border/50">
                          <th className="text-left py-3 px-3 text-muted-foreground font-medium text-xs">Time</th>
                          <th className="text-left py-3 px-3 text-muted-foreground font-medium text-xs">Event</th>
                          <th className="text-left py-3 px-3 text-muted-foreground font-medium text-xs">Tools</th>
                          <th className="text-right py-3 px-3 text-muted-foreground font-medium text-xs">Tokens</th>
                          <th className="text-right py-3 px-3 text-muted-foreground font-medium text-xs">Latency</th>
                          <th className="text-center py-3 px-3 text-muted-foreground font-medium text-xs">Status</th>
                          <th className="text-left py-3 px-3 text-muted-foreground font-medium text-xs">User Prompt</th>
                          <th className="text-left py-3 px-3 text-muted-foreground font-medium text-xs">Assistant Reply</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedSessionDetail.timeline.map((row) => (
                          <tr key={row.id} className="border-b border-border/30">
                            <td className="py-2 px-3 text-xs text-muted-foreground">{formatRelativeTime(row.createdAt)}</td>
                            <td className="py-2 px-3 text-xs">{row.contextEvent || "append"}</td>
                            <td className="py-2 px-3 text-xs">{(row.toolsUsed || []).length ? (row.toolsUsed || []).join(", ") : "-"}</td>
                            <td className="py-2 px-3 text-right font-mono text-xs">{formatNumber(row.totalTokens || 0)}</td>
                            <td className="py-2 px-3 text-right text-xs text-muted-foreground">{row.latencyMs}ms</td>
                            <td className="py-2 px-3 text-center">
                              <Badge variant={row.statusCode >= 400 ? "destructive" : "success"} className="text-[10px]">
                                {row.statusCode}
                              </Badge>
                            </td>
                            <td className="py-2 px-3 text-xs text-muted-foreground max-w-[340px] truncate">{row.requestPreview || "-"}</td>
                            <td className="py-2 px-3 text-xs text-muted-foreground max-w-[340px] truncate">{row.responsePreview || "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Top Models Tab */}
        <TabsContent value="models">
          {/* Controls */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            {/* Period toggle */}
            <div className="flex gap-1">
              {([{ label: "Today", days: 1 }, { label: "7 Days", days: 7 }, { label: "30 Days", days: 30 }, { label: "All Time", days: 0 }]).map(o => (
                <button key={o.days} onClick={() => setModelTabDays(o.days)}
                  className={`px-2 py-1 text-xs rounded transition-colors ${modelTabDays === o.days ? "bg-accent text-accent-foreground font-medium" : "text-muted-foreground hover:text-foreground"}`}>
                  {o.label}
                </button>
              ))}
            </div>
            {/* Sort toggle */}
            <div className="flex gap-1 ml-2">
              {(["tokens", "requests"] as const).map(s => (
                <button key={s} onClick={() => setModelTabSort(s)}
                  className={`px-2 py-1 text-xs rounded transition-colors ${modelTabSort === s ? "bg-primary text-primary-foreground font-medium" : "text-muted-foreground hover:text-foreground"}`}>
                  By {s === "tokens" ? "Tokens" : "Prompts"}
                </button>
              ))}
            </div>
          </div>

          {/* Bar Chart */}
          <Card className="border-border/50 mb-4">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium">
                Model Usage (limit credit) - {modelTabSort === "tokens" ? "By Tokens" : "By Prompts"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {modelTabData.length > 0 ? (
                <ChartBox className="!h-[240px] lg:!h-[240px]">
                    <BarChart data={modelTabData.slice(0, 10)}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis
                        dataKey="model"
                        tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                        tickFormatter={(v) => v?.split("/").pop()?.substring(0, 14) || v}
                      />
                      <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                      <Tooltip
                        contentStyle={TOOLTIP_STYLE}
                        itemStyle={ITEM_STYLE}
                        labelStyle={LABEL_STYLE}
                        formatter={(v: number) => formatNumber(v)}
                      />
                      <Bar
                        dataKey={modelTabSort === "tokens" ? "tokens" : "requests"}
                        fill="#818cf8"
                        radius={[4, 4, 0, 0]}
                        name={modelTabSort === "tokens" ? "Tokens" : "Requests"}
                      />
                    </BarChart>
                </ChartBox>
              ) : (
                <div className="flex items-center justify-center h-[240px] text-muted-foreground text-sm">
                  {modelTabLoading ? "Loading..." : "No model usage data yet."}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Unified Table */}
          <Card className="border-border/50">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[720px]">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="text-left py-3 px-4 text-muted-foreground font-medium">#</th>
                    <th className="text-left py-3 px-4 text-muted-foreground font-medium">Model</th>
                    <th className="text-right py-3 px-4 text-muted-foreground font-medium">Requests</th>
                    <th className="text-right py-3 px-4 text-muted-foreground font-medium">Input (limit)</th>
                    <th className="text-right py-3 px-4 text-muted-foreground font-medium">Output Tokens</th>
                    <th className="text-right py-3 px-4 text-muted-foreground font-medium">Total (limit)</th>
                    <th className="text-right py-3 px-4 text-muted-foreground font-medium">Avg Latency</th>
                    <th className="text-right py-3 px-4 text-muted-foreground font-medium">Est. Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {modelTabData.slice(0, 20).map((m, idx) => (
                    <tr key={m.model || idx} className="border-b border-border/30 hover:bg-accent/30">
                      <td className="py-2 px-4 text-xs text-muted-foreground font-bold">{idx + 1}</td>
                      <td className="py-2 px-4">
                        <code className="text-xs bg-accent/50 px-2 py-1 rounded">{m.model || "unknown"}</code>
                      </td>
                      <td className="py-2 px-4 text-right font-mono text-xs">{formatNumber(m.requests || 0)}</td>
                      <td className="py-2 px-4 text-right font-mono text-xs text-blue-400">{formatNumber(m.promptTokens || 0)}</td>
                      <td className="py-2 px-4 text-right font-mono text-xs text-purple-400">{formatNumber(m.completionTokens || 0)}</td>
                      <td className="py-2 px-4 text-right font-mono text-xs font-semibold">{formatNumber(m.tokens || 0)}</td>
                      <td className="py-2 px-4 text-right text-xs text-muted-foreground">{m.avgLatency ? `${m.avgLatency}ms` : "?"}</td>
                      <td className="py-2 px-4 text-right font-mono text-xs text-emerald-400">{formatCost(m.estimatedCost || 0)}</td>
                    </tr>
                  ))}
                  {modelTabData.length === 0 && (
                    <tr>
                      <td colSpan={8} className="text-center py-8 text-muted-foreground text-sm">
                        {modelTabLoading ? "Loading..." : "No model usage data yet."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Delete Dialog */}
      <Dialog open={showDelete} onOpenChange={setShowDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete API Key</DialogTitle>
            <DialogDescription>
              This will permanently delete "{keyData.name}" and all associated device records. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDelete(false)} disabled={deleting}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rotate Dialog */}
      <Dialog open={showRotate} onOpenChange={(v) => { setShowRotate(v); if (!v) setRotatedKey(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{rotatedKey ? "Key Rotated" : "Rotate API Key"}</DialogTitle>
            <DialogDescription>
              {rotatedKey
                ? "Copy the new key now. The old key is now invalid."
                : "This will invalidate the current key and generate a new one. All clients will need to update."}
            </DialogDescription>
          </DialogHeader>
          {rotatedKey ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 p-3 bg-accent/50 rounded-lg">
                <code className="flex-1 text-sm font-mono break-all">{rotatedKey}</code>
                <Button size="icon" variant="ghost" onClick={() => handleCopy(rotatedKey)}>
                  {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <DialogFooter>
                <Button onClick={() => { setShowRotate(false); setRotatedKey(null); }}>Done</Button>
              </DialogFooter>
            </div>
          ) : (
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowRotate(false)}>Cancel</Button>
              <Button variant="destructive" onClick={handleRotate}>Rotate Key</Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

