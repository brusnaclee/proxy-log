import { useState, useEffect, useCallback } from "react";
import {
  Plus, RotateCcw, Trash2, Copy, Check, X, Monitor, Smartphone, Globe,
  ChevronDown, ChevronUp, AlertTriangle,
} from "lucide-react";
import { api, type KeyInfo, type DeviceInfo, type MeResponse } from "@/lib/api";
import { formatRelativeTime, formatNumber } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

function getDeviceIcon(os: string) {
  const lower = (os || "").toLowerCase();
  if (lower.includes("windows") || lower.includes("mac") || lower.includes("linux")) return <Monitor className="w-4 h-4" />;
  if (lower.includes("android") || lower.includes("ios")) return <Smartphone className="w-4 h-4" />;
  return <Globe className="w-4 h-4" />;
}

interface ConfirmModal {
  title: string;
  message: string;
  onConfirm: () => void;
}

async function copyText(text: string): Promise<void> {
  const value = String(text || "");
  if (!value) throw new Error("empty");
  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return;
    }
  } catch { /* fall through */ }
  const ta = document.createElement("textarea");
  ta.value = value;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(ta);
  if (!ok) throw new Error("copy failed");
}

function CopyInline({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const { t } = useI18n();
  return (
    <button
      onClick={() => {
        void copyText(text)
          .then(() => {
            setFailed(false);
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
          })
          .catch(() => {
            setFailed(true);
            setTimeout(() => setFailed(false), 2500);
          });
      }}
      className="inline-flex items-center gap-1 p-1.5 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded transition-colors"
      title={failed ? "Copy failed" : t("Copy")}
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className={`w-3.5 h-3.5 ${failed ? "text-red-400" : ""}`} />}
    </button>
  );
}

