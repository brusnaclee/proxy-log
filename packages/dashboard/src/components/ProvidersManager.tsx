import { useState, useEffect } from "react";
import { request } from "@/lib/api";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trash, Plus, ChevronDown, ChevronRight, RotateCcw, Key, Copy, Eye, EyeOff, Pencil, Check, X, Box } from "lucide-react";

interface ProviderApiKey {
  id: number;
  providerId: number;
  apiKey: string;
  isActive: boolean;
  isLimited: boolean;
  limitedAt: string | null;
  lastError?: string | null;
  lastCheckedAt?: string | null;
  lastModelCount?: number;
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

  // Custom models state
  const [providerCustomModels, setProviderCustomModels] = useState<Record<number, any[]>>({});
  const [expandedCustomModels, setExpandedCustomModels] = useState<number | null>(null);
  const [newModelInputs, setNewModelInputs] = useState<Record<number, { modelId: string; displayName: string; description: string; contextLength: string; maxOutputTokens: string; inputPricePerMtok: string; outputPricePerMtok: string; inputModalities: string; outputModalities: string; supportedFeatures: string }>>({});
  const [editingModel, setEditingModel] = useState<{ providerId: number; modelId: string } | null>(null);
  const [editModelValue, setEditModelValue] = useState({ displayName: "", description: "", contextLength: "", maxOutputTokens: "", inputPricePerMtok: "", outputPricePerMtok: "", inputModalities: "", outputModalities: "", supportedFeatures: "" });

  const [name, setName] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [priority, setPriority] = useState(1);
  const [endpointType, setEndpointType] = useState("openai");

  // Inline-edit state for provider row fields (name, endpoint, endpointType, priority)
  const [editingProviderField, setEditingProviderField] = useState<{
    providerId: number;
    field: "name" | "endpoint" | "endpointType" | "priority";
  } | null>(null);
  const [editProviderValue, setEditProviderValue] = useState<string>("");

  const handleEditProviderField = (
    providerId: number,
    field: "name" | "endpoint" | "endpointType" | "priority",
    currentValue: string | number,
  ) => {
    setEditingProviderField({ providerId, field });
    setEditProviderValue(String(currentValue ?? ""));
  };

  const handleCancelEditProviderField = () => {
    setEditingProviderField(null);
    setEditProviderValue("");
  };

