import { useState, useEffect, useCallback } from "react";
import { buglog } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { RefreshCw, Trash2, AlertTriangle, Clock, Filter, Users } from "lucide-react";
import { cn } from "@/lib/utils";

export default function BugLogPage() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(7);
  const [statusFilter, setStatusFilter] = useState("all");
  const [expandedRow, setExpandedRow] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = { days };
      if (statusFilter !== "all") params.status = parseInt(statusFilter);
      const res = await buglog.list(params);
      setData(res.data.slice(0, 500));
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [days, statusFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleDelete = async (entry) => {
    if (!confirm("Delete " + entry.count + " occurrences?")) return;
    setDeletingId(entry.id);
    try {
      await buglog.deleteSignature({ statusCode: entry.statusCode, errorMessage: entry.errorMessage, model: entry.model, endpointPath: entry.endpointPath });
      await fetchData();
    } catch (err) { console.error(err); }
    finally { setDeletingId(null); }
  };

  const handleClearOld = async () => {
    const d = parseInt(prompt("Delete errors older than days?", "30") || "");
    if (isNaN(d) || d <= 0) return;
    try { await buglog.clearOld(d); await fetchData(); } catch (err) { console.error(err); }
  };

  const handleClearAll = async () => {
    if (!confirm("Delete ALL error logs?")) return;
    try { await buglog.clearAll(); await fetchData(); } catch (err) { console.error(err); }
  };

  const totalErrors = data.reduce((sum, d) => sum + d.count, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><AlertTriangle className="h-6 w-6 text-amber-500" />Bug Log</h1>
          <p className="text-sm text-muted-foreground mt-1">{totalErrors.toLocaleString()} total errors across {data.length} unique groups.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}><RefreshCw className={cn("h-4 w-4 mr-1", loading && "animate-spin")} />Refresh</Button>
          <Button variant="outline" size="sm" onClick={handleClearOld}><Clock className="h-4 w-4 mr-1" />Clear Old</Button>
          <Button variant="destructive" size="sm" onClick={handleClearAll}><Trash2 className="h-4 w-4 mr-1" />Clear All</Button>
        </div>
      </div>
      <Card className="p-4"><div className="flex flex-col sm:flex-row gap-3">
        <div className="flex items-center gap-2"><Filter className="h-4 w-4 text-muted-foreground" /><span className="text-sm font-medium">Filters:</span></div>
        <Select value={String(days)} onValueChange={(v) => setDays(parseInt(v))}><SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="1">Last 24h</SelectItem><SelectItem value="3">3 days</SelectItem><SelectItem value="7">7 days</SelectItem><SelectItem value="30">30 days</SelectItem><SelectItem value="90">90 days</SelectItem></SelectContent></Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All</SelectItem><SelectItem value="400">400</SelectItem><SelectItem value="404">404</SelectItem><SelectItem value="500">500</SelectItem><SelectItem value="502">502</SelectItem><SelectItem value="503">503</SelectItem></SelectContent></Select>
      </div></Card>
      <Card className="overflow-hidden">
        {loading && data.length === 0 ? (<div className="p-8 text-center text-muted-foreground"><RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2" />Loading...</div>) : data.length === 0 ? (<div className="p-8 text-center text-muted-foreground">No errors found.</div>) : (
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-border/50 bg-muted/30"><th className="text-left py-3 px-3 text-muted-foreground font-medium text-xs w-16">Status</th><th className="text-left py-3 px-3 text-muted-foreground font-medium text-xs">Error</th><th className="text-left py-3 px-3 text-muted-foreground font-medium text-xs hide-mobile">Model</th><th className="text-left py-3 px-3 text-muted-foreground font-medium text-xs hide-mobile">Endpoint</th><th className="text-right py-3 px-3 text-muted-foreground font-medium text-xs w-20">Count</th><th className="text-left py-3 px-3 text-muted-foreground font-medium text-xs hide-mobile">Users</th><th className="text-left py-3 px-3 text-muted-foreground font-medium text-xs hide-mobile">First</th><th className="text-left py-3 px-3 text-muted-foreground font-medium text-xs hide-mobile">Last</th><th className="text-right py-3 px-3 text-muted-foreground font-medium text-xs w-16"></th></tr></thead><tbody>{data.map((entry) => (<><tr key={entry.id} className="border-b border-border/30 hover:bg-accent/30 cursor-pointer" onClick={() => setExpandedRow(expandedRow === entry.id ? null : entry.id)}><td className="py-2 px-3"><Badge variant={entry.statusCode >= 500 ? "destructive" : "outline"}>{entry.statusCode}</Badge></td><td className="py-2 px-3 max-w-[300px] truncate text-xs">{entry.errorMessage}</td><td className="py-2 px-3 text-xs hide-mobile"><code className="bg-muted px-1 rounded text-[11px]">{entry.model}</code></td><td className="py-2 px-3 text-xs hide-mobile text-muted-foreground">{entry.endpointPath}</td><td className="py-2 px-3 text-right"><span className={cn("font-bold", entry.count >= 100 ? "text-red-500" : entry.count >= 10 ? "text-amber-500" : "")}>{entry.count.toLocaleString()}</span></td><td className="py-2 px-3 text-xs hide-mobile"><Users className="h-3 w-3 inline" /> {entry.affectedUsers}</td><td className="py-2 px-3 text-xs hide-mobile text-muted-foreground">{new Date(entry.firstSeen).toLocaleString()}</td><td className="py-2 px-3 text-xs hide-mobile text-muted-foreground">{new Date(entry.lastSeen).toLocaleString()}</td><td className="py-2 px-3 text-right" onClick={(e) => e.stopPropagation()}><Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDelete(entry)} disabled={deletingId === entry.id}><Trash2 className="h-3.5 w-3.5" /></Button></td></tr>{expandedRow === entry.id && (<tr key={entry.id + "-d"} className="border-b border-border/20 bg-muted/20"><td colSpan={9} className="py-3 px-4"><div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs"><div><b>Status:</b> {entry.statusCode}</div><div><b>Model:</b> <code className="bg-muted px-1 rounded">{entry.model}</code></div><div><b>Endpoint:</b> {entry.endpointPath}</div><div><b>Users:</b> {entry.affectedUsers}</div><div className="sm:col-span-2"><b>Error:</b><p className="mt-1 p-2 bg-muted rounded text-[11px] break-all">{entry.errorMessage}</p></div><div><b>IDEs:</b> {entry.ideDetections.join(", ")}</div><div><b>Providers:</b> {entry.providers.join(", ")}</div></div></td></tr>)} </>))}</tbody></table></div>)}
        {data.length > 0 && <div className="px-4 py-3 border-t border-border/50 text-xs text-muted-foreground">{data.length} groups, {totalErrors.toLocaleString()} total errors.</div>}
      </Card>
    </div>
  );
}
