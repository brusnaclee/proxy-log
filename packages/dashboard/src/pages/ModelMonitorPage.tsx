import { useEffect, useState, useCallback, useMemo } from "react";
import { monitor, type ModelMonitorEntry } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatRelativeTime, formatDate } from "@/lib/utils";
import { Download, RefreshCw, Activity, ServerCrash, CheckCircle2, Clock } from "lucide-react";
import { exportXlsx } from "@/lib/export-xlsx";

function modelVendorOf(modelId: string) {
  return modelId.includes("/") ? modelId.split("/")[0] : "unknown";
}

export default function ModelMonitorPage() {
  const [data, setData] = useState<ModelMonitorEntry[]>([]);
  const [summary, setSummary] = useState({ total: 0, online: 0, offline: 0, timeout: 0 });
  const [loading, setLoading] = useState(true);
  const [upstreamFilter, setUpstreamFilter] = useState("all");
  const [modelVendorFilter, setModelVendorFilter] = useState("all");
  const [sortMode, setSortMode] = useState("status");

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
          <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="h-4 w-4 mr-2" />
            Export XLSX
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
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
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-12 text-muted-foreground">
                      No model data available.
                    </td>
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
