import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { keys, logs, stats, type ApiKeyDetail, type KeyPeriodStats, type LogEntry, type SessionDetailResponse, type ModelLimitEntry, globalSettings } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate, formatNumber, formatRelativeTime, copyToClipboard, formatCost } from "@/lib/utils";
import { ArrowLeft, Copy, Check, RotateCw, Trash2, Shield, ShieldOff, X, Download, DollarSign } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter, DialogTrigger
} from "@/components/ui/dialog";
import { useRealtimeSSE } from "@/lib/use-realtime-sse";
import { exportXlsx, buildLogsSection, buildSessionsSection, fmtCost } from "@/lib/export-xlsx";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

const TOOLTIP_STYLE  = { backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "12px", color: "hsl(var(--foreground))" };
const ITEM_STYLE     = { color: "hsl(var(--foreground))" };
const LABEL_STYLE    = { color: "hsl(var(--foreground))" };
const MODEL_COLORS   = ["#818cf8", "#34d399", "#f59e0b", "#f87171", "#a78bfa", "#38bdf8", "#fb923c", "#e879f9"];

export default function KeyDetailPage() {
  const { id: idSlug } = useParams<{ id: string }>();
  // Slug format is "{numericId}-{name-slug}" â€” extract just the numeric ID prefix
  const id = idSlug?.split("-")[0];
  const navigate = useNavigate();
  const [keyData, setKeyData] = useState<ApiKeyDetail | null>(null);
  const [deviceList, setDeviceList] = useState<any[]>([]);
  const [keyLogs, setKeyLogs] = useState<LogEntry[]>([]);
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
  const [showRotate, setShowRotate] = useState(false);
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

  // Models tab state
  const [modelTabDays, setModelTabDays] = useState(0); // 0 = all time
  const [modelTabData, setModelTabData] = useState<any[]>([]);
  const [modelTabSort, setModelTabSort] = useState<"tokens" | "requests">("tokens");
  const [modelTabLoading, setModelTabLoading] = useState(false);

  // Per-key model limits state
  const [keyModelLimits, setKeyModelLimits] = useState<ModelLimitEntry[]>([]);
  const [keyModelCatalog, setKeyModelCatalog] = useState<string[]>([]);
  const [newKeyModelOverride, setNewKeyModelOverride] = useState("");
  const [newKeyModelOverrideLimit, setNewKeyModelOverrideLimit] = useState(0);
  const [newKeyModelOverrideDailyTokenLimit, setNewKeyModelOverrideDailyTokenLimit] = useState(0);
  const [newKeyModelOverrideMonthlyTokenLimit, setNewKeyModelOverrideMonthlyTokenLimit] = useState(0);
  const [newKeyModelOverrideDailyInputTokenLimit, setNewKeyModelOverrideDailyInputTokenLimit] = useState(0);
  const [newKeyModelOverrideDailyOutputTokenLimit, setNewKeyModelOverrideDailyOutputTokenLimit] = useState(0);

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
  useRealtimeSSE(handleSSEMessage, 500);

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
    try {
      const params: Record<string, string> = { api_key_id: id, limit: "100" };
      if (period > 0) {
        const from = new Date(Date.now() - period * 24 * 60 * 60 * 1000);
        params.from = from.toISOString().replace("T", " ").substring(0, 19);
      }
      const l = await logs.list(params);
      setKeyLogs(l.data);
    } catch (err) {
      console.error("[KeyDetail] Failed to load logs:", err);
    }
  }, [id]);

  useEffect(() => { void loadLogs(logsPeriod); }, [logsPeriod, loadLogs]);

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
    await keys.delete(parseInt(id));
    navigate("/keys");
  };

  const handleRotate = async () => {
    if (!id) return;
    const res = await keys.rotate(parseInt(id));
    setRotatedKey(res.key);
    loadAll();
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
          ["Requests",        s.today.requests,         s.week.requests,         s.month.requests,         s.allTime.requests],
          ["Total Tokens",    s.today.tokens,           s.week.tokens,           s.month.tokens,           s.allTime.tokens],
          ["Input Tokens",    s.today.promptTokens,     s.week.promptTokens,     s.month.promptTokens,     s.allTime.promptTokens],
          ["Output Tokens",   s.today.completionTokens, s.week.completionTokens, s.month.completionTokens, s.allTime.completionTokens],
          ["Context Tokens",  s.today.contextTokens,    s.week.contextTokens,    s.month.contextTokens,    s.allTime.contextTokens],
          ["Est. Cost",       fmtCost(s.today.estimatedCost), fmtCost(s.week.estimatedCost), fmtCost(s.month.estimatedCost), fmtCost(s.allTime.estimatedCost)],
        ],
      });
    }

    // Sheet 2: Request logs (filtered by period)
    sheets.push(buildLogsSection(keyLogs, `Request Logs (${periodLabel})`));

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
          ["Requests",   s.today.requests,  s.week.requests,  s.month.requests,  s.allTime.requests],
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
          <Button variant="destructive" size="sm" onClick={() => setShowDelete(true)}>
            <Trash2 className="h-3 w-3 mr-1" /> Delete
          </Button>
        </div>
      </div>

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
                { label: "Requests",      value: formatNumber(s.requests) },
                { label: "Total Tokens",  value: formatNumber(s.tokens) },
                { label: "Input Tokens",  value: formatNumber(s.promptTokens) },
                { label: "Output Tokens", value: formatNumber(s.completionTokens) },
                { label: "Context Tokens",value: formatNumber(s.contextTokens) },
                { label: "Est. Cost",     value: `$${(s.estimatedCost/1e6).toFixed(4)}` },
                { label: "Devices",       value: keyData.stats.deviceCount.toString() },
              ].map(c => (
                <Card key={c.label} className="border-border/50">
                  <CardContent className="p-3">
                    <p className="text-[10px] text-muted-foreground">{c.label}</p>
                    <p className="text-lg font-bold mt-1 truncate">{c.value}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          );
        })()}
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
    </div>
    <div>
      <Label>Prompt Limit Window</Label>
      <Input
        value={keyData?.promptLimitWindow || "1d"}
        onChange={(e) => {
          if (!editing) return;
          setKeyData(prev => prev ? { ...prev, promptLimitWindow: e.target.value } : prev);
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
          <p className="text-[10px] text-muted-foreground">Override the default limits for specific models on this key.</p>
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
                <Label>Model</Label>
                <select
                  className="w-full mt-1 px-3 py-2 text-sm rounded-md border border-border bg-background"
                  value={newKeyModelOverride}
                  onChange={(e) => {
                    const model = e.target.value;
                    setNewKeyModelOverride(model);
                    const existing = keyModelLimits.find(ml => ml.model === model);
                    if (existing) {
                      setNewKeyModelOverrideLimit(existing.promptLimit || 0);
                      setNewKeyModelOverrideDailyTokenLimit(existing.dailyTokenLimit || 0);
                      setNewKeyModelOverrideMonthlyTokenLimit(existing.monthlyTokenLimit || 0);
                      setNewKeyModelOverrideDailyInputTokenLimit(existing.dailyInputTokenLimit || 0);
                      setNewKeyModelOverrideDailyOutputTokenLimit(existing.dailyOutputTokenLimit || 0);
                    } else {
                      setNewKeyModelOverrideLimit(0);
                      setNewKeyModelOverrideDailyTokenLimit(0);
                      setNewKeyModelOverrideMonthlyTokenLimit(0);
                      setNewKeyModelOverrideDailyInputTokenLimit(0);
                      setNewKeyModelOverrideDailyOutputTokenLimit(0);
                    }
                  }}
                >
                  <option value="">Select model...</option>
                  {keyModelCatalog.map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
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
              <div className="col-span-2 md:col-span-3 flex justify-end">
                <Button onClick={async () => {
                  if (!id || !newKeyModelOverride) return;
                  await keys.setModelLimit(parseInt(id), newKeyModelOverride, {
                    promptLimit: newKeyModelOverrideLimit,
                    dailyTokenLimit: newKeyModelOverrideDailyTokenLimit,
                    monthlyTokenLimit: newKeyModelOverrideMonthlyTokenLimit,
                    dailyInputTokenLimit: newKeyModelOverrideDailyInputTokenLimit,
                    dailyOutputTokenLimit: newKeyModelOverrideDailyOutputTokenLimit
                  });
                  setNewKeyModelOverride(""); 
                  setNewKeyModelOverrideLimit(0);
                  setNewKeyModelOverrideDailyTokenLimit(0);
                  setNewKeyModelOverrideMonthlyTokenLimit(0);
                  setNewKeyModelOverrideDailyInputTokenLimit(0);
                  setNewKeyModelOverrideDailyOutputTokenLimit(0);
                  const ml = await keys.getModelLimits(parseInt(id)); setKeyModelLimits(ml.data || []);
                }}>Save Model Override</Button>
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
                        <tr key={ml.id} className="hover:bg-muted/50">
                          <td className="p-2 font-mono">{ml.model}</td>
                          <td className="p-2">{ml.promptLimit || '-'}</td>
                          <td className="p-2">{ml.dailyTokenLimit || '-'}</td>
                          <td className="p-2">{ml.monthlyTokenLimit || '-'}</td>
                          <td className="p-2">{ml.dailyInputTokenLimit || '-'}</td>
                          <td className="p-2">{ml.dailyOutputTokenLimit || '-'}</td>
                          <td className="p-2 text-right">
                            <Button size="icon" variant="ghost" className="h-6 w-6 text-red-500 hover:text-red-600 hover:bg-red-500/10" onClick={async () => {
                              if (!id) return;
                              await keys.deleteModelLimit(parseInt(id), ml.model);
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
              <table className="w-full text-sm">
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
              <table className="w-full text-sm">
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
            </CardContent>
          </Card>

          {statusText ? <p className="text-xs text-muted-foreground">{statusText}</p> : null}
        </TabsContent>

        {/* Devices Tab */}
        <TabsContent value="devices">
          <Card className="border-border/50">
            <CardContent className="p-0">
              <table className="w-full text-sm">
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
                      <td className="py-2 px-4 text-sm">{d.ipAddress || "â€”"}</td>
                      <td className="py-2 px-4 text-sm">{d.ideDetected || "â€”"}</td>
                      <td className="py-2 px-4 text-sm">{d.osDetected || "â€”"}</td>
                      <td className="py-2 px-4 text-xs">{d.deviceName || "â€”"}</td>
                      <td className="py-2 px-4 text-xs text-muted-foreground">
                        {d.firstSeen ? (
                          <>
                            <div>{formatDate(d.firstSeen)}</div>
                            <div className="text-[10px]">{formatRelativeTime(d.firstSeen)}</div>
                          </>
                        ) : "â€”"}
                      </td>
                      <td className="py-2 px-4 text-xs text-muted-foreground">
                        {d.lastSeen ? (
                          <>
                            <div>{formatDate(d.lastSeen)}</div>
                            <div className="text-[10px]">{formatRelativeTime(d.lastSeen)}</div>
                          </>
                        ) : "â€”"}
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
            </CardContent>
          </Card>
        </TabsContent>

        {/* Logs Tab */}
        <TabsContent value="logs">
          <Card className="border-border/50">
            <CardHeader className="flex flex-row items-center justify-between pb-2 flex-wrap gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <CardTitle className="text-base">Request Logs</CardTitle>
                <div className="flex gap-1">
                  {([{l:"Today",v:1},{l:"7 Days",v:7},{l:"30 Days",v:30},{l:"All",v:0}] as const).map(o => (
                    <button key={o.v} onClick={() => setLogsPeriod(o.v as 0|1|7|30)}
                      className={`px-2 py-0.5 text-xs rounded transition-colors ${logsPeriod === o.v ? "bg-primary text-primary-foreground font-medium" : "text-muted-foreground hover:text-foreground border border-border/50"}`}>
                      {o.l}
                    </button>
                  ))}
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={handleExportLogs}>
                <Download className="h-4 w-4 mr-2" /> Export XLSX
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="text-left py-3 px-4 text-muted-foreground font-medium">Time</th>
                    <th className="text-left py-3 px-4 text-muted-foreground font-medium">Model</th>
                    <th className="text-left py-3 px-4 text-muted-foreground font-medium">IDE</th>
                    <th className="text-left py-3 px-4 text-muted-foreground font-medium">Provider</th>
                    <th className="text-left py-3 px-4 text-muted-foreground font-medium">OS / Client</th>
                    <th className="text-left py-3 px-4 text-muted-foreground font-medium">IP</th>
                    <th className="text-left py-3 px-4 text-muted-foreground font-medium">Tools</th>
                    <th className="text-right py-3 px-4 text-muted-foreground font-medium">Tokens</th>
                    <th className="text-right py-3 px-4 text-muted-foreground font-medium">Latency</th>
                    <th className="text-center py-3 px-4 text-muted-foreground font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {keyLogs.map((log) => (
                    <tr key={log.id} className="border-b border-border/30 hover:bg-accent/30">
                      <td className="py-2 px-4 text-xs text-muted-foreground font-mono">
                        <div>{formatDate(log.createdAt)}</div>
                        <div className="text-[10px]">{formatRelativeTime(log.createdAt)}</div>
                      </td>
                      <td className="py-2 px-4">
                        <code className="text-xs bg-accent/50 px-1.5 py-0.5 rounded">{log.model}</code>
                      </td>
                      <td className="py-2 px-4 text-xs">{log.ideDetected}</td>
                      <td className="py-2 px-4 text-xs">{log.provider || "unknown"}</td>
                      <td className="py-2 px-4 text-xs text-muted-foreground">
                        <div>{log.osDetected || "Unknown"}</div>
                        <div className="text-[10px]">{log.clientName || "-"}</div>
                      </td>
                      <td className="py-2 px-4 text-xs font-mono">{log.ipAddress}</td>
                      <td className="py-2 px-4 text-xs">{(log.toolsUsed || []).length ? (log.toolsUsed || []).slice(0, 2).join(", ") : "â€”"}</td>
                      <td className="py-2 px-4 text-right font-mono text-xs">{formatNumber(log.totalTokens)}</td>
                      <td className="py-2 px-4 text-right text-xs text-muted-foreground">{log.latencyMs}ms</td>
                      <td className="py-2 px-4 text-center">
                        <Badge variant={log.statusCode >= 400 ? "destructive" : "success"} className="text-[10px]">
                          {log.statusCode}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="text-left py-3 px-4 text-muted-foreground font-medium">Device</th>
                    <th className="text-left py-3 px-4 text-muted-foreground font-medium">IP</th>
                    <th className="text-left py-3 px-4 text-muted-foreground font-medium">IDE / OS</th>
                    <th className="text-right py-3 px-4 text-muted-foreground font-medium">Sessions</th>
                    <th className="text-right py-3 px-4 text-muted-foreground font-medium">Requests</th>
                    <th className="text-right py-3 px-4 text-muted-foreground font-medium">Tokens</th>
                    <th className="text-left py-3 px-4 text-muted-foreground font-medium">Last Seen</th>
                  </tr>
                </thead>
                <tbody>
                  {(keyData.analytics?.topDevices || []).map((d, idx) => (
                    <tr key={`top-device-${idx}`} className="border-b border-border/30 hover:bg-accent/30">
                      <td className="py-2 px-4 text-xs font-mono">{d.deviceFingerprint ? `${d.deviceFingerprint.substring(0, 16)}...` : "unknown"}</td>
                      <td className="py-2 px-4 text-xs font-mono">{d.ipAddress || "â€”"}</td>
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
                        ) : "â€”"}
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
              <table className="w-full text-sm">
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
                        <div className="text-[10px] font-mono text-muted-foreground">{s.sessionId ? `${s.sessionId.substring(0, 16)}â€¦` : "â€”"}</div>
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
                        ) : "â€”"}
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
                  By {s === "tokens" ? "Tokens" : "Requests"}
                </button>
              ))}
            </div>
          </div>

          {/* Bar Chart */}
          <Card className="border-border/50 mb-4">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium">
                Model Usage Chart â€” {modelTabSort === "tokens" ? "By Tokens" : "By Requests"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[240px]">
                {modelTabData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
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
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                    {modelTabLoading ? "Loading..." : "No model usage data yet."}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Unified Table */}
          <Card className="border-border/50">
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="text-left py-3 px-4 text-muted-foreground font-medium">#</th>
                    <th className="text-left py-3 px-4 text-muted-foreground font-medium">Model</th>
                    <th className="text-right py-3 px-4 text-muted-foreground font-medium">Requests</th>
                    <th className="text-right py-3 px-4 text-muted-foreground font-medium">Input Tokens</th>
                    <th className="text-right py-3 px-4 text-muted-foreground font-medium">Output Tokens</th>
                    <th className="text-right py-3 px-4 text-muted-foreground font-medium">Total Tokens</th>
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
                      <td className="py-2 px-4 text-right text-xs text-muted-foreground">{m.avgLatency ? `${m.avgLatency}ms` : "â€”"}</td>
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
            <Button variant="outline" onClick={() => setShowDelete(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete}>Delete</Button>
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