  const handleSaveProviderField = async (providerId: number) => {
    if (!editingProviderField) return;
    const { field } = editingProviderField;
    // Validate required string fields
    if ((field === "name" || field === "endpoint") && !editProviderValue.trim()) {
      alert(`${field} cannot be empty`);
      return;
    }
    let value: any = editProviderValue.trim();
    if (field === "priority") {
      value = parseInt(editProviderValue, 10);
      if (Number.isNaN(value)) value = 0;
    }
    try {
      await request(`/providers/${providerId}`, {
        method: "PUT",
        body: JSON.stringify({ [field]: value }),
      });
      handleCancelEditProviderField();
      loadProviders();
    } catch (e: any) {
      alert("Error: " + e.message);
    }
  };

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
      await loadCustomModels(providerId);
    }
  };

  const handleAdd = async () => {
    try {
      const res = await request<{
        success: boolean;
        health?: { ok: boolean; error?: string | null; modelCount?: number };
        catalog?: { listed: number; seeded: number };
      }>("/providers", {
        method: "POST",
        body: JSON.stringify({ name, endpoint, apiKey, priority, endpointType }),
      });
      setName(""); setEndpoint(""); setApiKey(""); setPriority(1); setEndpointType("openai");
      loadProviders();
      if (res.health && !res.health.ok) {
        alert(res.health.error || "Provider saved but API key failed /models check");
      } else if (res.catalog) {
        alert(`Provider added. Key OK — ${res.catalog.listed} models synced to Model Monitor (${res.catalog.seeded} new). Publish ON di Monitor untuk expose ke client.`);
      }
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
      const res = await request<{
        success: boolean;
        health?: { ok: boolean; error?: string | null; modelCount?: number };
        catalog?: { listed: number; seeded: number };
      }>(
        `/providers/${providerId}/keys`,
        {
          method: "POST",
          body: JSON.stringify({ apiKey: key }),
        },
      );
      setNewKeyInputs(prev => ({ ...prev, [providerId]: "" }));
      loadKeys(providerId);
      loadProviders();
      if (res.health && !res.health.ok) {
        alert(res.health.error || "Invalid API key — key saved but marked invalid");
      } else if (res.catalog) {
        alert(`Key OK — ${res.catalog.listed} models in catalog (${res.catalog.seeded} new).`);
      }
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
      const res = await request<{
        success: boolean;
        health?: { ok: boolean; error?: string | null; modelCount?: number };
        catalog?: { listed: number; seeded: number } | null;
      }>(`/providers/${providerId}/keys/${keyId}`, {
        method: "PUT",
        body: JSON.stringify({ apiKey: editValue }),
      });
      setEditingKey(null);
      setEditValue("");
      loadKeys(providerId);
      loadProviders();
      if (res.health && !res.health.ok) {
        alert(res.health.error || "Key updated but failed /models check");
      } else if (res.catalog) {
        alert(`Key updated & OK — ${res.catalog.listed} models in catalog (${res.catalog.seeded} new).`);
      }
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

  // Custom models handlers
  const loadCustomModels = async (providerId: number) => {
    try {
      const res = await request<any[]>(`/providers/${providerId}/custom-models`);
      setProviderCustomModels(prev => ({ ...prev, [providerId]: res }));
    } catch (e) {
      console.error(e);
    }
  };

  const handleAddCustomModel = async (providerId: number) => {
    const inputs = newModelInputs[providerId];
    if (!inputs?.modelId) return;
    try {
      await request(`/providers/${providerId}/custom-models`, {
        method: "POST",
        body: JSON.stringify({
          modelId: inputs.modelId,
          displayName: inputs.displayName || inputs.modelId,
          description: inputs.description || undefined,
          contextLength: inputs.contextLength ? parseInt(inputs.contextLength) : undefined,
          maxOutputTokens: inputs.maxOutputTokens ? parseInt(inputs.maxOutputTokens) : undefined,
          inputPricePerMtok: inputs.inputPricePerMtok ? parseFloat(inputs.inputPricePerMtok) * 1000000 : undefined,
          outputPricePerMtok: inputs.outputPricePerMtok ? parseFloat(inputs.outputPricePerMtok) * 1000000 : undefined,
          inputModalities: inputs.inputModalities ? inputs.inputModalities.split(",").map(s => s.trim()) : undefined,
          outputModalities: inputs.outputModalities ? inputs.outputModalities.split(",").map(s => s.trim()) : undefined,
          supportedFeatures: inputs.supportedFeatures ? inputs.supportedFeatures.split(",").map(s => s.trim()) : undefined,
        }),
      });
      setNewModelInputs(prev => ({ ...prev, [providerId]: { modelId: "", displayName: "", description: "", contextLength: "", maxOutputTokens: "", inputPricePerMtok: "", outputPricePerMtok: "", inputModalities: "", outputModalities: "", supportedFeatures: "" } }));
      loadCustomModels(providerId);
    } catch (e: any) {
      alert("Error: " + e.message);
    }
  };

  const handleUpdateCustomModel = async (providerId: number, modelId: string) => {
    try {
      await request(`/providers/${providerId}/custom-models/${encodeURIComponent(modelId)}`, {
        method: "PUT",
        body: JSON.stringify({
          displayName: editModelValue.displayName || undefined,
          description: editModelValue.description || undefined,
          contextLength: editModelValue.contextLength ? parseInt(editModelValue.contextLength) : undefined,
          maxOutputTokens: editModelValue.maxOutputTokens ? parseInt(editModelValue.maxOutputTokens) : undefined,
          inputPricePerMtok: editModelValue.inputPricePerMtok ? parseFloat(editModelValue.inputPricePerMtok) * 1000000 : undefined,
          outputPricePerMtok: editModelValue.outputPricePerMtok ? parseFloat(editModelValue.outputPricePerMtok) * 1000000 : undefined,
          inputModalities: editModelValue.inputModalities ? editModelValue.inputModalities.split(",").map(s => s.trim()) : undefined,
          outputModalities: editModelValue.outputModalities ? editModelValue.outputModalities.split(",").map(s => s.trim()) : undefined,
          supportedFeatures: editModelValue.supportedFeatures ? editModelValue.supportedFeatures.split(",").map(s => s.trim()) : undefined,
        }),
      });
      setEditingModel(null);
      loadCustomModels(providerId);
    } catch (e: any) {
      alert("Error: " + e.message);
    }
  };

  const handleDeleteCustomModel = async (providerId: number, modelId: string) => {
    if (!window.confirm(`Delete custom model ${modelId}?`)) return;
    try {
      await request(`/providers/${providerId}/custom-models/${encodeURIComponent(modelId)}`, { method: "DELETE" });
      loadCustomModels(providerId);
    } catch (e: any) {
      alert("Error: " + e.message);
    }
  };

  const formatPrice = (microcents: number | null) => {
    if (!microcents) return "-";
    return `$${(microcents / 1000000).toFixed(2)}`;
  };

  const maskKey = (key: string) => {
    if (key.length <= 8) return "****";
    return key.substring(0, 4) + "..." + key.substring(key.length - 4);
  };

  const getKeyStatus = (k: ProviderApiKey) => {
    if (!k.isActive) return { label: "Disabled", color: "bg-gray-500/20 text-gray-400", detail: null as string | null };
    if (k.lastError && /invalid api key|expired|http 401|http 403|forbidden/i.test(k.lastError)) {
      return { label: k.lastError.includes("expired") ? "Expired" : "Invalid", color: "bg-orange-500/20 text-orange-400", detail: k.lastError };
    }
    if (k.isLimited) {
      return { label: "Limited", color: "bg-red-500/20 text-red-400", detail: k.lastError || k.limitedAt };
    }
    if (k.lastError) {
      return { label: "Error", color: "bg-amber-500/20 text-amber-400", detail: k.lastError };
    }
    if (k.lastCheckedAt && (k.lastModelCount || 0) > 0) {
      return {
        label: `Valid · ${k.lastModelCount} models`,
        color: "bg-green-500/20 text-green-400",
        detail: "Key can list /models — synced to Model Monitor",
      };
    }
    if (k.lastCheckedAt) {
      return { label: "Valid · empty list", color: "bg-emerald-500/20 text-emerald-400", detail: "Key OK but /models returned 0" };
    }
    return { label: "Unchecked", color: "bg-slate-500/20 text-slate-400", detail: "Click refresh to probe /models" };
  };

  return (
    <Card className="border-border/50 mt-6">
      <CardHeader>
        <CardTitle className="text-base">Upstream Providers</CardTitle>
        <CardDescription>
          Add upstream + valid API key → auto-fetch /models into Model Monitor.
          Key badge shows Valid when probe OK; catalog count shows models ready to Publish ON.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="grid grid-cols-7 gap-2 border-b border-border/50 pb-2 mb-2 text-sm font-medium text-muted-foreground">
            <div className="col-span-1">Name</div>
            <div className="col-span-2">Endpoint</div>
            <div className="col-span-1">Type</div>
            <div className="col-span-1">Priority</div>
            <div className="col-span-1">Catalog</div>
            <div className="col-span-1 text-right">Actions</div>
          </div>
          {providers.map((p) => (
            <div key={p.id}>
              <div className="grid grid-cols-7 gap-2 items-center border-b border-border/50 pb-2">
                <div className="col-span-1 truncate flex items-center gap-1">
                  <button onClick={() => toggleExpand(p.id)} className="p-0.5 hover:bg-muted rounded">
                    {expandedProvider === p.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </button>
                  {editingProviderField?.providerId === p.id && editingProviderField?.field === "name" ? (
                    <div className="flex items-center gap-1 flex-1 min-w-0">
                      <input
                        autoFocus
                        value={editProviderValue}
                        onChange={(e) => setEditProviderValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSaveProviderField(p.id);
                          else if (e.key === "Escape") handleCancelEditProviderField();
                        }}
                        className="flex-1 min-w-0 px-1 py-0.5 text-sm border border-border rounded bg-background"
                      />
                      <button
                        onClick={() => handleSaveProviderField(p.id)}
                        className="p-0.5 hover:bg-green-500/20 rounded"
                        title="Save"
                      >
                        <Check className="w-3.5 h-3.5 text-green-500" />
                      </button>
                      <button
                        onClick={handleCancelEditProviderField}
                        className="p-0.5 hover:bg-red-500/20 rounded"
                        title="Cancel"
                      >
                        <X className="w-3.5 h-3.5 text-red-500" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 min-w-0">
                      <span className="truncate">{p.name}</span>
                      <button
                        onClick={() => handleEditProviderField(p.id, "name", p.name)}
                        className="p-0.5 hover:bg-muted rounded opacity-60 hover:opacity-100"
                        title="Edit name"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
                <div className="col-span-2 truncate">
                  {editingProviderField?.providerId === p.id && editingProviderField?.field === "endpoint" ? (
                    <div className="flex items-center gap-1">
                      <input
                        autoFocus
                        value={editProviderValue}
                        onChange={(e) => setEditProviderValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSaveProviderField(p.id);
                          else if (e.key === "Escape") handleCancelEditProviderField();
                        }}
                        className="flex-1 min-w-0 px-1 py-0.5 text-sm border border-border rounded bg-background"
                      />
                      <button
                        onClick={() => handleSaveProviderField(p.id)}
                        className="p-0.5 hover:bg-green-500/20 rounded"
                        title="Save"
                      >
                        <Check className="w-3.5 h-3.5 text-green-500" />
                      </button>
                      <button
                        onClick={handleCancelEditProviderField}
                        className="p-0.5 hover:bg-red-500/20 rounded"
                        title="Cancel"
                      >
                        <X className="w-3.5 h-3.5 text-red-500" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 min-w-0">
                      <span className="truncate flex-1">{p.endpoint}</span>
                      <button
                        onClick={() => handleEditProviderField(p.id, "endpoint", p.endpoint)}
                        className="p-0.5 hover:bg-muted rounded opacity-60 hover:opacity-100"
                        title="Edit endpoint"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
                <div className="col-span-1 text-xs">
                  {editingProviderField?.providerId === p.id && editingProviderField?.field === "endpointType" ? (
                    <div className="flex items-center gap-1">
                      <select
                        autoFocus
                        value={editProviderValue}
                        onChange={(e) => setEditProviderValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSaveProviderField(p.id);
                          else if (e.key === "Escape") handleCancelEditProviderField();
                        }}
                        className="px-1 py-0.5 text-xs border border-border rounded bg-background"
                      >
                        <option value="openai">openai</option>
                        <option value="anthropic">anthropic</option>
                        <option value="youcom">youcom</option>
                      </select>
                      <button
                        onClick={() => handleSaveProviderField(p.id)}
                        className="p-0.5 hover:bg-green-500/20 rounded"
                        title="Save"
                      >
                        <Check className="w-3.5 h-3.5 text-green-500" />
                      </button>
                      <button
                        onClick={handleCancelEditProviderField}
                        className="p-0.5 hover:bg-red-500/20 rounded"
                        title="Cancel"
                      >
                        <X className="w-3.5 h-3.5 text-red-500" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <span className={`px-1.5 py-0.5 rounded text-xs ${p.endpointType === "anthropic" ? "bg-orange-500/20 text-orange-400" : p.endpointType === "youcom" ? "bg-green-500/20 text-green-400" : "bg-blue-500/20 text-blue-400"}`}>
                        {p.endpointType || "openai"}
                      </span>
                      <button
                        onClick={() => handleEditProviderField(p.id, "endpointType", p.endpointType || "openai")}
                        className="p-0.5 hover:bg-muted rounded opacity-60 hover:opacity-100"
                        title="Edit type"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
                <div className="col-span-1">
                  {editingProviderField?.providerId === p.id && editingProviderField?.field === "priority" ? (
                    <div className="flex items-center gap-1">
                      <input
                        autoFocus
                        type="number"
                        value={editProviderValue}
                        onChange={(e) => setEditProviderValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSaveProviderField(p.id);
                          else if (e.key === "Escape") handleCancelEditProviderField();
                        }}
                        className="w-16 px-1 py-0.5 text-sm border border-border rounded bg-background"
                      />
                      <button
                        onClick={() => handleSaveProviderField(p.id)}
                        className="p-0.5 hover:bg-green-500/20 rounded"
                        title="Save"
                      >
                        <Check className="w-3.5 h-3.5 text-green-500" />
                      </button>
                      <button
                        onClick={handleCancelEditProviderField}
                        className="p-0.5 hover:bg-red-500/20 rounded"
                        title="Cancel"
                      >
                        <X className="w-3.5 h-3.5 text-red-500" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <span>{p.priority}</span>
                      <button
                        onClick={() => handleEditProviderField(p.id, "priority", p.priority)}
                        className="p-0.5 hover:bg-muted rounded opacity-60 hover:opacity-100"
                        title="Edit priority"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
                <div className="col-span-1">
                  {(p.catalogModelCount || 0) > 0 ? (
                    <span
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-cyan-500/15 text-cyan-400"
                      title="Models in Model Monitor — Publish ON to expose to clients"
                    >
                      <Box className="w-3 h-3" />
                      {p.catalogModelCount}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground" title="No models in catalog yet — check a valid API key">
                      —
                    </span>
                  )}
                </div>
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
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 ml-auto text-xs"
                      onClick={async () => {
                        try {
                          const res = await request<{
                            results: Array<{ ok: boolean; modelCount?: number }>;
                            catalog?: { listed: number; seeded: number } | null;
                          }>(`/providers/${p.id}/keys/check-all`, { method: "POST" });
                          const ok = (res.results || []).filter((r) => r.ok).length;
                          if (res.catalog) {
                            alert(
                              `Checked ${res.results.length} keys (${ok} OK). Catalog: ${res.catalog.listed} models (${res.catalog.seeded} new).`,
                            );
                          } else {
                            alert(`Checked ${res.results.length} keys — ${ok} valid.`);
                          }
                          loadKeys(p.id);
                          loadProviders();
                        } catch (e: any) {
                          alert("Check all failed: " + e.message);
                        }
                      }}
                      title="Probe all keys and sync /models to catalog"
                    >
                      <RotateCcw className="w-3 h-3 mr-1" /> Check all → sync catalog
                    </Button>
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
                            <span
                              className={`px-1.5 py-0.5 rounded text-xs whitespace-nowrap ${status.color}`}
                              title={status.detail || undefined}
                            >
                              {status.label}
                            </span>
                            {status.detail && (
                              <span className="text-[10px] text-orange-400/90 truncate max-w-[140px]" title={status.detail}>
                                {status.detail}
                              </span>
                            )}

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
                              {/* Check key against upstream /models */}
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2"
                                onClick={async () => {
                                  try {
                                    const res = await request<{
                                      ok: boolean;
                                      error?: string | null;
                                      modelCount?: number;
                                      catalog?: { listed: number; seeded: number } | null;
                                    }>(
                                      `/providers/${p.id}/keys/${k.id}/check`,
                                      { method: "POST" },
                                    );
                                    if (!res.ok) {
                                      alert(res.error || "Invalid API key");
                                    } else if (res.catalog) {
                                      alert(
                                        `Key OK — ${res.modelCount ?? 0} models listed. Catalog: ${res.catalog.listed} total (${res.catalog.seeded} new). Publish ON di Model Monitor.`,
                                      );
                                    } else {
                                      alert(`Key OK — ${res.modelCount ?? 0} models listed.`);
                                    }
                                    loadKeys(p.id);
                                    loadProviders();
                                  } catch (e: any) {
                                    alert("Check failed: " + e.message);
                                  }
                                }}
                                title="Check key → auto-sync /models to Model Monitor"
                              >
                                <RotateCcw className="w-3 h-3" />
                              </Button>

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

                              {/* Retry (only for limited / invalid keys) */}
                              {(k.isLimited || !!k.lastError) && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 px-2"
                                  onClick={() => handleResetKey(p.id, k.id)}
                                  title="Retry (clear limited / error status)"
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

                  {/* Custom Models Section */}
                  <div className="mt-4 pt-4 border-t border-border/50">
                    <button
                      onClick={() => {
                        if (expandedCustomModels === p.id) {
                          setExpandedCustomModels(null);
                        } else {
                          setExpandedCustomModels(p.id);
                          loadCustomModels(p.id);
                        }
                      }}
                      className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
                    >
                      <Box className="w-4 h-4" />
                      <span>Custom Models ({(providerCustomModels[p.id] || []).length})</span>
                      {expandedCustomModels === p.id ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    </button>

                    {expandedCustomModels === p.id && (
                      <div className="mt-3 space-y-2">
                        {(providerCustomModels[p.id] || []).length === 0 ? (
                          <p className="text-xs text-muted-foreground">No custom models. Add one below.</p>
                        ) : (
                          <div className="space-y-1">
                            {(providerCustomModels[p.id] || []).map((m) => {
                              const isEditing = editingModel?.providerId === p.id && editingModel?.modelId === m.modelId;
                              return (
                                <div key={m.modelId} className="flex items-center gap-2 p-2 bg-background rounded border border-border/50 text-xs">
                                  {isEditing ? (
                                    <div className="flex-1 space-y-1">
                                      <div className="grid grid-cols-4 gap-1">
                                        <Input value={editModelValue.displayName} onChange={e => setEditModelValue(prev => ({ ...prev, displayName: e.target.value }))} placeholder="Display Name" className="h-6 text-xs" />
                                        <Input value={editModelValue.description} onChange={e => setEditModelValue(prev => ({ ...prev, description: e.target.value }))} placeholder="Description" className="h-6 text-xs" />
                                        <Input value={editModelValue.contextLength} onChange={e => setEditModelValue(prev => ({ ...prev, contextLength: e.target.value }))} placeholder="Context Length" className="h-6 text-xs" />
                                        <Input value={editModelValue.maxOutputTokens} onChange={e => setEditModelValue(prev => ({ ...prev, maxOutputTokens: e.target.value }))} placeholder="Max Output Tokens" className="h-6 text-xs" />
                                      </div>
                                      <div className="grid grid-cols-4 gap-1">
                                        <Input value={editModelValue.inputPricePerMtok} onChange={e => setEditModelValue(prev => ({ ...prev, inputPricePerMtok: e.target.value }))} placeholder="In $/M" className="h-6 text-xs" />
                                        <Input value={editModelValue.outputPricePerMtok} onChange={e => setEditModelValue(prev => ({ ...prev, outputPricePerMtok: e.target.value }))} placeholder="Out $/M" className="h-6 text-xs" />
                                        <Input value={editModelValue.inputModalities} onChange={e => setEditModelValue(prev => ({ ...prev, inputModalities: e.target.value }))} placeholder="Input (text,image)" className="h-6 text-xs" />
                                        <Input value={editModelValue.outputModalities} onChange={e => setEditModelValue(prev => ({ ...prev, outputModalities: e.target.value }))} placeholder="Output (text)" className="h-6 text-xs" />
                                      </div>
                                      <Input value={editModelValue.supportedFeatures} onChange={e => setEditModelValue(prev => ({ ...prev, supportedFeatures: e.target.value }))} placeholder="Features (tools,reasoning)" className="h-6 text-xs" />
                                    </div>
                                  ) : (
                                    <div className="flex-1 min-w-0">
                                      <code className="font-mono">{m.modelId}</code>
                                      <span className="text-muted-foreground ml-2">{m.displayName}</span>
                                      {m.description && <span className="text-muted-foreground ml-2 text-[10px] truncate max-w-[200px]">({m.description})</span>}
                                      {m.contextLength && <span className="text-muted-foreground ml-2">{Math.round(m.contextLength / 1000)}K</span>}
                                      {m.maxOutputTokens && <span className="text-muted-foreground ml-2">out:{Math.round(m.maxOutputTokens / 1000)}K</span>}
                                      {m.inputPricePerMtok > 0 && <span className="text-muted-foreground ml-2">{formatPrice(m.inputPricePerMtok)}/M</span>}
                                      {m.outputPricePerMtok > 0 && <span className="text-muted-foreground ml-2">{formatPrice(m.outputPricePerMtok)}/M</span>}
                                    </div>
                                  )}
                                  <div className="flex gap-1">
                                    {isEditing ? (
                                      <>
                                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleUpdateCustomModel(p.id, m.modelId)}><Check className="w-3 h-3 text-green-500" /></Button>
                                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setEditingModel(null)}><X className="w-3 h-3 text-red-500" /></Button>
                                      </>
                                    ) : (
                                      <>
                                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setEditingModel({ providerId: p.id, modelId: m.modelId }); setEditModelValue({ displayName: m.displayName || "", description: m.description || "", contextLength: m.contextLength?.toString() || "", maxOutputTokens: m.maxOutputTokens?.toString() || "", inputPricePerMtok: m.inputPricePerMtok ? (m.inputPricePerMtok / 1000000).toString() : "", outputPricePerMtok: m.outputPricePerMtok ? (m.outputPricePerMtok / 1000000).toString() : "", inputModalities: (() => { try { return JSON.parse(m.inputModalities || "[]").join(", "); } catch { return ""; } })(), outputModalities: (() => { try { return JSON.parse(m.outputModalities || "[]").join(", "); } catch { return ""; } })(), supportedFeatures: (() => { try { return JSON.parse(m.supportedFeatures || "[]").join(", "); } catch { return ""; } })() }); }}><Pencil className="w-3 h-3" /></Button>
                                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleDeleteCustomModel(p.id, m.modelId)}><Trash className="w-3 h-3 text-red-500" /></Button>
                                      </>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Add new custom model */}
                        <div className="space-y-1 mt-2 p-2 bg-muted/30 rounded border border-border/50">
                          <div className="grid grid-cols-4 gap-1">
                            <Input
                              value={newModelInputs[p.id]?.modelId || ""}
                              onChange={e => setNewModelInputs(prev => ({ ...prev, [p.id]: { ...prev[p.id], modelId: e.target.value } }))}
                              placeholder="Model ID (e.g. minimax/MiniMax-M3)"
                              className="text-xs h-7"
                            />
                            <Input
                              value={newModelInputs[p.id]?.displayName || ""}
                              onChange={e => setNewModelInputs(prev => ({ ...prev, [p.id]: { ...prev[p.id], displayName: e.target.value } }))}
                              placeholder="Display Name"
                              className="text-xs h-7"
                            />
                            <Input
                              value={newModelInputs[p.id]?.contextLength || ""}
                              onChange={e => setNewModelInputs(prev => ({ ...prev, [p.id]: { ...prev[p.id], contextLength: e.target.value } }))}
                              placeholder="Context Length"
                              type="number"
                              className="text-xs h-7"
                            />
                            <Input
                              value={newModelInputs[p.id]?.maxOutputTokens || ""}
                              onChange={e => setNewModelInputs(prev => ({ ...prev, [p.id]: { ...prev[p.id], maxOutputTokens: e.target.value } }))}
                              placeholder="Max Output Tokens"
                              type="number"
                              className="text-xs h-7"
                            />
                          </div>
                          <div className="grid grid-cols-4 gap-1">
                            <Input
                              value={newModelInputs[p.id]?.inputPricePerMtok || ""}
                              onChange={e => setNewModelInputs(prev => ({ ...prev, [p.id]: { ...prev[p.id], inputPricePerMtok: e.target.value } }))}
                              placeholder="In $/M tokens"
                              className="text-xs h-7"
                            />
                            <Input
                              value={newModelInputs[p.id]?.outputPricePerMtok || ""}
                              onChange={e => setNewModelInputs(prev => ({ ...prev, [p.id]: { ...prev[p.id], outputPricePerMtok: e.target.value } }))}
                              placeholder="Out $/M tokens"
                              className="text-xs h-7"
                            />
                            <Input
                              value={newModelInputs[p.id]?.inputModalities || ""}
                              onChange={e => setNewModelInputs(prev => ({ ...prev, [p.id]: { ...prev[p.id], inputModalities: e.target.value } }))}
                              placeholder="Input (text,image)"
                              className="text-xs h-7"
                            />
                            <Input
                              value={newModelInputs[p.id]?.outputModalities || ""}
                              onChange={e => setNewModelInputs(prev => ({ ...prev, [p.id]: { ...prev[p.id], outputModalities: e.target.value } }))}
                              placeholder="Output (text)"
                              className="text-xs h-7"
                            />
                          </div>
                          <div className="grid grid-cols-5 gap-1">
                            <Input
                              value={newModelInputs[p.id]?.description || ""}
                              onChange={e => setNewModelInputs(prev => ({ ...prev, [p.id]: { ...prev[p.id], description: e.target.value } }))}
                              placeholder="Description"
                              className="text-xs h-7 col-span-3"
                            />
                            <Input
                              value={newModelInputs[p.id]?.supportedFeatures || ""}
                              onChange={e => setNewModelInputs(prev => ({ ...prev, [p.id]: { ...prev[p.id], supportedFeatures: e.target.value } }))}
                              placeholder="Features (tools,reasoning)"
                              className="text-xs h-7"
                            />
                            <Button size="sm" className="h-7" onClick={() => handleAddCustomModel(p.id)} disabled={!newModelInputs[p.id]?.modelId}>
                              <Plus className="w-3 h-3 mr-1" /> Add
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}
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
                <option value="youcom">You.com</option>
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
