import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { keys, type ApiKeyListItem } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { formatNumber, formatCost, copyToClipboard } from "@/lib/utils";
import { Plus, Copy, Check, Key, Download } from "lucide-react";
import { useRealtimeSSE } from "@/lib/use-realtime-sse";
import { exportCsvSimple } from "@/lib/export-csv";
import { useCallback } from "react";

export default function KeysPage() {
  const [allKeys, setAllKeys] = useState<ApiKeyListItem[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    loadKeys();
  }, []);

  const handleSSEMessage = useCallback(() => {
    void loadKeys();
  }, []);
  useRealtimeSSE(handleSSEMessage, 700);

  const loadKeys = async () => {
    try {
      const data = await keys.list();
      setAllKeys(data);
    } catch {}
  };

  const handleCreate = async () => {
    if (!newKeyName.trim()) return;
    setLoading(true);
    try {
      const res = await keys.create(newKeyName.trim());
      setCreatedKey(res.key);
      setNewKeyName("");
      loadKeys();
    } catch {}
    setLoading(false);
  };

  const handleToggleActive = async (id: number, isActive: boolean) => {
    try {
      await keys.update(id, { isActive: !isActive });
      loadKeys();
    } catch {}
  };

  const handleCopy = async (text: string) => {
    await copyToClipboard(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExport = () => {
    const headers = ["Name", "Key Prefix", "Status", "Devices", "Requests Today", "Total Tokens", "Max Devices", "Device Policy", "IP Policy", "IDE Policy", "Created At"];
    const rows = allKeys.map((k) => [
      k.name,
      k.keyPrefix,
      k.isActive ? "Active" : "Disabled",
      k.deviceCount,
      k.requestsToday,
      k.totalTokens,
      formatCost(k.estimatedCost || 0),
      k.maxDevices || "Unlimited",
      k.devicePolicy,
      k.ipPolicy,
      k.idePolicy,
      k.createdAt
    ]);
    exportCsvSimple(headers, rows, `api-keys-${new Date().toISOString().split("T")[0]}`);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">API Keys</h1>
          <p className="text-muted-foreground mt-1">Manage proxy API keys for your clients</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExport}>
            <Download className="h-4 w-4 mr-2" /> Export CSV
          </Button>
          <Button onClick={() => { setShowCreate(true); setCreatedKey(null); }}>
            <Plus className="h-4 w-4 mr-2" />
            Create Key
          </Button>
        </div>
      </div>

      {/* Keys Table */}
      <Card className="border-border/50">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="text-left py-3 px-4 text-muted-foreground font-medium">Name</th>
                  <th className="text-left py-3 px-4 text-muted-foreground font-medium">Key</th>
                  <th className="text-center py-3 px-4 text-muted-foreground font-medium">Status</th>
                  <th className="text-right py-3 px-4 text-muted-foreground font-medium">Devices</th>
                  <th className="text-right py-3 px-4 text-muted-foreground font-medium">Requests Today</th>
                  <th className="text-right py-3 px-4 text-muted-foreground font-medium">Total Tokens</th>
                  <th className="text-right py-3 px-4 text-muted-foreground font-medium">Est. Cost</th>
                  <th className="text-center py-3 px-4 text-muted-foreground font-medium">Active</th>
                </tr>
              </thead>
              <tbody>
                {allKeys.map((k) => (
                  <tr
                    key={k.id}
                    className="border-b border-border/30 hover:bg-accent/30 cursor-pointer transition-colors"
                    onClick={() => navigate(`/keys/${k.id}-${k.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 40)}`)}
                  >
                    <td className="py-3 px-4 font-medium">{k.name}</td>
                    <td className="py-3 px-4">
                      <code className="text-xs bg-accent/50 px-2 py-1 rounded font-mono">
                        {k.keyMasked}
                      </code>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <Badge variant={k.isActive ? "success" : "secondary"}>
                        {k.isActive ? "Active" : "Disabled"}
                      </Badge>
                    </td>
                    <td className="py-3 px-4 text-right">{k.deviceCount}</td>
                    <td className="py-3 px-4 text-right font-mono">{formatNumber(k.requestsToday)}</td>
                    <td className="py-3 px-4 text-right font-mono">{formatNumber(k.totalTokens)}</td>
                    <td className="py-3 px-4 text-right font-mono text-emerald-400/90">{formatCost(k.estimatedCost || 0)}</td>
                    <td className="py-3 px-4 text-center" onClick={(e) => e.stopPropagation()}>
                      <Switch
                        checked={k.isActive}
                        onCheckedChange={() => handleToggleActive(k.id, k.isActive)}
                      />
                    </td>
                  </tr>
                ))}
                {allKeys.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-12 text-muted-foreground">
                      <Key className="h-8 w-8 mx-auto mb-3 opacity-30" />
                      No API keys yet. Create one to get started.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Create Key Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{createdKey ? "API Key Created" : "Create New API Key"}</DialogTitle>
            <DialogDescription>
              {createdKey
                ? "Copy this key now. You won't be able to see it again."
                : "Give your API key a descriptive name."}
            </DialogDescription>
          </DialogHeader>

          {createdKey ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 p-3 bg-accent/50 rounded-lg">
                <code className="flex-1 text-sm font-mono break-all">{createdKey}</code>
                <Button size="icon" variant="ghost" onClick={() => handleCopy(createdKey)}>
                  {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <DialogFooter>
                <Button onClick={() => setShowCreate(false)}>Done</Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              <Input
                placeholder="e.g., John's Dev Key"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                autoFocus
              />
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowCreate(false)}>
                  Cancel
                </Button>
                <Button onClick={handleCreate} disabled={loading || !newKeyName.trim()}>
                  {loading ? "Creating..." : "Create"}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
