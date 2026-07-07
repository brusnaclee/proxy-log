import { useState, useEffect } from "react";
import { Key, Lock, Trash2, Eye, EyeOff, AlertCircle, CheckCircle2, User } from "lucide-react";
import { api } from "@/lib/api";

type PasswordState = "none" | "set" | "changing";

export default function SettingsPage() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");
  const [passwordState, setPasswordState] = useState<PasswordState>("none");

  useEffect(() => {
    api.me()
      .then((data) => {
        setUser(data);
        // User likely has password if they needed verification to login
        setPasswordState("set");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load settings"))
      .finally(() => setLoading(false));
  }, []);

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setSaving(true);
    try {
      await api.settings.setPassword(newPassword, passwordState === "changing" ? currentPassword : undefined);
      setSuccess(passwordState === "changing" ? "Password updated successfully" : "Password set successfully");
      setNewPassword("");
      setConfirmPassword("");
      setCurrentPassword("");
      setPasswordState("set");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set password");
    } finally {
      setSaving(false);
    }
  };

  const handleRemovePassword = async () => {
    if (!confirm("Are you sure you want to remove your password? You will only be able to login with your API key.")) {
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      await api.settings.removePassword();
      setSuccess("Password removed successfully");
      setPasswordState("none");
      setNewPassword("");
      setConfirmPassword("");
      setCurrentPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove password");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Settings</h1>
          <p className="text-sm text-muted-foreground">Manage your account</p>
        </div>
        <div className="space-y-4">
          {[1, 2].map((i) => (
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
        <h1 className="text-xl font-semibold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage your account</p>
      </div>

      {/* Success message */}
      {success && (
        <div className="flex items-center gap-2 p-3 bg-green-400/10 border border-green-400/20 rounded-lg text-green-400 text-sm">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          {success}
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-400/10 border border-red-400/20 rounded-lg text-red-400 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Account Info */}
      <div className="bg-card border border-border rounded-xl p-6">
        <h2 className="text-sm font-medium text-foreground mb-4">Account</h2>
        <div className="space-y-4">
          <div className="flex items-center justify-between py-2 border-b border-border/40">
            <div className="flex items-center gap-3">
              <User className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Discord Username</span>
            </div>
            <span className="text-sm text-foreground font-medium">
              {user?.discordUsername || "—"}
            </span>
          </div>
          <div className="flex items-center justify-between py-2">
            <div className="flex items-center gap-3">
              <Key className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">API Keys</span>
            </div>
            <span className="text-sm text-foreground font-medium">
              {user?.keyCount || 0}
            </span>
          </div>
        </div>
      </div>

      {/* Password Management */}
      <div className="bg-card border border-border rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-medium text-foreground">Portal Password</h2>
          {passwordState === "set" && (
            <button
              onClick={handleRemovePassword}
              disabled={saving}
              className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1"
            >
              <Trash2 className="w-3 h-3" />
              Remove password
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
              <label className="block text-sm font-medium text-foreground mb-2">
                Current Password
              </label>
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
                <button
                  type="button"
                  onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
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
              <button
                type="button"
                onClick={() => setShowNewPassword(!showNewPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Confirm Password
            </label>
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
              {saving ? "Saving..." : passwordState === "changing" ? "Update Password" : "Set Password"}
            </button>
            {passwordState === "set" && (
              <button
                type="button"
                onClick={() => {
                  setPasswordState("changing");
                  setNewPassword("");
                  setConfirmPassword("");
                  setCurrentPassword("");
                }}
                className="px-4 py-2 border border-border text-foreground font-medium rounded-lg hover:bg-accent transition-colors"
              >
                Cancel
              </button>
            )}
          </div>
        </form>

        {passwordState === "set" && (
          <button
            onClick={() => setPasswordState("changing")}
            className="mt-4 text-sm text-muted-foreground hover:text-foreground"
          >
            Change password
          </button>
        )}
      </div>
    </div>
  );
}