export default function KeysPage() {
  const { t, lang } = useI18n();
  const [keys, setKeys] = useState<KeyInfo[]>([]);
  const [user, setUser] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [creating, setCreating] = useState(false);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null);

  const [expandedKey, setExpandedKey] = useState<number | null>(null);
  const [devices, setDevices] = useState<Record<number, DeviceInfo[]>>({});
  const [blacklistRules, setBlacklistRules] = useState<Record<number, Array<{ fingerprint?: string | null; listType: string; label?: string | null }>>>({});
  const [loadingDevices, setLoadingDevices] = useState<Record<number, boolean>>({});
  const [deviceError, setDeviceError] = useState<Record<number, string | null>>({});
  const [unblocking, setUnblocking] = useState<string | null>(null);

  const [rotating, setRotating] = useState<number | null>(null);
  const [rotatedKey, setRotatedKey] = useState<string | null>(null);

  const [confirmModal, setConfirmModal] = useState<ConfirmModal | null>(null);

  const loadKeys = useCallback(() => {
    setLoading(true);
    Promise.all([api.keys.list(), api.me()])
      .then(([keysData, userData]) => {
        setKeys(keysData);
        setUser(userData);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load keys"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadKeys(); }, [loadKeys]);

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

  const doRotateKey = async (id: number) => {
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

  const handleRotateKey = (key: KeyInfo) => {
    setConfirmModal({
      title: t("Confirm rotate"),
      message: t("Are you sure you want to rotate this key? Your old key will be immediately invalidated."),
      onConfirm: () => {
        setConfirmModal(null);
        doRotateKey(key.id);
      },
    });
  };

  const doDeleteKey = async (id: number) => {
    try {
      await api.keys.delete(id);
      loadKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete key");
    }
  };

  const handleDeleteKey = (key: KeyInfo) => {
    setConfirmModal({
      title: t("Confirm delete"),
      message: t("Are you sure you want to delete this API key? This cannot be undone."),
      onConfirm: () => {
        setConfirmModal(null);
        doDeleteKey(key.id);
      },
    });
  };

  const loadDevices = async (keyId: number) => {
    if (expandedKey === keyId) {
      setExpandedKey(null);
      return;
    }
    setExpandedKey(keyId);
    // Always refetch on expand
    setLoadingDevices((prev) => ({ ...prev, [keyId]: true }));
    setDeviceError((prev) => ({ ...prev, [keyId]: null }));
    try {
      const [result, policy] = await Promise.all([
        api.keys.devices(keyId),
        api.keys.devicePolicyRules(keyId).catch(() => ({ rules: [] as any[] })),
      ]);
      setDevices((prev) => ({ ...prev, [keyId]: result }));
      setBlacklistRules((prev) => ({
        ...prev,
        [keyId]: (policy.rules || []).filter((r: any) => r.listType === "block" && r.fingerprint),
      }));
    } catch (err) {
      setDeviceError((prev) => ({
        ...prev,
        [keyId]: err instanceof Error ? err.message : "Failed to load devices",
      }));
    } finally {
      setLoadingDevices((prev) => ({ ...prev, [keyId]: false }));
    }
  };

  const doUnblockDevice = async (keyId: number, fingerprint: string) => {
    setUnblocking(fingerprint);
    try {
      await api.keys.unblockDevice(keyId, fingerprint);
      setBlacklistRules((prev) => ({
        ...prev,
        [keyId]: (prev[keyId] || []).filter((r) => r.fingerprint !== fingerprint),
      }));
      setDevices((prev) => ({
        ...prev,
        [keyId]: (prev[keyId] || []).map((d) =>
          d.fingerprint === fingerprint ? { ...d, isBlocked: false } : d,
        ),
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to unblock device");
    } finally {
      setUnblocking(null);
    }
  };

  const doDeleteDevice = async (keyId: number, fingerprint: string) => {
    try {
      await api.keys.deleteDevice(keyId, fingerprint);
      setDevices((prev) => ({
        ...prev,
        [keyId]: (prev[keyId] || []).filter((d) => d.fingerprint !== fingerprint),
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke device");
    }
  };

  const handleDeleteDevice = (keyId: number, device: DeviceInfo) => {
    setConfirmModal({
      title: t("Confirm revoke"),
      message: t("Are you sure you want to revoke this device? It will no longer be able to use this key."),
      onConfirm: () => {
        setConfirmModal(null);
        doDeleteDevice(keyId, device.fingerprint);
      },
    });
  };

  const isTrial = user?.accountType === "trial";
  const deviceUsage = user?.deviceUsage;

  const RevealBanner = ({
    keyStr, title, subtitle, color, onDismiss,
  }: { keyStr: string; title: string; subtitle: string; color: "yellow" | "orange"; onDismiss: () => void }) => {
    const [copied, setCopied] = useState(false);
    const copy = () => {
      navigator.clipboard.writeText(keyStr).catch(() => {});
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    };
    const colorCls = color === "yellow"
      ? "bg-yellow-400/10 border-yellow-400/20 text-yellow-400"
      : "bg-orange-400/10 border-orange-400/20 text-orange-400";
    return (
      <div className={`border rounded-xl p-4 ${colorCls}`}>
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <p className="text-sm font-medium mb-1">{title}</p>
            <p className="text-xs text-muted-foreground mb-3">{subtitle}</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-background px-3 py-2 rounded-lg text-sm text-foreground font-mono overflow-x-auto">
                {keyStr}
              </code>
              <button onClick={copy} className="p-2 hover:bg-accent rounded-lg transition-colors">
                {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4 text-muted-foreground" />}
              </button>
              <button onClick={onDismiss} className="p-2 hover:bg-accent rounded-lg transition-colors">
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{t("API Keys")}</h1>
          <p className="text-sm text-muted-foreground">{t("Manage your API keys and devices")}</p>
          <p className="text-xs text-muted-foreground mt-1.5 max-w-xl">
            {t("Primary key Discord note")}
          </p>
        </div>
        {!isTrial && (
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground font-medium rounded-lg hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            {t("Create Key")}
          </button>
        )}
        {isTrial && (
          <span className="text-xs text-muted-foreground italic max-w-xs text-right">
            Trial: 1 key · all models + auto · upgrade to Phantom for multi-key and larger daily base
          </span>
        )}
      </div>

      {/* Device usage strip */}
      {deviceUsage && deviceUsage.max > 0 && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Monitor className="w-4 h-4" />
          <span>{t("Devices")}: {deviceUsage.used} / {deviceUsage.max}</span>
        </div>
      )}

      {/* Account shared remaining (same pool for all keys) */}
      {user?.limits && (user.keyCount || 0) > 0 && (
        <div className="rounded-xl border border-border/50 bg-card/40 px-4 py-3 space-y-1.5">
          <p className="text-xs font-medium text-foreground">
            {lang === "id" ? "Sisa kuota akun (shared semua key)" : "Account remaining (shared across all keys)"}
            {(user.keyCount || 0) > 1 ? ` · ${user.keyCount} keys` : ""}
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground font-mono">
            {user.limits.dailyInputTokenLimit > 0 && (
              <span>
                In {formatNumber(Math.max(0, user.limits.dailyInputTokenLimit - (user.usageToday?.promptTokens || 0)))}
                {" / "}{formatNumber(user.limits.dailyInputTokenLimit)}
              </span>
            )}
            {user.limits.dailyOutputTokenLimit > 0 && (
              <span>
                Out {formatNumber(Math.max(0, user.limits.dailyOutputTokenLimit - (user.usageToday?.completionTokens || 0)))}
                {" / "}{formatNumber(user.limits.dailyOutputTokenLimit)}
              </span>
            )}
            {user.limits.promptLimit > 0 && (
              <span>
                Prompts {Math.max(0, user.limits.promptLimit - (user.usageToday?.promptCount || 0))}
                {" / "}{user.limits.promptLimit}
                {user.limits.promptLimitWindow ? ` (${user.limits.promptLimitWindow})` : ""}
              </span>
            )}
            {(user.limits.rateLimit || 0) > 0 && (
              <span>
                API {Math.max(0, (user.limits.rateLimit || 0) - (user.usageToday?.apiCallCount || 0))}
                {" / "}{user.limits.rateLimit}
              </span>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground">
            {lang === "id"
              ? "Angka di tiap key = kontribusi key itu hari ini. Limit & sisa = satu pool akun."
              : "Per-key numbers = that key's contribution today. Limits & remaining = one account pool."}
          </p>
        </div>
      )}

      {/* Newly created key */}
      {newlyCreatedKey && (
        <RevealBanner
          keyStr={newlyCreatedKey}
          title={t("new key created")}
          subtitle="Copy this key now. You will not be able to see it again."
          color="yellow"
          onDismiss={() => setNewlyCreatedKey(null)}
        />
      )}

      {/* Rotated key */}
      {rotatedKey && (
        <RevealBanner
          keyStr={rotatedKey}
          title={t("Key rotated")}
          subtitle="Your old key has been invalidated. Copy your new key below."
          color="orange"
          onDismiss={() => setRotatedKey(null)}
        />
      )}

      {/* Error */}
      {error && (
        <div className="p-3 bg-red-400/10 border border-red-400/20 rounded-lg text-red-400 text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          {error}
          <button onClick={() => setError("")} className="ml-auto p-0.5 hover:opacity-70">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Keys list */}
      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="bg-card border border-border rounded-xl p-4 sm:p-5 animate-pulse">
              <div className="h-5 w-32 bg-muted rounded mb-2" />
              <div className="h-4 w-48 bg-muted rounded" />
            </div>
          ))}
        </div>
      ) : keys.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-8 text-center">
          <p className="text-muted-foreground">No API keys yet</p>
          {!isTrial && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="mt-4 text-primary hover:underline text-sm"
            >
              Create your first key
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {keys.map((key) => (
            <div key={key.id} className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="p-4 sm:p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <h3 className="font-medium text-foreground">{key.name}</h3>
                      <span className={`px-2 py-0.5 text-xs rounded-full ${
                        key.isActive ? "bg-green-400/10 text-green-400" : "bg-muted text-muted-foreground"
                      }`}>
                        {key.isActive ? "Active" : "Inactive"}
                      </span>
                      {key.isPrimary && (
                        <span className="px-2 py-0.5 text-xs rounded-full bg-sky-400/10 text-sky-400">
                          Primary
                        </span>
                      )}
                      <span className={`px-2 py-0.5 text-xs rounded-full ${
                        key.isTrial
                          ? "bg-yellow-400/10 text-yellow-400"
                          : user?.accountType === "staff"
                            ? "bg-violet-400/10 text-violet-300"
                            : user?.accountType === "pro"
                              ? "bg-emerald-400/10 text-emerald-300"
                              : user?.accountType === "premium"
                                ? "bg-amber-400/10 text-amber-300"
                                : "bg-primary/10 text-primary"
                      }`}>
                        {key.isTrial
                          ? t("Trial")
                          : user?.accountType === "staff"
                            ? t("Staff")
                            : user?.accountType === "pro"
                              ? t("Pro")
                              : user?.accountType === "premium"
                                ? t("Premium")
                                : t("Phantom")}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <p className="text-sm text-muted-foreground font-mono">{key.keyMasked}</p>
                      <CopyInline text={key.key || key.keyMasked} />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleRotateKey(key)}
                      disabled={rotating === key.id}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors disabled:opacity-50"
                      title={t("Rotate")}
                    >
                      <RotateCcw className={`w-3.5 h-3.5 ${rotating === key.id ? "animate-spin" : ""}`} />
                      {t("Rotate")}
                    </button>
                    {key.canDelete && (
                      <button
                        onClick={() => handleDeleteKey(key)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-400 hover:text-red-300 hover:bg-red-400/10 rounded-lg transition-colors"
                        title={t("Delete")}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        {t("Delete")}
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-4 mt-3 text-xs text-muted-foreground">
                  <span>Created {formatRelativeTime(key.createdAt)}</span>
                  <span>
                    {key.requestsToday.toLocaleString()} prompts
                    {typeof key.apiCallsToday === "number" ? ` · ${key.apiCallsToday.toLocaleString()} API` : ""}
                    {typeof key.tokensToday === "number" && key.tokensToday > 0
                      ? ` · ${formatNumber(key.tokensToday)} tok`
                      : ""}{" "}
                    today
                    {(user?.keyCount || 0) > 1
                      ? lang === "id"
                        ? " · kontribusi key ini"
                        : " · this key"
                      : ""}
                  </span>
                </div>

                {/* Expand: usage detail + devices */}
                <button
                  onClick={() => loadDevices(key.id)}
                  className="flex items-center gap-1.5 mt-3 text-xs text-primary hover:underline"
                >
                  {loadingDevices[key.id] ? (
                    <span>Loading...</span>
                  ) : (
                    <>
                      <span>
                        {expandedKey === key.id ? t("Hide details") : t("Show usage & devices")}
                        {devices[key.id] ? ` · ${devices[key.id].length} ${t("Devices").toLowerCase()}` : ""}
                      </span>
                      {expandedKey === key.id ? (
                        <ChevronUp className="w-3 h-3" />
                      ) : (
                        <ChevronDown className="w-3 h-3" />
                      )}
                    </>
                  )}
                </button>
              </div>

              {/* Expanded: this-key stats + shared pool + devices */}
              {expandedKey === key.id && (
                <div className="border-t border-border bg-accent/30">
                  <div className="p-4 space-y-3 border-b border-border/60">
                    <div>
                      <p className="text-xs font-medium text-foreground mb-1">{t("This key today")}</p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground font-mono">
                        <span>{key.requestsToday.toLocaleString()} prompts</span>
                        {typeof key.apiCallsToday === "number" && (
                          <span>{key.apiCallsToday.toLocaleString()} API</span>
                        )}
                        {typeof key.inputToday === "number" && (
                          <span>In {formatNumber(key.inputToday)}</span>
                        )}
                        {typeof key.outputToday === "number" && (
                          <span>Out {formatNumber(key.outputToday)}</span>
                        )}
                        {typeof key.tokensToday === "number" && (
                          <span>Total {formatNumber(key.tokensToday)}</span>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        {t("Contribution only — limits stay on the shared account pool.")}
                      </p>
                    </div>

                    {user?.limits && (user.keyCount || 0) > 1 && (
                      <div>
                        <p className="text-xs font-medium text-foreground mb-1">{t("Account shared today")}</p>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground font-mono">
                          <span>{(user.usageToday?.promptCount || 0).toLocaleString()} prompts</span>
                          <span>{(user.usageToday?.apiCallCount || 0).toLocaleString()} API</span>
                          <span>In {formatNumber(user.usageToday?.promptTokens || 0)}</span>
                          <span>Out {formatNumber(user.usageToday?.completionTokens || 0)}</span>
                          {user.limits.promptLimit > 0 && (
                            <span>
                              pool {Math.max(0, user.limits.promptLimit - (user.usageToday?.promptCount || 0))}
                              /{user.limits.promptLimit} prompts left
                            </span>
                          )}
                          {(user.limits.rateLimit || 0) > 0 && (
                            <span>
                              {Math.max(0, (user.limits.rateLimit || 0) - (user.usageToday?.apiCallCount || 0))}
                              /{user.limits.rateLimit} API left
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {loadingDevices[key.id] ? (
                    <div className="p-4 text-sm text-muted-foreground">Loading {t("Devices").toLowerCase()}...</div>
                  ) : deviceError[key.id] ? (
                    <div className="p-4 text-sm text-red-400">{deviceError[key.id]}</div>
                  ) : !devices[key.id]?.length ? (
                    <div className="p-4 text-sm text-muted-foreground">
                      {t("No devices recorded. Device slots are shared across all keys on your account.")}
                    </div>
                  ) : (
                    <div className="divide-y divide-border">
                      {devices[key.id].map((device) => (
                        <div key={device.fingerprint} className="p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-3 flex-1 min-w-0">
                              <div className="mt-0.5 text-muted-foreground">{getDeviceIcon(device.osDetected)}</div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-foreground flex flex-wrap items-center gap-2">
                                  <span>
                                    {device.ideDetected || "Unknown IDE"}
                                    {device.osDetected && (
                                      <span className="text-muted-foreground ml-1">— {device.osDetected}</span>
                                    )}
                                  </span>
                                  {device.isProvisional && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600">
                                      {lang === "id" ? "Pending" : "Pending"}
                                    </span>
                                  )}
                                  {device.isBlocked && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-500">
                                      Blacklisted
                                    </span>
                                  )}
                                </p>
                                <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5 text-xs text-muted-foreground">
                                  {device.ipAddress && (
                                    <span>IP: {device.ipAddress}</span>
                                  )}
                                  {device.fingerprintShort && (
                                    <span>FP: {device.fingerprintShort}</span>
                                  )}
                                  <span>
                                    Last seen {formatRelativeTime(device.lastSeen)}
                                  </span>
                                  {device.firstSeen && (
                                    <span>First seen {formatRelativeTime(device.firstSeen)}</span>
                                  )}
                                  <span>{device.requestCount.toLocaleString()} reqs</span>
                                  {device.isCurrentKey === false && (
                                    <span>via {device.ownerKeyName || `key #${device.ownerKeyId}`}</span>
                                  )}
                                </div>
                                {device.userAgentRaw && (
                                  <p className="text-xs text-muted-foreground/60 mt-0.5 truncate max-w-xs" title={device.userAgentRaw}>
                                    {device.userAgentRaw}
                                  </p>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              {device.isBlocked && (
                                <button
                                  type="button"
                                  disabled={unblocking === device.fingerprint}
                                  onClick={() => void doUnblockDevice(key.id, device.fingerprint)}
                                  className="px-2 py-1 text-xs rounded-lg border border-border hover:bg-accent disabled:opacity-50"
                                >
                                  {lang === "id" ? "Unblock" : "Unblock"}
                                </button>
                              )}
                              <button
                                onClick={() => handleDeleteDevice(key.id, device)}
                                className="p-2 text-muted-foreground hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
                                title={t("Revoke")}
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                      {(blacklistRules[key.id] || []).length > 0 && (
                        <div className="p-4 border-t border-border space-y-2 bg-muted/20">
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                            {lang === "id" ? "Blacklist" : "Blacklist"}
                          </p>
                          {(blacklistRules[key.id] || []).map((rule) => (
                            <div
                              key={rule.fingerprint || "rule"}
                              className="flex items-center justify-between gap-2 text-sm"
                            >
                              <span className="font-mono text-xs truncate">
                                {rule.fingerprint?.slice(0, 16)}…
                                {rule.label ? ` · ${rule.label}` : ""}
                              </span>
                              <button
                                type="button"
                                disabled={!rule.fingerprint || unblocking === rule.fingerprint}
                                onClick={() =>
                                  rule.fingerprint && void doUnblockDevice(key.id, rule.fingerprint)
                                }
                                className="px-2 py-1 text-xs rounded-lg border border-border hover:bg-accent disabled:opacity-50"
                              >
                                Unblock
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
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
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4"
          onClick={() => { setShowCreateModal(false); setNewKeyName(""); }}
        >
          <div
            className="bg-card border border-border rounded-xl p-6 w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-foreground">{t("Create Key")}</h2>
              <button onClick={() => { setShowCreateModal(false); setNewKeyName(""); }} className="p-1 hover:bg-accent rounded-lg transition-colors">
                <X className="w-5 h-5 text-muted-foreground" />
              </button>
            </div>
            <form onSubmit={handleCreateKey} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Key Name</label>
                <input
                  type="text"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  placeholder="e.g., VS Code, Production"
                  className="w-full px-3 py-2.5 bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  autoFocus
                  required
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  {t("Extra keys share the same Discord usage limits — they do not add extra quota.")}
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => { setShowCreateModal(false); setNewKeyName(""); }}
                  className="flex-1 py-2.5 border border-border text-foreground font-medium rounded-lg hover:bg-accent transition-colors"
                >
                  {t("Cancel")}
                </button>
                <button
                  type="submit"
                  disabled={creating || !newKeyName.trim()}
                  className="flex-1 py-2.5 bg-primary text-primary-foreground font-medium rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {creating ? "Creating..." : t("Create Key")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirm modal */}
      {confirmModal && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4"
          onClick={() => setConfirmModal(null)}
        >
          <div
            className="bg-card border border-border rounded-xl p-6 w-full max-w-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-4">
              <AlertTriangle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
              <div>
                <h2 className="text-base font-semibold text-foreground mb-1">{confirmModal.title}</h2>
                <p className="text-sm text-muted-foreground">{confirmModal.message}</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmModal(null)}
                className="flex-1 py-2 border border-border text-foreground font-medium rounded-lg hover:bg-accent transition-colors text-sm"
              >
                {t("Cancel")}
              </button>
              <button
                onClick={confirmModal.onConfirm}
                className="flex-1 py-2 bg-red-500 text-white font-medium rounded-lg hover:bg-red-600 transition-colors text-sm"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
