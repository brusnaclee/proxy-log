import { useState, useEffect } from "react";
import { Plus, RotateCcw, Trash2, Copy, Check, X, Monitor, Smartphone, Globe } from "lucide-react";
import { api } from "@/lib/api";
import { formatRelativeTime } from "@/lib/utils";

interface KeyInfo {
  id: number;
  name: string;
  keyPrefix: string;
  keyMasked: string;
  isActive: boolean;
  isTrial: boolean;
  createdAt: string;
  requestsToday: number;
}

interface Device {
  fingerprint: string;
  deviceName: string;
  ideDetected: string;
  osDetected: string;
  requestCount: number;
  lastSeen: string;
  isBlocked: boolean;
}

function getDeviceIcon(os: string) {
  const lower = os.toLowerCase();
  if (lower.includes("windows")) return <Monitor className="w-4 h-4" />;
  if (lower.includes("android") || lower.includes("ios")) return <Smartphone className="w-4 h-4" />;
  return <Globe className="w-4 h-4" />;
}

export default function KeysPage() {
  const [keys, setKeys] = useState<KeyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [creating, setCreating] = useState(false);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null);
  const [expandedKey, setExpandedKey] = useState<number | null>(null);
  const [devices, setDevices] = useState<Record<number, Device[]>>({});
  const [loadingDevices, setLoadingDevices] = useState<Record<number, boolean>>({});
  const [rotating, setRotating] = useState<number | null>(null);
  const [rotatedKey, setRotatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [deletingDevice, setDeletingDevice] = useState<{ keyId: number; fp: string } | null>(null);

  const loadKeys = () => {
    setLoading(true);
    api.keys
      .list()
      .then((data) => setKeys(data))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load keys"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadKeys();
  }, []);

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) return;

    setCreating(true);
    try {
      const result = await api.keys.create(newKeyName.trim());
      setNewlyCreatedKey(result.key);
      setNewKeyName("");
      setShowCreateModal(false);
      loadKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create key");
    } finally {
      setCreating(false);
    }
  };

  const handleRotateKey = async (id: number) => {
    setRotating(id);
    try {
      const result = await api.keys.rotate(id);
      setRotatedKey(result.key);
      loadKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rotate key");
    } finally {
      setRotating(null);
    }
  };

  const loadDevices = async (keyId: number) => {
    if (expandedKey === keyId) {
      setExpandedKey(null);
      return;
    }

    setExpandedKey(keyId);

    if (devices[keyId]) return;

    setLoadingDevices((prev) => ({ ...prev, [keyId]: true }));
    try {
      const result = await api.keys.devices(keyId);
      setDevices((prev) => ({ ...prev, [keyId]: result }));
    } catch (err) {
      console.error("Failed to load devices:", err);
    } finally {
      setLoadingDevices((prev) => ({ ...prev, [keyId]: false }));
    }
  };

  const handleDeleteDevice = async (keyId: number, fingerprint: string) => {
    setDeletingDevice({ keyId, fp: fingerprint });
    try {
      await api.keys.deleteDevice(keyId, fingerprint);
      setDevices((prev) => ({
        ...prev,
        [keyId]: prev[keyId].filter((d) => d.fingerprint !== fingerprint),
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete device");
    } finally {
      setDeletingDevice(null);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">API Keys</h1>
          <p className="text-sm text-muted-foreground">Manage your API keys and devices</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground font-medium rounded-lg hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Create Key
        </button>
      </div>

      {/* Newly created key warning */}
      {newlyCreatedKey && (
        <div className="bg-yellow-400/10 border border-yellow-400/20 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <p className="text-sm font-medium text-yellow-400 mb-1">
                New API Key Created
              </p>
              <p className="text-xs text-muted-foreground mb-3">
                Copy this key now. You will not be able to see it again.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-background px-3 py-2 rounded-lg text-sm text-foreground font-mono overflow-x-auto">
                  {newlyCreatedKey}
                </code>
                <button
                  onClick={() => copyToClipboard(newlyCreatedKey)}
                  className="p-2 hover:bg-accent rounded-lg transition-colors"
                >
                  {copied ? (
                    <Check className="w-4 h-4 text-green-400" />
                  ) : (
                    <Copy className="w-4 h-4 text-muted-foreground" />
                  )}
                </button>
                <button
                  onClick={() => setNewlyCreatedKey(null)}
                  className="p-2 hover:bg-accent rounded-lg transition-colors"
                >
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Rotated key warning */}
      {rotatedKey && (
        <div className="bg-orange-400/10 border border-orange-400/20 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <p className="text-sm font-medium text-orange-400 mb-1">
                Key Rotated Successfully
              </p>
              <p className="text-xs text-muted-foreground mb-3">
                Your old key has been invalidated. Copy your new key below.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-background px-3 py-2 rounded-lg text-sm text-foreground font-mono overflow-x-auto">
                  {rotatedKey}
                </code>
                <button
                  onClick={() => copyToClipboard(rotatedKey)}
                  className="p-2 hover:bg-accent rounded-lg transition-colors"
                >
                  {copied ? (
                    <Check className="w-4 h-4 text-green-400" />
                  ) : (
                    <Copy className="w-4 h-4 text-muted-foreground" />
                  )}
                </button>
                <button
                  onClick={() => setRotatedKey(null)}
                  className="p-2 hover:bg-accent rounded-lg transition-colors"
                >
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="p-3 bg-red-400/10 border border-red-400/20 rounded-lg text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Keys list */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="bg-card border border-border rounded-xl p-4 animate-pulse">
              <div className="h-5 w-32 bg-muted rounded mb-2" />
              <div className="h-4 w-48 bg-muted rounded" />
            </div>
          ))}
        </div>
      ) : keys.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-8 text-center">
          <p className="text-muted-foreground">No API keys yet</p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="mt-4 text-primary hover:underline text-sm"
          >
            Create your first key
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {keys.map((key) => (
            <div key={key.id} className="bg-card border border-border rounded-xl overflow-hidden">
              {/* Key header */}
              <div className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-medium text-foreground">{key.name}</h3>
                      <span
                        className={`px-2 py-0.5 text-xs rounded-full ${
                          key.isActive
                            ? "bg-green-400/10 text-green-400"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {key.isActive ? "Active" : "Inactive"}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground font-mono">
                      {key.keyMasked}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleRotateKey(key.id)}
                      disabled={rotating === key.id}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors disabled:opacity-50"
                      title="Rotate key"
                    >
                      <RotateCcw className={`w-3.5 h-3.5 ${rotating === key.id ? "animate-spin" : ""}`} />
                      Rotate
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-4 mt-3 text-xs text-muted-foreground">
                  <span>Created {formatRelativeTime(key.createdAt)}</span>
                  <span>{key.requestsToday.toLocaleString()} requests today</span>
                </div>

                {/* Devices section */}
                <button
                  onClick={() => loadDevices(key.id)}
                  className="flex items-center gap-1.5 mt-3 text-xs text-primary hover:underline"
                >
                  {loadingDevices[key.id] ? (
                    <span>Loading devices...</span>
                  ) : (
                    <>
                      <span>{devices[key.id]?.length || 0} device(s)</span>
                      <span className="text-muted-foreground">
                        {expandedKey === key.id ? "(hide)" : "(show)"}
                      </span>
                    </>
                  )}
                </button>
              </div>

              {/* Devices list */}
              {expandedKey === key.id && (
                <div className="border-t border-border bg-accent/30">
                  {loadingDevices[key.id] ? (
                    <div className="p-4 text-sm text-muted-foreground">Loading...</div>
                  ) : !devices[key.id]?.length ? (
                    <div className="p-4 text-sm text-muted-foreground">No devices recorded</div>
                  ) : (
                    <div className="divide-y divide-border">
                      {devices[key.id].map((device) => (
                        <div
                          key={device.fingerprint}
                          className="flex items-center justify-between p-4"
                        >
                          <div className="flex items-center gap-3">
                            {getDeviceIcon(device.osDetected)}
                            <div>
                              <p className="text-sm text-foreground">{device.ideDetected}</p>
                              <p className="text-xs text-muted-foreground">
                                {device.osDetected} • Last seen {formatRelativeTime(device.lastSeen)}
                              </p>
                            </div>
                          </div>
                          <button
                            onClick={() => handleDeleteDevice(key.id, device.fingerprint)}
                            disabled={deletingDevice?.fp === device.fingerprint}
                            className="p-2 text-muted-foreground hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors disabled:opacity-50"
                            title="Revoke device"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create key modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-xl p-6 w-full max-w-md animate-fade-in">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-foreground">Create API Key</h2>
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setNewKeyName("");
                }}
                className="p-1 hover:bg-accent rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-muted-foreground" />
              </button>
            </div>
            <form onSubmit={handleCreateKey} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Key Name
                </label>
                <input
                  type="text"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  placeholder="e.g., VS Code, Production"
                  className="w-full px-3 py-2.5 bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  autoFocus
                  required
                />
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateModal(false);
                    setNewKeyName("");
                  }}
                  className="flex-1 py-2.5 border border-border text-foreground font-medium rounded-lg hover:bg-accent transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating || !newKeyName.trim()}
                  className="flex-1 py-2.5 bg-primary text-primary-foreground font-medium rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {creating ? "Creating..." : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
