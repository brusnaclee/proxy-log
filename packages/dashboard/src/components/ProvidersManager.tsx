import { useState, useEffect } from "react";
import { request } from "@/lib/api";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trash, Plus, ChevronDown, ChevronRight, RotateCcw, Key, Copy, Eye, EyeOff, Pencil, Check, X } from "lucide-react";

interface ProviderApiKey {
  id: number;
  providerId: number;
  apiKey: string;
  isActive: boolean;
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
  const [showKeys, setShowKeys] = useState<Record<number, boolean>>({});
  const [editingKey, setEditingKey] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");

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

  const handleToggleKey = async (providerId: number, keyId: number) => {
    try {
      await request(`/providers/${providerId}/keys/${keyId}/toggle`, { method: "PATCH" });
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

  const handleUpdateKey = async (providerId: number, keyId: number) => {
    if (!editValue) return;
    try {
      await request(`/providers/${providerId}/keys/${keyId}`, {
        method: "PUT",
        body: JSON.stringify({ apiKey: editValue }),
      });
      setEditingKey(null);
      setEditValue("");
      loadKeys(providerId);
    } catch (e: any) {
      alert("Error: " + e.message);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      // Brief visual feedback could be added here
    }).catch(() => {
      // Fallback
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    });
  };

  const maskKey = (key: string) => {
    if (key.length <= 8) return "****";
    return key.substring(0, 4) + "..." + key.substring(key.length - 4);
  };

  const getKeyStatus = (k: ProviderApiKey) => {
    if (!k.isActive) return { label: "Disabled", color: "bg-gray-500/20 text-gray-400" };
    if (k.isLimited) return { label: "Limited", color: "bg-red-500/20 text-red-400" };
    return { label: "Active", color: "bg-green-500/20 text-green-400" };
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
                      {(providerKeys[p.id] || []).map((k) => {
                        const status = getKeyStatus(k);
                        const isEditing = editingKey === k.id;
                        return (
                          <div key={k.id} className="flex items-center gap-2 p-2 bg-background rounded border border-border/50">
                            {/* Key display / edit */}
                            <div className="flex-1 min-w-0">
                              {isEditing ? (
                                <div className="flex items-center gap-1">
                                  <Input
                                    value={editValue}
                                    onChange={e => setEditValue(e.target.value)}
                                    className="text-xs font-mono h-7"
                                    type="text"
                                    autoFocus
                                  />
                                  <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => handleUpdateKey(p.id, k.id)}>
                                    <Check className="w-3 h-3 text-green-500" />
                                  </Button>
                                  <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => { setEditingKey(null); setEditValue(""); }}>
                                    <X className="w-3 h-3 text-red-500" />
                                  </Button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <code className="text-xs font-mono truncate">
                                    {showKeys[k.id] ? k.apiKey : maskKey(k.apiKey)}
                                  </code>
                                  <button
                                    onClick={() => setShowKeys(prev => ({ ...prev, [k.id]: !prev[k.id] }))}
                                    className="text-muted-foreground hover:text-foreground"
                                    title={showKeys[k.id] ? "Hide key" : "Show key"}
                                  >
                                    {showKeys[k.id] ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                                  </button>
                                  <button
                                    onClick={() => copyToClipboard(k.apiKey)}
                                    className="text-muted-foreground hover:text-foreground"
                                    title="Copy key"
                                  >
                                    <Copy className="w-3 h-3" />
                                  </button>
                                  <button
                                    onClick={() => { setEditingKey(k.id); setEditValue(k.apiKey); }}
                                    className="text-muted-foreground hover:text-foreground"
                                    title="Edit key"
                                  >
                                    <Pencil className="w-3 h-3" />
                                  </button>
                                </div>
                              )}
                            </div>

                            {/* Status badge */}
                            <span className={`px-1.5 py-0.5 rounded text-xs whitespace-nowrap ${status.color}`}>
                              {status.label}
                            </span>

                            {/* Stats */}
                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                              {k.requestCount} reqs
                            </span>
                            {k.lastUsedAt && (
                              <span className="text-xs text-muted-foreground whitespace-nowrap">
                                {new Date(k.lastUsedAt).toLocaleTimeString()}
                              </span>
                            )}

                            {/* Action buttons */}
                            <div className="flex gap-1 ml-auto">
                              {/* Enable/Disable toggle */}
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2"
                                onClick={() => handleToggleKey(p.id, k.id)}
                                title={k.isActive ? "Disable key" : "Enable key"}
                              >
                                {k.isActive ? (
                                  <Eye className="w-3 h-3 text-green-500" />
                                ) : (
                                  <EyeOff className="w-3 h-3 text-gray-400" />
                                )}
                              </Button>

                              {/* Retry (only for limited keys) */}
                              {k.isLimited && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 px-2"
                                  onClick={() => handleResetKey(p.id, k.id)}
                                  title="Retry (reset limited status)"
                                >
                                  <RotateCcw className="w-3 h-3 mr-1" /> Retry
                                </Button>
                              )}

                              {/* Delete */}
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2"
                                onClick={() => handleDeleteKey(p.id, k.id)}
                                title="Delete key"
                              >
                                <Trash className="w-3 h-3 text-red-500" />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Add new key */}
                  <div className="flex gap-2 mt-2">
                    <Input
                      value={newKeyInputs[p.id] || ""}
                      onChange={e => setNewKeyInputs(prev => ({ ...prev, [p.id]: e.target.value }))}
                      placeholder="Paste new API key here..."
                      type="text"
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
