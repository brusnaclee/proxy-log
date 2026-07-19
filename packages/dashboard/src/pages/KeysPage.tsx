import { useEffect, useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { keys, type ApiKeyListItem } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { formatNumber, formatCost, copyToClipboard } from "@/lib/utils";
import { Plus, Copy, Check, Key, Download, Zap, ChevronDown, ChevronRight } from "lucide-react";
import { useRealtimeSSE } from "@/lib/use-realtime-sse";
import { exportCsvSimple } from "@/lib/export-csv";
import { Label } from "@/components/ui/label";

type KeyGroup = {
  discordUserId: string | null;
  discordUsername: string | null;
  keys: ApiKeyListItem[];
};

function groupKeysByDiscord(allKeys: ApiKeyListItem[]): KeyGroup[] {
  const map = new Map<string, KeyGroup>();
  for (const k of allKeys) {
    const id = k.discordUserId || null;
    const mapKey = id || `__unlinked_${k.id}`;
    let g = map.get(mapKey);
    if (!g) {
      g = {
        discordUserId: id,
        discordUsername: k.discordUsername || null,
        keys: [],
      };
      map.set(mapKey, g);
    }
    if (!g.discordUsername && k.discordUsername) g.discordUsername = k.discordUsername;
    g.keys.push(k);
  }
  return [...map.values()].sort((a, b) => {
    const an = (a.discordUsername || a.discordUserId || "").toLowerCase();
    const bn = (b.discordUsername || b.discordUserId || "").toLowerCase();
    return an.localeCompare(bn);
  });
}

export default function KeysPage() {
  const [allKeys, setAllKeys] = useState<ApiKeyListItem[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showCreate, setShowCreate] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showOverride, setShowOverride] = useState(false);
  const [overrideDiscordId, setOverrideDiscordId] = useState("");
  const [overrideUsername, setOverrideUsername] = useState("");
  const [overrideNote, setOverrideNote] = useState("");
  const [overrideResult, setOverrideResult] = useState<{
    apiKey: string;
    keyName: string;
    endpoint: string;
    alreadyExists: boolean;
  } | null>(null);
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const navigate = useNavigate();

  const groups = useMemo(() => groupKeysByDiscord(allKeys), [allKeys]);

  useEffect(() => {
    loadKeys();
  }, []);

  useEffect(() => {
    setExpanded((prev) => {
      const next = { ...prev };
      for (const g of groups) {
        const id = g.discordUserId || `unlinked-${g.keys[0]?.id}`;
        if (next[id] === undefined) next[id] = g.keys.length > 1;
      }
      return next;
    });
  }, [groups]);

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

  const handleOverride = async () => {
    setOverrideError(null);
    if (!/^\d{15,25}$/.test(overrideDiscordId.trim())) {
      setOverrideError("Discord ID harus 15-25 digit angka");
      return;
    }
    try {
      const res = await keys.adminOverrideDiscord(
        overrideDiscordId.trim(),
        overrideUsername.trim() || undefined,
        overrideNote.trim() || undefined,
      );
      setOverrideResult({
        apiKey: res.apiKey,
        keyName: res.keyName,
        endpoint: res.endpoint,
        alreadyExists: res.alreadyExists,
      });
      await loadKeys();
    } catch (err: any) {
      setOverrideError(err?.message || "Override failed");
    }
  };

  const handleExport = () => {
    const headers = [
      "Discord Username", "Discord User ID", "Name", "Key Prefix", "Provisioned By",
      "Status", "Devices", "Requests Today", "Tokens Today", "Est. Cost Today",
      "Max Devices", "Device Policy", "IP Policy", "IDE Policy", "Created At",
    ];
    const rows = allKeys.map((k) => [
      k.discordUsername || "",
      k.discordUserId || "",
      k.name,
      k.keyPrefix,
      k.provisionedBy || "",
      k.isActive ? "Active" : "Disabled",
      k.deviceCount,
      k.requestsToday,
      k.tokensToday,
      formatCost(k.estimatedCostToday || 0),
      k.maxDevices || "Unlimited",
      k.devicePolicy,
      k.ipPolicy,
      k.idePolicy,
      k.createdAt,
    ]);
    exportCsvSimple(headers, rows, `api-keys-${new Date().toISOString().split("T")[0]}`);
  };

  const keySlug = (k: ApiKeyListItem) =>
    `/keys/${k.id}-${k.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").substring(0, 40)}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">API Keys</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Grouped by Discord account — portal keys appear under the same user
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="h-4 w-4 mr-2" /> Export CSV
          </Button>
          <Button size="sm" variant="secondary" onClick={() => { setShowOverride(true); setOverrideResult(null); setOverrideError(null); setOverrideDiscordId(""); setOverrideUsername(""); setOverrideNote(""); }}>
            <Zap className="h-4 w-4 mr-2" /> Admin Override
          </Button>
          <Button size="sm" onClick={() => { setShowCreate(true); setCreatedKey(null); }}>
            <Plus className="h-4 w-4 mr-2" />
            Create Key
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        {groups.map((g) => {
          const gid = g.discordUserId || `unlinked-${g.keys[0]?.id}`;
          const isOpen = expanded[gid] !== false;
          const title = g.discordUsername
            ? `${g.discordUsername}${g.discordUserId ? ` · ${g.discordUserId}` : ""}`
            : g.discordUserId || "Unlinked keys";
          return (
            <Card key={gid} className="border-border/50 overflow-hidden">
              <button
                type="button"
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-accent/30 transition-colors"
                onClick={() => setExpanded((p) => ({ ...p, [gid]: !isOpen }))}
              >
                {isOpen ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{title}</div>
                  {!g.discordUserId && (
                    <div className="text-[10px] text-muted-foreground">No Discord link on these keys</div>
                  )}
                </div>
                <Badge variant="secondary" className="shrink-0 gap-1">
                  <Key className="h-3 w-3" />
                  {g.keys.length} {g.keys.length === 1 ? "key" : "keys"}
                </Badge>
              </button>
              {isOpen && (
                <CardContent className="p-0 border-t border-border/40">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[700px]">
                      <thead>
                        <tr className="border-b border-border/50">
                          <th className="text-left py-2 px-4 text-muted-foreground font-medium text-xs">Key name</th>
                          <th className="text-left py-2 px-4 text-muted-foreground font-medium text-xs hide-mobile">Prefix</th>
                          <th className="text-left py-2 px-4 text-muted-foreground font-medium text-xs">Source</th>
                          <th className="text-center py-2 px-4 text-muted-foreground font-medium text-xs">Status</th>
                          <th className="text-right py-2 px-4 text-muted-foreground font-medium text-xs">Requests</th>
                          <th className="text-right py-2 px-4 text-muted-foreground font-medium text-xs hide-mobile">Tokens</th>
                          <th className="text-center py-2 px-4 text-muted-foreground font-medium text-xs">Active</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.keys.map((k) => (
                          <tr
                            key={k.id}
                            className="border-b border-border/30 hover:bg-accent/30 cursor-pointer transition-colors"
                            onClick={() => navigate(keySlug(k))}
                          >
                            <td className="py-2.5 px-4 font-medium text-sm">
                              <span className="inline-flex items-center gap-2">
                                {k.name}
                                {k.isPrimary && (
                                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-sky-500/50 text-sky-400">
                                    Primary
                                  </Badge>
                                )}
                                {k.isTrial && (
                                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-500/50 text-amber-500">
                                    Trial
                                  </Badge>
                                )}
                              </span>
                            </td>
                            <td className="py-2.5 px-4 hide-mobile">
                              <code className="text-xs bg-accent/50 px-2 py-1 rounded font-mono">
                                {k.keyMasked}
                              </code>
                            </td>
                            <td className="py-2.5 px-4 text-xs text-muted-foreground">
                              {k.provisionedBy || "—"}
                            </td>
                            <td className="py-2.5 px-4 text-center">
                              <Badge variant={k.isActive ? "success" : "secondary"}>
                                {k.isActive ? "Active" : "Disabled"}
                              </Badge>
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono text-xs">{formatNumber(k.requestsToday)}</td>
                            <td className="py-2.5 px-4 text-right font-mono text-xs hide-mobile">{formatNumber(k.tokensToday)}</td>
                            <td className="py-2.5 px-4 text-center" onClick={(e) => e.stopPropagation()}>
                              <Switch
                                checked={k.isActive}
                                onCheckedChange={() => handleToggleActive(k.id, k.isActive)}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              )}
            </Card>
          );
        })}
        {allKeys.length === 0 && (
          <Card className="border-border/50">
            <CardContent className="text-center py-12 text-muted-foreground">
              <Key className="h-8 w-8 mx-auto mb-3 opacity-30" />
              No API keys yet. Create one to get started.
            </CardContent>
          </Card>
        )}
      </div>

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

      <Dialog open={showOverride} onOpenChange={setShowOverride}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{overrideResult ? "Override Key Issued" : "Admin Override Discord Member"}</DialogTitle>
            <DialogDescription>
              {overrideResult
                ? overrideResult.alreadyExists
                  ? "User sudah punya active admin-override key. Key ditampilkan ulang."
                  : "Key unlimited berhasil dibuat. Key ini dikecualikan dari daily-cleanup (admin-override)."
                : "Buat API key untuk Discord user tanpa agverif gate. Key unlimited, isActive=true, tidak akan auto-revoke."}
            </DialogDescription>
          </DialogHeader>

          {overrideResult ? (
            <div className="space-y-4">
              <div className="text-xs text-muted-foreground">
                <strong>Name:</strong> {overrideResult.keyName}
              </div>
              <div className="text-xs text-muted-foreground">
                <strong>Endpoint:</strong> <code className="font-mono">{overrideResult.endpoint}</code>
              </div>
              <div className="space-y-2">
                <Label>API Key</Label>
                <div className="flex items-center gap-2 p-3 bg-accent/50 rounded-lg">
                  <code className="flex-1 text-sm font-mono break-all">{overrideResult.apiKey}</code>
                  <Button size="icon" variant="ghost" onClick={() => handleCopy(overrideResult.apiKey)}>
                    {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                DM user Discord-nya via bot command atau manual. Key ini sudah aktif dan bisa langsung dipakai.
              </p>
              <DialogFooter>
                <Button onClick={() => setShowOverride(false)}>Done</Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Discord User ID <span className="text-red-400">*</span></Label>
                <Input
                  placeholder="123456789012345678"
                  value={overrideDiscordId}
                  onChange={(e) => setOverrideDiscordId(e.target.value.replace(/[^0-9]/g, ""))}
                  maxLength={25}
                />
                <p className="text-xs text-muted-foreground">15-25 digit angka (snowflake ID Discord)</p>
              </div>
              <div className="space-y-2">
                <Label>Discord Username (optional)</Label>
                <Input
                  placeholder="johndoe"
                  value={overrideUsername}
                  onChange={(e) => setOverrideUsername(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Note (admin only, untuk audit)</Label>
                <Input
                  placeholder="VIP / sponsor / trusted user"
                  value={overrideNote}
                  onChange={(e) => setOverrideNote(e.target.value)}
                />
              </div>
              {overrideError && (
                <p className="text-xs text-red-400">{overrideError}</p>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowOverride(false)}>Cancel</Button>
                <Button onClick={handleOverride} disabled={!overrideDiscordId.trim()}>
                  Create Override Key
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
