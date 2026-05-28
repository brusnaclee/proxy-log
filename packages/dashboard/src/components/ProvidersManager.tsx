import { useState, useEffect } from "react";
import { request } from "@/lib/api";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trash, Plus, ChevronDown, ChevronRight, RotateCcw, Key } from "lucide-react";

interface ProviderApiKey {
  id: number;
  providerId: number;
  apiKey: string;
  isLimited: boolean;
  limitedAt: string | null;
  requestCount: number;
  lastUsedAt: string | null;
}

export function ProvidersManager() {
  const [providers, setProviders] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedProvider, setExpandedProvider] = useState<number | null>(null);
  const [providerKeys, setProviderKeys] = useState<Record<number, ProviderApiKey[]>>({});
  const [newKeyInputs, setNewKeyInputs] = useState<Record<number, string>>({});

  const [name, setName] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [priority, setPriority] = useState(1);
  const [endpointType, setEndpointType] = useState("openai");

  const loadProviders = async () => {
    try {
      const res = await request<any[]>("/providers");
      setProviders(res);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  const loadKeys = async (providerId: number) => {
    try {
      const res = await request<ProviderApiKey[]>(`/providers/${providerId}/keys`);
      setProviderKeys(prev => ({ ...prev, [providerId]: res }));
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadProviders();
  }, []);

  const toggleExpand = async (providerId: number) => {
    if (expandedProvider === providerId) {
      setExpandedProvider(null);
    } else {
      setExpandedProvider(providerId);
      await loadKeys(providerId);
    }
  };

  const handleAdd = async () => {
    try {
      await request("/providers", {
        method: "POST",
        body: JSON.stringify({ name, endpoint, apiKey, priority, endpointType }),
      });
      setName(""); setEndpoint(""); setApiKey(""); setPriority(1); setEndpointType("openai");
      loadProviders();
    } catch (e: any) {
      alert("Error: " + e.message);
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm("Delete provider?")) return;
    try {
      await request(`/providers/${id}`, { method: "DELETE" });
      loadProviders();
    } catch (e: any) {
      alert("Error: " + e.message);
    }
  };

  const handleAddKey = async (providerId: number) => {
    const key = newKeyInputs[providerId];
    if (!key) return;
    try {
      await request(`/providers/${providerId}/keys`, {
        method: "POST",
        body: JSON.stringify({ apiKey: key }),
      });
      setNewKeyInputs(prev => ({ ...prev, [providerId]: "" }));
      loadKeys(providerId);
    } catch (e: any) {
      alert("Error: " + e.message);
    }
  };

  const handleResetKey = async (providerId: number, keyId: number) => {
    try {
      await request(`/providers/${providerId}/keys/${keyId}/reset`, { method: "PATCH" });
      loadKeys(providerId);
    } catch (e: any) {
      alert("Error: " + e.message);
    }
  };

  const handleDeleteKey = async (providerId: number, keyId: number) => {
    if (!window.confirm("Delete this API key?")) return;
    try {
      await request(`/providers/${providerId}/keys/${keyId}`, { method: "DELETE" });
      loadKeys(providerId);
    } catch (e: any) {
      alert("Error: " + e.message);
    }
  };

  const maskKey = (key: string) => {
    if (key.length <= 8) return "****";
    return key.substring(0, 4) + "..." + key.substring(key.length - 4);
  };

  return (
    <Card className="border-border/50 mt-6">
      <CardHeader>
        <CardTitle className="text-base">Upstream Providers</CardTitle>
        <CardDescription>Configure multiple upstream APIs. Models will be fetched from all active providers.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="grid grid-cols-6 gap-2 border-b border-border/50 pb-2 mb-2 text-sm font-medium text-muted-foreground">
            <div className="col-span-1">Name</div>
            <div className="col-span-2">Endpoint</div>
            <div className="col-span-1">Type</div>
            <div className="col-span-1">Priority</div>
            <div className="col-span-1 text-right">Actions</div>
          </div>
          {providers.map((p) => (
            <div key={p.id}>
              <div className="grid grid-cols-6 gap-2 items-center border-b border-border/50 pb-2">
                <div className="col-span-1 truncate flex items-center gap-1">
                  <button onClick={() => toggleExpand(p.id)} className="p-0.5 hover:bg-muted rounded">
                    {expandedProvider === p.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </button>
                  {p.name}
                </div>
                <div className="col-span-2 truncate">{p.endpoint}</div>
                <div className="col-span-1 text-xs">
                  <span className={`px-1.5 py-0.5 rounded text-xs ${p.endpointType === "anthropic" ? "bg-orange-500/20 text-orange-400" : "bg-blue-500/20 text-blue-400"}`}>
                    {p.endpointType || "openai"}
                  </span>
                </div>
                <div className="col-span-1">{p.priority}</div>
                <div className="col-span-1 text-right flex justify-end gap-1">
                  <Button
                    variant={p.isActive ? "default" : "outline"}
                    size="sm"
                    onClick={async () => {
                      await request(`/providers/${p.id}`, {
                        method: "PUT",
                        body: JSON.stringify({ isActive: !p.isActive }),
                      });
                      loadProviders();
                    }}
                  >
                    {p.isActive ? "On" : "Off"}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => handleDelete(p.id)}>
                    <Trash className="w-4 h-4 text-red-500" />
                  </Button>
                </div>
              </div>

              {/* Expanded API Keys section */}
              {expandedProvider === p.id && (
                <div className="ml-6 mt-2 mb-4 p-3 bg-muted/30 rounded-lg border border-border/50">
                  <div className="flex items-center gap-2 mb-3">
                    <Key className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-medium">API Keys (load-balanced rotation)</span>
                  </div>

                  {(providerKeys[p.id] || []).length === 0 ? (
                    <p className="text-sm text-muted-foreground mb-3">No keys configured. Add one below.</p>
                  ) : (
                    <div className="space-y-2 mb-3">
                      {(providerKeys[p.id] || []).map((k) => (
                        <div key={k.id} className="flex items-center gap-3 p-2 bg-background rounded border border-border/50">
                          <code className="text-xs font-mono">{maskKey(k.apiKey)}</code>
                          <span className={`px-1.5 py-0.5 rounded text-xs ${k.isLimited ? "bg-red-500/20 text-red-400" : "bg-green-500/20 text-green-400"}`}>
                            {k.isLimited ? "Limited" : "Active"}
                          </span>
                          <span className="text-xs text-muted-foreground">Requests: {k.requestCount}</span>
                          {k.lastUsedAt && (
                            <span className="text-xs text-muted-foreground">Last: {new Date(k.lastUsedAt).toLocaleTimeString()}</span>
                          )}
                          <div className="ml-auto flex gap-1">
                            {k.isLimited && (
                              <Button variant="outline" size="sm" onClick={() => handleResetKey(p.id, k.id)} title="Retry (reset limited status)">
                                <RotateCcw className="w-3 h-3 mr-1" /> Retry
                              </Button>
                            )}
                            <Button variant="ghost" size="sm" onClick={() => handleDeleteKey(p.id, k.id)} title="Delete key">
                              <Trash className="w-3 h-3 text-red-500" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <Input
                      value={newKeyInputs[p.id] || ""}
                      onChange={e => setNewKeyInputs(prev => ({ ...prev, [p.id]: e.target.value }))}
                      placeholder="Add new API key..."
                      type="password"
                      className="text-sm"
                    />
                    <Button size="sm" onClick={() => handleAddKey(p.id)} disabled={!newKeyInputs[p.id]}>
                      <Plus className="w-3 h-3 mr-1" /> Add Key
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Add new provider form */}
          <div className="grid grid-cols-6 gap-2 mt-4 items-end">
            <div className="col-span-1">
              <Label>Name</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="OpenAI" />
            </div>
            <div className="col-span-2">
              <Label>Endpoint URL</Label>
              <Input value={endpoint} onChange={e => setEndpoint(e.target.value)} placeholder="https://api.openai.com/v1" />
            </div>
            <div className="col-span-1">
              <Label>Type</Label>
              <select
                value={endpointType}
                onChange={e => setEndpointType(e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
              </select>
            </div>
            <div className="col-span-1">
              <Label>Priority</Label>
              <Input type="number" value={priority} onChange={e => setPriority(parseInt(e.target.value)||0)} />
            </div>
            <div className="col-span-1">
              <Button onClick={handleAdd} disabled={!name || !endpoint || !apiKey} className="w-full">
                <Plus className="w-4 h-4 mr-2" /> Add
              </Button>
            </div>
          </div>
          <div className="mt-2">
            <Label>API Key</Label>
            <Input value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-..." type="password" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
