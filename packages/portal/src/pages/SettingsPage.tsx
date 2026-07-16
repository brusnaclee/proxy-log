import { useState, useEffect, useRef } from "react";
import {
  Key, Lock, Trash2, Eye, EyeOff, AlertCircle, CheckCircle2, User,
  Webhook, Globe, Radio, Clock,
} from "lucide-react";
import { api } from "@/lib/api";
import { useI18n, type Lang } from "@/lib/i18n";
import { formatRelativeTime } from "@/lib/utils";

const REALTIME_KEY = "portal_realtime_enabled";

export default function SettingsPage() {
  const { t, lang, setLang } = useI18n();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Password
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");
  const [passwordState, setPasswordState] = useState<"none" | "set" | "changing">("none");

  // Webhook
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookSaving, setWebhookSaving] = useState(false);
  const [webhookSuccess, setWebhookSuccess] = useState("");
  const [webhookError, setWebhookError] = useState("");

  // SSE live updates
  const [realtimeEnabled, setRealtimeEnabled] = useState(() => {
    try { return localStorage.getItem(REALTIME_KEY) === "true"; } catch { return false; }
  });
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    api.me()
      .then((data) => {
        setUser(data);
        setPasswordState(data.hasPassword ? "set" : "none");
        if (data.webhookUrl) setWebhookUrl(data.webhookUrl);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load settings"))
      .finally(() => setLoading(false));
  }, []);

  // SSE setup
  useEffect(() => {
    if (realtimeEnabled) {
      const es = new EventSource("/portal/api/logs/stream", { withCredentials: true });
      es.onerror = () => {
        // 404 or unsupported — silently ignore
        es.close();
      };
      eventSourceRef.current = es;
    } else {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    }
    return () => {
      eventSourceRef.current?.close();
    };
  }, [realtimeEnabled]);

  const toggleRealtime = (val: boolean) => {
    setRealtimeEnabled(val);
    try { localStorage.setItem(REALTIME_KEY, String(val)); } catch { /* ignore */ }
  };

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    if (newPassword.length < 8) { setError("Password must be at least 8 characters"); return; }
    if (newPassword !== confirmPassword) { setError("Passwords do not match"); return; }
    setSaving(true);
    try {
      await api.settings.setPassword(newPassword, passwordState === "changing" ? currentPassword : undefined);
      setSuccess(passwordState === "changing" ? t("Update Password") + " successful" : t("Set Password") + " successful");
      setNewPassword(""); setConfirmPassword(""); setCurrentPassword("");
      setPasswordState("set");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set password");
    } finally {
      setSaving(false);
    }
  };

  const handleRemovePassword = async () => {
    if (!window.confirm("Are you sure you want to remove your password?")) return;
    setSaving(true); setError(""); setSuccess("");
    try {
      await api.settings.removePassword();
      setSuccess("Password removed successfully");
      setPasswordState("none");
      setNewPassword(""); setConfirmPassword(""); setCurrentPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove password");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    setWebhookError(""); setWebhookSuccess("");
    setWebhookSaving(true);
    try {
      const result = await api.settings.setWebhook(webhookUrl.trim());
      setWebhookSuccess(result.removed ? "Webhook removed" : "Webhook saved");
      if (result.webhookUrl) setWebhookUrl(result.webhookUrl);
    } catch (err) {
      setWebhookError(err instanceof Error ? err.message : "Failed to save webhook");
    } finally {
      setWebhookSaving(false);
    }
  };

  const handleRemoveWebhook = async () => {
    setWebhookError(""); setWebhookSuccess("");
    setWebhookSaving(true);
    try {
      await api.settings.removeWebhook();
      setWebhookUrl("");
      setWebhookSuccess("Webhook removed");
    } catch (err) {
      setWebhookError(err instanceof Error ? err.message : "Failed to remove webhook");
    } finally {
      setWebhookSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{t("Settings")}</h1>
          <p className="text-sm text-muted-foreground">{t("Manage your account")}</p>
        </div>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-card border border-border rounded-xl p-6 animate-pulse">
              <div className="h-5 w-32 bg-muted rounded mb-4" />
              <div className="h-4 w-48 bg-muted rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-foreground">{t("Settings")}</h1>
        <p className="text-sm text-muted-foreground">{t("Manage your account")}</p>
      </div>

      {/* Global messages */}
      {success && (
        <div className="flex items-center gap-2 p-3 bg-green-400/10 border border-green-400/20 rounded-lg text-green-400 text-sm animate-fade-in">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          {success}
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-400/10 border border-red-400/20 rounded-lg text-red-400 text-sm animate-fade-in">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Account Info */}
      <div className="bg-card border border-border rounded-xl p-6 animate-fade-in">
        <h2 className="text-sm font-medium text-foreground mb-4">{t("Account")}</h2>
        <div className="space-y-3">
          <div className="flex items-center justify-between py-2 border-b border-border/40">
            <div className="flex items-center gap-3">
              <User className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">{t("Discord Username")}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-foreground font-medium">{user?.discordUsername || "—"}</span>
              {user?.accountType && (
                <span className={`px-2 py-0.5 text-xs rounded-full ${
                  user.accountType === "phantom"
                    ? "bg-primary/10 text-primary"
                    : "bg-yellow-400/10 text-yellow-400"
                }`}>
                  {user.accountType === "phantom" ? t("Phantom") : t("Trial")}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between py-2 border-b border-border/40">
            <div className="flex items-center gap-3">
              <Key className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">API Keys</span>
            </div>
            <span className="text-sm text-foreground font-medium">{user?.keyCount || 0}</span>
          </div>
          {user?.lastLoginAt && (
            <div className="flex items-center justify-between py-2">
              <div className="flex items-center gap-3">
                <Clock className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">{t("Last Login")}</span>
              </div>
              <span className="text-sm text-foreground">{formatRelativeTime(user.lastLoginAt)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Language toggle */}
      <div className="bg-card border border-border rounded-xl p-6 animate-fade-in">
        <h2 className="text-sm font-medium text-foreground mb-4">{t("Language")}</h2>
        <div className="flex items-center gap-2">
          {(["id", "en"] as Lang[]).map((l) => (
            <button
              key={l}
              onClick={() => setLang(l)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                lang === l
                  ? "bg-primary/10 border-primary/30 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground hover:bg-accent"
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              {l === "id" ? "Bahasa Indonesia" : "English"}
            </button>
          ))}
        </div>
      </div>

      {/* Webhook URL */}
      <div className="bg-card border border-border rounded-xl p-6 animate-fade-in">
        <div className="flex items-center gap-2 mb-2">
          <Webhook className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-sm font-medium text-foreground">{t("Webhook URL")}</h2>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Receive a webhook notification when your key is rotated or other account events occur.
        </p>

        {webhookSuccess && (
          <div className="flex items-center gap-2 p-3 bg-green-400/10 border border-green-400/20 rounded-lg text-green-400 text-sm mb-3 animate-fade-in">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            {webhookSuccess}
          </div>
        )}
        {webhookError && (
          <div className="flex items-center gap-2 p-3 bg-red-400/10 border border-red-400/20 rounded-lg text-red-400 text-sm mb-3 animate-fade-in">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {webhookError}
          </div>
        )}

        <form onSubmit={handleSaveWebhook} className="space-y-3">
          <input
            type="url"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="https://your-server.com/webhook"
            className="w-full px-3 py-2.5 bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 text-sm"
          />
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={webhookSaving}
              className="px-4 py-2 bg-primary text-primary-foreground font-medium rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 text-sm"
            >
              {webhookSaving ? "Saving..." : t("Save")}
            </button>
            {user?.hasWebhook && (
              <button
                type="button"
                onClick={handleRemoveWebhook}
                disabled={webhookSaving}
                className="px-4 py-2 border border-border text-muted-foreground hover:text-red-400 hover:border-red-400/40 font-medium rounded-lg transition-colors disabled:opacity-50 text-sm flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Remove
              </button>
            )}
          </div>
        </form>
      </div>

      {/* Live SSE toggle */}
      <div className="bg-card border border-border rounded-xl p-6 animate-fade-in">
        <div className="flex items-center justify-between">
          <div className="flex items-start gap-3">
            <Radio className="w-4 h-4 text-muted-foreground mt-0.5" />
            <div>
              <h2 className="text-sm font-medium text-foreground">{t("Live Updates")}</h2>
              <p className="text-xs text-muted-foreground mt-1">
                Enable server-sent events to receive real-time log updates on the Activity page.
                Streams from <code className="font-mono text-xs">/portal/api/logs/stream</code>.
                If the endpoint is unavailable it will silently deactivate.
              </p>
            </div>
          </div>
          <button
            onClick={() => toggleRealtime(!realtimeEnabled)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              realtimeEnabled ? "bg-primary" : "bg-muted"
            }`}
            aria-checked={realtimeEnabled}
            role="switch"
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              realtimeEnabled ? "translate-x-6" : "translate-x-1"
            }`} />
          </button>
        </div>
        {realtimeEnabled && (
          <div className="mt-3 flex items-center gap-1.5 text-xs text-primary animate-fade-in">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            Live updates active
          </div>
        )}
      </div>

      {/* Password Management */}
      <div className="bg-card border border-border rounded-xl p-6 animate-fade-in">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-medium text-foreground">{t("Portal Password")}</h2>
          {passwordState === "set" && (
            <button
              onClick={handleRemovePassword}
              disabled={saving}
              className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1"
            >
              <Trash2 className="w-3 h-3" />
              {t("Remove password")}
            </button>
          )}
        </div>

        <p className="text-sm text-muted-foreground mb-4">
          {passwordState === "none"
            ? "Set a password to secure your portal session. You can login with either your API key or password."
            : "Update your password for portal login."}
        </p>

        <form onSubmit={handleSetPassword} className="space-y-4">
          {passwordState === "changing" && (
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Current Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type={showCurrentPassword ? "text" : "password"}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Current password"
                  className="w-full pl-10 pr-10 py-2.5 bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  autoFocus
                />
                <button type="button" onClick={() => setShowCurrentPassword(!showCurrentPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              {passwordState === "changing" ? "New Password" : "Password"}
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type={showNewPassword ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Min. 8 characters"
                className="w-full pl-10 pr-10 py-2.5 bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                autoFocus={passwordState !== "changing"}
                required
              />
              <button type="button" onClick={() => setShowNewPassword(!showNewPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">Confirm Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm password"
              className="w-full px-3 py-2.5 bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              required
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving || !newPassword || !confirmPassword}
              className="px-4 py-2 bg-primary text-primary-foreground font-medium rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {saving ? "Saving..." : passwordState === "changing" ? t("Update Password") : t("Set Password")}
            </button>
            {passwordState === "set" && (
              <button
                type="button"
                onClick={() => { setPasswordState("changing"); setNewPassword(""); setConfirmPassword(""); setCurrentPassword(""); }}
                className="px-4 py-2 border border-border text-foreground font-medium rounded-lg hover:bg-accent transition-colors"
              >
                {t("Cancel")}
              </button>
            )}
          </div>
        </form>

        {passwordState === "set" && (
          <button
            onClick={() => setPasswordState("changing")}
            className="mt-4 text-sm text-muted-foreground hover:text-foreground"
          >
            {t("Change password")}
          </button>
        )}
      </div>
    </div>
  );
}
