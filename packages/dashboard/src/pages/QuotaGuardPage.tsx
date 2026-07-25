import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Shield, Clock, AlertTriangle, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { quotaGuard, type QuotaGuardSnapshot, type ProviderSnapshot, type ConnectionSnapshot } from "@/lib/api";

function formatResetAt(resetAt?: string): string {
  if (!resetAt) return "-";
  const d = new Date(resetAt);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  if (diffMs < 0) return "Expired";
  const hours = Math.floor(diffMs / 3600000);
  const mins = Math.floor((diffMs % 3600000) / 60000);
  if (hours > 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  return `${hours}h ${mins}m`;
}

function QuotaBar({ pct }: { pct: number }) {
  const color = pct > 50 ? "bg-green-500" : pct > 20 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
      <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
  );
}

function QuotaBadge({ pct }: { pct: number }) {
  if (pct > 50) return <Badge variant="default" className="bg-green-600 hover:bg-green-600">{pct}%</Badge>;
  if (pct > 20) return <Badge variant="default" className="bg-yellow-600 hover:bg-yellow-600 text-black">{pct}%</Badge>;
  return <Badge variant="destructive">{pct}%</Badge>;
}

function ModelRow({
  modelKey,
  quota,
  providerAlias,
  onToggleModel,
}: {
  modelKey: string;
  quota: { used: number; total: number; remainingPercentage: number; resetAt?: string; displayName?: string };
  providerAlias: string;
  onToggleModel: (providerAlias: string, modelId: string, enable: boolean) => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  const pct = quota.remainingPercentage ?? 0;

  const handleToggle = async (enable: boolean) => {
    setLoading(true);
    try {
      await onToggleModel(providerAlias, modelKey, enable);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center gap-2 sm:gap-3">
      <span className="text-xs text-muted-foreground w-28 sm:w-40 truncate" title={quota.displayName || modelKey}>
        {quota.displayName || modelKey}
      </span>
      <div className="flex-1">
        <QuotaBar pct={pct} />
      </div>
      <span className="text-xs text-muted-foreground w-14 sm:w-16 text-right">{quota.used}/{quota.total}</span>
      <span className="text-xs text-muted-foreground w-12 sm:w-14 text-right" title={quota.resetAt}>
        {formatResetAt(quota.resetAt)}
      </span>
      <div className="w-10 flex justify-end">
        <Switch
          checked={pct > 0}
          onCheckedChange={handleToggle}
          disabled={loading}
          className="scale-75"
        />
        {loading && <Loader2 className="h-3 w-3 animate-spin ml-1" />}
      </div>
    </div>
  );
}

function ConnectionCard({
  conn,
  providerAlias,
  onToggle,
  onToggleModel,
}: {
  conn: ConnectionSnapshot;
  providerAlias: string;
  onToggle: (type: "model" | "connection" | "category", id: string, enable: boolean) => Promise<void>;
  onToggleModel: (providerAlias: string, modelId: string, enable: boolean) => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);

  const handleToggle = async (enable: boolean) => {
    setLoading(true);
    try {
      await onToggle("connection", conn.id, enable);
    } finally {
      setLoading(false);
    }
  };

  const minPct = conn.quotas
    ? Math.min(...Object.values(conn.quotas).map(q => q.remainingPercentage ?? 100))
    : 100;

  return (
    <div className="border rounded-lg p-3 sm:p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-medium truncate">{conn.name}</span>
          <Badge variant={conn.isActive ? "default" : "secondary"} className="shrink-0">
            {conn.isActive ? "Active" : "Inactive"}
          </Badge>
          {conn.guardState.excluded && (
            <Badge variant="outline" className="shrink-0">Excluded</Badge>
          )}
          {conn.guardState.disabledByGuard && (
            <Badge variant="destructive" className="shrink-0">Guard-Disabled</Badge>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <QuotaBadge pct={minPct} />
          <Switch
            checked={conn.isActive}
            onCheckedChange={handleToggle}
            disabled={loading || conn.guardState.excluded}
          />
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        </div>
      </div>

      {conn.quotas && Object.keys(conn.quotas).length > 0 && (
        <div className="space-y-2">
          {Object.entries(conn.quotas).map(([key, q]) => (
            <ModelRow
              key={key}
              modelKey={key}
              quota={q}
              providerAlias={providerAlias}
              onToggleModel={onToggleModel}
            />
          ))}
        </div>
      )}

      {conn.quotaType === "no-quota" && (
        <div className="text-sm text-muted-foreground italic">No quota data available</div>
      )}

      {conn.guardState.phase !== "idle" && (
        <div className="flex items-center gap-2 text-xs">
          <Clock className="h-3 w-3" />
          <span className="text-muted-foreground">
            Phase: {conn.guardState.phase} | Retries: {conn.guardState.retryCount}/3
          </span>
        </div>
      )}
    </div>
  );
}

function ProviderSection({
  provider,
  excludedProviders,
  onToggle,
  onToggleModel,
  onToggleProvider,
}: {
  provider: ProviderSnapshot;
  excludedProviders: string[];
  onToggle: (type: "model" | "connection" | "category", id: string, enable: boolean) => Promise<void>;
  onToggleModel: (providerAlias: string, modelId: string, enable: boolean) => Promise<void>;
  onToggleProvider: (provider: string, excluded: boolean) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(true);
  const [loading, setLoading] = useState(false);

  const allPcts = provider.connections
    .flatMap(c => Object.values(c.quotas || {}))
    .map(q => q.remainingPercentage ?? 100);
  const overallPct = allPcts.length > 0 ? Math.min(...allPcts) : 100;
  const hasQuota = provider.connections.some(c => c.quotaType !== "no-quota");
  const isExcluded = excludedProviders.includes(provider.name.toLowerCase());

  const handleProviderToggle = async (excluded: boolean) => {
    setLoading(true);
    try {
      await onToggleProvider(provider.name, excluded);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader
        className="cursor-pointer py-3 sm:py-4"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <CardTitle className="text-base sm:text-lg truncate">{provider.name}</CardTitle>
            <Badge variant="outline" className="shrink-0">{provider.connections.length} conns</Badge>
            {!hasQuota && <Badge variant="secondary" className="shrink-0">No quota</Badge>}
            {isExcluded && <Badge variant="destructive" className="shrink-0">Guard Off</Badge>}
          </div>
          <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
            {hasQuota && <QuotaBadge pct={overallPct} />}
            <Switch
              checked={!isExcluded}
              onCheckedChange={(checked) => handleProviderToggle(!checked)}
              disabled={loading}
            />
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            <svg className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m6 9 6 6 6-6"/>
            </svg>
          </div>
        </div>
      </CardHeader>
      {expanded && (
        <CardContent className="space-y-3 pt-0">
          {provider.connections.map(conn => (
            <ConnectionCard
              key={conn.id}
              conn={conn}
              providerAlias={provider.alias}
              onToggle={onToggle}
              onToggleModel={onToggleModel}
            />
          ))}
        </CardContent>
      )}
    </Card>
  );
}

export default function QuotaGuardPage() {
  const [snapshot, setSnapshot] = useState<QuotaGuardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchStatus = useCallback(async () => {
    try {
      const data = await quotaGuard.getStatus();
      setSnapshot(data);
      setError("");
    } catch (err: any) {
      setError(err.message || "Failed to fetch quota guard status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 60_000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const handleToggle = async (type: "model" | "connection" | "category", id: string, enable: boolean) => {
    try {
      let providerAlias = "";
      for (const p of snapshot?.providers || []) {
        for (const c of p.connections) {
          if (c.id === id) {
            providerAlias = p.alias;
            break;
          }
        }
        if (providerAlias) break;
      }

      if (enable) {
        await quotaGuard.enable({ providerAlias, type, id });
      } else {
        await quotaGuard.disable({ providerAlias, type, id });
      }
      await new Promise(r => setTimeout(r, 1500));
      await fetchStatus();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleToggleModel = async (providerAlias: string, modelId: string, enable: boolean) => {
    try {
      if (enable) {
        await quotaGuard.enable({ providerAlias, type: "model", id: modelId });
      } else {
        await quotaGuard.disable({ providerAlias, type: "model", id: modelId });
      }
      await new Promise(r => setTimeout(r, 1500));
      await fetchStatus();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleToggleProvider = async (provider: string, excluded: boolean) => {
    try {
      await quotaGuard.setProviderExcluded(provider, excluded);
      // Wait for 9Router to process connection changes
      await new Promise(r => setTimeout(r, 2000));
      await fetchStatus();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleSchedulerToggle = async (enabled: boolean) => {
    try {
      await quotaGuard.updateScheduler({ enabled });
      await fetchStatus();
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const scheduler = snapshot?.scheduler;

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-2">
            <Shield className="h-6 w-6" />
            Quota Guard
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Auto-disables providers when quota drops below threshold
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchStatus} className="self-start">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {error && (
        <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 text-destructive text-sm flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {scheduler && (
        <Card>
          <CardContent className="py-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3 sm:gap-4 text-sm">
                <div className="flex items-center gap-2">
                  {scheduler.enabled ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                  ) : (
                    <XCircle className="h-4 w-4 text-red-500" />
                  )}
                  <span className="font-medium">{scheduler.enabled ? "Enabled" : "Disabled"}</span>
                </div>
                <div className="text-muted-foreground">
                  Poll: {scheduler.pollIntervalMs / 1000}s
                </div>
                <div className="text-muted-foreground">
                  Threshold: {scheduler.threshold}%
                </div>
                {scheduler.lastCycleAt && (
                  <div className="text-muted-foreground">
                    Last cycle: {new Date(scheduler.lastCycleAt).toLocaleTimeString()}
                  </div>
                )}
                {scheduler.excludedProviders.length > 0 && (
                  <div className="text-muted-foreground">
                    Excluded: {scheduler.excludedProviders.join(", ")}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={scheduler.enabled}
                  onCheckedChange={handleSchedulerToggle}
                />
                <span className="text-sm text-muted-foreground">Guard</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {snapshot?.providers.map(provider => (
          <ProviderSection
            key={provider.name}
            provider={provider}
            excludedProviders={scheduler?.excludedProviders || []}
            onToggle={handleToggle}
            onToggleModel={handleToggleModel}
            onToggleProvider={handleToggleProvider}
          />
        ))}
      </div>

      {(!snapshot?.providers || snapshot.providers.length === 0) && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No provider data available. The quota guard will start collecting data after the first cycle.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
