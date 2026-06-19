import { useEffect, useState, useCallback, useMemo } from "react";
import { monitor, type ModelMonitorEntry } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatRelativeTime, formatDate } from "@/lib/utils";
import { Download, RefreshCw, Activity, ServerCrash, CheckCircle2, Clock, Zap, Power } from "lucide-react";
import { exportXlsx } from "@/lib/export-xlsx";

function modelVendorOf(modelId: string) {
  return modelId.includes("/") ? modelId.split("/")[0] : "unknown";
}

export default function ModelMonitorPage() {
  const [activeTab, setActiveTab] = useState<"monitor" | "catalog">("monitor");
  const [data, setData] = useState<ModelMonitorEntry[]>([]);
  const [summary, setSummary] = useState({ total: 0, online: 0, offline: 0, timeout: 0 });
  const [loading, setLoading] = useState(true);
  const [upstreamFilter, setUpstreamFilter] = useState("all");
  const [modelVendorFilter, setModelVendorFilter] = useState("all");
  const [sortMode, setSortMode] = useState("status");
  const [catalogData, setCatalogData] = useState<any[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [sweepState, setSweepState] = useState<{ running: boolean; progress: any }>({ running: false, progress: null });
  const [sweepInterval, setSweepInterval] = useState<ReturnType<typeof setInterval> | null>(null);

  const handleSweep = async () => {
    try {
      await monitor.triggerSweep();
      setSweepState({ running: true, progress: null });
      // Poll every 1.5s for snappier feedback; also pull model table on every
      // tick so the user sees results appear in real time (instead of only
      // after the entire sweep completes).
      const interval = setInterval(async () => {
        try {
          const progress = await monitor.getSweepProgress();
          setSweepState({ running: progress.status === "running", progress });
          if (progress.status === "running") {
            // Realtime refresh: pull model table every tick
            const res = await monitor.getModels();
            setData(res.data);
            setSummary(res.summary);
          }
          if (progress.status !== "running") {
            clearInterval(interval);
            setSweepInterval(null);
            // Wait 2s for all DB writes to fully commit, then refresh
            setTimeout(() => loadData(), 2000);
          }
        } catch {}
      }, 1500);
      setSweepInterval(interval);
    } catch (err) {
      console.error("Sweep failed:", err);
    }
  };

  // Cleanup interval on unmount
  useEffect(() => {
    return () => { if (sweepInterval) clearInterval(sweepInterval); };
  }, [sweepInterval]);

  const handleActivate = async (d: ModelMonitorEntry) => {
    if (!confirm(`Force-activate model "${d.modelId}"? Next sweep will verify the real status.`)) return;
    try {
      await monitor.activate(d.modelId, d.provider || "");
      await loadData();
    } catch (err) {
      console.error("Activate failed:", err);
      alert(`Activate failed: ${(err as any)?.message || err}`);
    }
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await monitor.getModels();
      setData(res.data);
      setSummary(res.summary);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    try {
      const res = await monitor.getModelDetails();
      setCatalogData(res.data || []);
    } catch {}
    setCatalogLoading(false);
  }, []);

  useEffect(() => {
    if (activeTab === "catalog" && catalogData.length === 0) {
      loadCatalog();
    }
  }, [activeTab, catalogData.length, loadCatalog]);

  const handleExport = () => {
    const online  = data.filter(d => d.isOnline);
    const offline = data.filter(d => !d.isOnline);
    const dateStr = new Date().toISOString().split("T")[0];

    const makeRows = (items: typeof data) => items.map(d => [
      d.modelId,
      d.provider || "unknown",
      modelVendorOf(d.modelId),
      d.isOnline ? "Online" : "Offline",
      Number(d.latencyMs) || 0,
      d.httpStatus || "",
      d.errorMessage || "",
      d.checkedAt,
      d.baseUrl || "",
    ]);

    exportXlsx([
      {
        name: "All Models",
        note: `${summary.online} online, ${summary.offline} offline, ${summary.timeout} timeout  -  as of ${new Date().toLocaleString()}`,
        headers: ["Model", "Upstream", "Vendor", "Status", "Latency (ms)", "HTTP Status", "Error", "Last Checked", "Base URL"],
        rows: makeRows(data),
      },
      {
        name: "Online",
        headers: ["Model", "Upstream", "Vendor", "Status", "Latency (ms)", "HTTP Status", "Error", "Last Checked", "Base URL"],
        rows: makeRows(online),
      },
      {
        name: "Offline",
        headers: ["Model", "Upstream", "Vendor", "Status", "Latency (ms)", "HTTP Status", "Error", "Last Checked", "Base URL"],
        rows: makeRows(offline),
      },
    ], `model-monitor-${dateStr}`, {
      title: "AI Proxy Gateway  -  Model Health Monitor",
      period: `Checked at ${new Date().toLocaleTimeString()}`,
    });
  };

  const upstreamOptions = useMemo(
    () => ["all", ...new Set(data.map(d => d.provider || "unknown"))].sort(),
    [data],
  );

  const vendorOptions = useMemo(() => {
    let rows = data;
    if (upstreamFilter !== "all") {
      rows = rows.filter(d => (d.provider || "unknown") === upstreamFilter);
    }
    return ["all", ...new Set(rows.map(d => modelVendorOf(d.modelId)))].sort();
  }, [data, upstreamFilter]);

  useEffect(() => {
    if (modelVendorFilter !== "all" && !vendorOptions.includes(modelVendorFilter)) {
      setModelVendorFilter("all");
    }
  }, [vendorOptions, modelVendorFilter]);

  let filtered = [...data];
  if (upstreamFilter !== "all") {
    filtered = filtered.filter(d => (d.provider || "unknown") === upstreamFilter);
  }
  if (modelVendorFilter !== "all") {
    filtered = filtered.filter(d => modelVendorOf(d.modelId) === modelVendorFilter);
  }

  filtered.sort((a, b) => {
    if (sortMode === "name") return a.modelId.localeCompare(b.modelId);
    if (sortMode === "latency") return (a.latencyMs || 999999) - (b.latencyMs || 999999);
    if (a.isOnline && !b.isOnline) return -1;
    if (!a.isOnline && b.isOnline) return 1;
    return (a.latencyMs || 0) - (b.latencyMs || 0);
  });

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Model Monitor</h1>
          <p className="text-muted-foreground mt-1">Real-time status and latency benchmark for upstream AI models</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-muted rounded-lg p-1 gap-1">
            <Button variant={activeTab === "monitor" ? "default" : "ghost"} size="sm" onClick={() => setActiveTab("monitor")}>
              Status Monitor
            </Button>
            <Button variant={activeTab === "catalog" ? "default" : "ghost"} size="sm" onClick={() => setActiveTab("catalog")}>
              Model Catalog
            </Button>
          </div>
          <Button variant="outline" size="sm" onClick={activeTab === "monitor" ? loadData : loadCatalog} disabled={loading || catalogLoading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${(loading || catalogLoading) ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          {activeTab === "monitor" && (
            <>
              <Button variant="destructive" size="sm" onClick={handleSweep} disabled={sweepState.running}>
                <Zap className={`h-4 w-4 mr-2 ${sweepState.running ? "animate-pulse" : ""}`} />
                {sweepState.running && sweepState.progress
                  ? `Sweeping... ${sweepState.progress.tested}/${sweepState.progress.total} (${Math.round((sweepState.progress.tested / Math.max(sweepState.progress.total, 1)) * 100)}%)`
                  : "Test All Models"}
              </Button>
              <Button variant="outline" size="sm" onClick={handleExport}>
                <Download className="h-4 w-4 mr-2" />
                Export XLSX
              </Button>
            </>
          )}
        </div>
      </div>

      {activeTab === "catalog" ? (
        /* ── Model Catalog Tab ── */
        <>
          <Card className="border-border/50">
            <CardContent className="p-4">
              <input
                type="text"
                placeholder="Search models..."
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
                value={catalogSearch}
                onChange={(e) => setCatalogSearch(e.target.value)}
              />
            </CardContent>
          </Card>
          <Card className="border-border/50">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/50 bg-muted/20">
                      <th className="text-center py-3 px-3 font-medium text-muted-foreground w-12">Status</th>
                      <th className="text-left py-3 px-3 font-medium text-muted-foreground">Model</th>
                      <th className="text-right py-3 px-3 font-medium text-muted-foreground">Context/Input</th>
                      <th className="text-right py-3 px-3 font-medium text-muted-foreground">Max Output</th>
                      <th className="text-right py-3 px-3 font-medium text-muted-foreground">Input $/M</th>
                      <th className="text-right py-3 px-3 font-medium text-muted-foreground">Output $/M</th>
                      <th className="text-left py-3 px-3 font-medium text-muted-foreground">Modalities</th>
                      <th className="text-left py-3 px-3 font-medium text-muted-foreground">Features</th>
                      <th className="text-right py-3 px-3 font-medium text-muted-foreground">Latency</th>
                    </tr>
                  </thead>
                  <tbody>
                    {catalogData
                      .filter(m => m.id !== "auto")
                      .filter(m => !catalogSearch || m.id.toLowerCase().includes(catalogSearch.toLowerCase()) || (m.name || "").toLowerCase().includes(catalogSearch.toLowerCase()))
                      .map((m) => (
                        <tr key={m.id} className="data-row hover:bg-muted/10 transition-colors border-b border-border/30">
                          <td className="py-2 px-3 text-center">
                            {m.is_online ? (
                              <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500" title="Online" />
                            ) : (
                              <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500" title="Offline" />
                            )}
                          </td>
                          <td className="py-2 px-3">
                            <div className="font-mono text-xs font-medium">{m.id}</div>
                            {m.name && m.name !== m.id && <div className="text-xs text-muted-foreground mt-0.5">{m.name}</div>}
                          </td>
                          <td className="py-2 px-3 text-right font-mono text-xs">
                            {m.context_length ? `${Math.round(m.context_length / 1024)}K` : "—"}
                          </td>
                          <td className="py-2 px-3 text-right font-mono text-xs">
                            {m.max_output_tokens ? `${Math.round(m.max_output_tokens / 1024)}K` : "—"}
                          </td>
                          <td className="py-2 px-3 text-right font-mono text-xs">
                            {m.pricing?.prompt != null ? `$${m.pricing.prompt.toFixed(2)}` : "—"}
                          </td>
                          <td className="py-2 px-3 text-right font-mono text-xs">
                            {m.pricing?.completion != null ? `$${m.pricing.completion.toFixed(2)}` : "—"}
                          </td>
                          <td className="py-2 px-3">
                            <div className="flex flex-wrap gap-1">
                              {(m.input_modalities || []).map((mod: string) => (
                                <Badge key={`in-${mod}`} variant="outline" className="text-[10px] px-1.5 py-0">{mod}</Badge>
                              ))}
                              <span className="text-muted-foreground text-[10px]">→</span>
                              {(m.output_modalities || []).map((mod: string) => (
                                <Badge key={`out-${mod}`} variant="secondary" className="text-[10px] px-1.5 py-0">{mod}</Badge>
                              ))}
                            </div>
                          </td>
                          <td className="py-2 px-3">
                            <div className="flex flex-wrap gap-1">
                              {(m.supported_features || []).slice(0, 3).map((f: string) => (
                                <Badge key={f} variant="outline" className="text-[10px] px-1.5 py-0 text-blue-400 border-blue-400/30">{f}</Badge>
                              ))}
                            </div>
                          </td>
                          <td className="py-2 px-3 text-right font-mono text-xs">
                            {m.latency_ms != null ? `${m.latency_ms}ms` : "—"}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              {catalogLoading && (
                <div className="text-center py-8 text-muted-foreground">Loading model catalog...</div>
              )}
            </CardContent>
          </Card>
        </>
      ) : (
      /* ── Status Monitor Tab (existing content) ── */
      <>
      {/* Sweep Progress */}
      {sweepState.running && sweepState.progress && (
        <Card className="border-blue-500/50 bg-blue-500/5">
          <CardContent className="p-4">
            <div className="flex items-center gap-3 mb-2">
              <Zap className="h-4 w-4 text-blue-400 animate-pulse" />
              <span className="text-sm font-medium">Testing models... {sweepState.progress.tested}/{sweepState.progress.total}</span>
            </div>
            <div className="w-full bg-muted rounded-full h-2">
              <div
                className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${sweepState.progress.total > 0 ? (sweepState.progress.tested / sweepState.progress.total * 100) : 0}%` }}
              />
            </div>
            <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
              <span className="text-emerald-500">Online: {sweepState.progress.online}</span>
              <span className="text-red-500">Offline: {sweepState.progress.offline}</span>
              <span className="text-amber-500">Rate Limited: {sweepState.progress.rateLimited}</span>
            </div>
          </CardContent>
        </Card>
      )}
      {!sweepState.running && sweepState.progress?.status === "completed" && (
        <Card className="border-emerald-500/50 bg-emerald-500/5">
          <CardContent className="p-3 text-sm text-emerald-500">
            Sweep completed — {sweepState.progress.online} online, {sweepState.progress.offline} offline, {sweepState.progress.rateLimited} rate limited
          </CardContent>
        </Card>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-border/50">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-muted-foreground">Total Models</p>
              <Activity className="h-4 w-4 text-blue-400" />
            </div>
            <p className="text-3xl font-bold mt-2">{summary.total}</p>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-muted-foreground">Online</p>
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            </div>
            <p className="text-3xl font-bold mt-2 text-emerald-500">{summary.online}</p>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-muted-foreground">Offline</p>
              <ServerCrash className="h-4 w-4 text-red-500" />
            </div>
            <p className="text-3xl font-bold mt-2 text-red-500">{summary.offline}</p>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-muted-foreground">Timeout</p>
              <Clock className="h-4 w-4 text-amber-500" />
            </div>
            <p className="text-3xl font-bold mt-2 text-amber-500">{summary.timeout}</p>
          </CardContent>
        </Card>
      </div>

      {/* Controls */}
      <Card className="border-border/50">
        <CardContent className="p-4 flex flex-wrap gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Upstream:</span>
            <Select
              value={upstreamFilter}
              onValueChange={(v) => {
                setUpstreamFilter(v);
                setModelVendorFilter("all");
              }}
            >
              <SelectTrigger className="w-[180px] h-9">
                <SelectValue placeholder="All Upstreams" />
              </SelectTrigger>
              <SelectContent>
                {upstreamOptions.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Vendor:</span>
            <Select value={modelVendorFilter} onValueChange={setModelVendorFilter}>
              <SelectTrigger className="w-[180px] h-9">
                <SelectValue placeholder="All Vendors" />
              </SelectTrigger>
              <SelectContent>
                {vendorOptions.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Sort By:</span>
            <Select value={sortMode} onValueChange={setSortMode}>
              <SelectTrigger className="w-[180px] h-9">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="status">Status (Online First)</SelectItem>
                <SelectItem value="latency">Latency (Fastest First)</SelectItem>
                <SelectItem value="name">Name (A-Z)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="border-border/50">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 bg-muted/20">
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Model</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Upstream</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Vendor</th>
                  <th className="text-center py-3 px-4 font-medium text-muted-foreground">Status</th>
                  <th className="text-right py-3 px-4 font-medium text-muted-foreground">Latency</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">HTTP</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Last Checked</th>
                  <th className="text-center py-3 px-4 font-medium text-muted-foreground">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((d) => (
                  <tr key={`${d.provider || "unknown"}:${d.modelId}`} className="data-row hover:bg-muted/10 transition-colors border-b border-border/30">
                    <td className="py-3 px-4 font-mono text-xs">{d.modelId}</td>
                    <td className="py-3 px-4 text-xs text-muted-foreground">{d.provider || "-"}</td>
                    <td className="py-3 px-4 text-xs text-muted-foreground">{modelVendorOf(d.modelId)}</td>
                    <td className="py-3 px-4 text-center">
                      <Badge variant={d.isOnline ? "success" : "destructive"} className="text-[10px]">
                        {d.isOnline ? "Online" : "Offline"}
                      </Badge>
                    </td>
                    <td className="py-3 px-4 text-right">
                      {d.isOnline ? (
                        <div className="flex items-center justify-end gap-2">
                          <span className="font-mono text-xs">{d.latencyMs}ms</span>
                          <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden flex justify-end">
                            <div 
                              className={`h-full rounded-full ${d.latencyMs! < 1000 ? 'bg-emerald-500' : d.latencyMs! < 3000 ? 'bg-amber-500' : 'bg-red-500'}`} 
                              style={{ width: `${Math.min(100, Math.max(5, (d.latencyMs! / 5000) * 100))}%` }}
                            />
                          </div>
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-xs">-</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <span className={`text-xs ${d.httpStatus === 200 ? 'text-muted-foreground' : 'text-amber-500 font-medium'}`}>
                        {d.httpStatus || "timeout"}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-xs text-muted-foreground">
                      <div>{formatRelativeTime(d.checkedAt)}</div>
                      <div className="text-[10px] opacity-70">{formatDate(d.checkedAt)}</div>
                    </td>
                    <td className="py-3 px-4 text-center">
                      {!d.isOnline && (
                        <Button size="sm" variant="outline" onClick={() => handleActivate(d)}>
                          <Power className="h-3 w-3 mr-1" /> Activate
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-center py-12 text-muted-foreground">
                      No model data available.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      </>
      )}
    </div>
  );
}
