import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { useState, useEffect, useCallback } from "react";
import { LayoutDashboard, Key, Activity, Settings, LogOut, Menu, X, Zap, Boxes } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { badgeClass, badgeLabel, resolveDisplayBadges } from "@/lib/account-badge";
import NotificationBell from "./NotificationBell";
import RecapGate from "./RecapGate";

export default function Layout() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [user, setUser] = useState<any>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const refreshUser = useCallback(() => {
    api.me().then((data: any) => setUser(data)).catch(() => navigate("/login"));
  }, [navigate]);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth >= 1024) setMobileMenuOpen(false);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const handleLogout = async () => {
    setLoggingOut(true);
    try { await api.auth.logout(); } catch { /* ignore */ }
    navigate("/login");
  };

  const navItems = [
    { to: "/", icon: LayoutDashboard, label: t("Overview"), end: true },
    { to: "/models", icon: Boxes, label: t("Models") },
    { to: "/keys", icon: Key, label: t("Keys") },
    { to: "/activity", icon: Activity, label: t("Activity") },
    { to: "/settings", icon: Settings, label: t("Settings") },
  ];

  const hasAddon = (user?.activeAddons || []).length > 0;
  const notifCount = Array.isArray(user?.pendingNotifications)
    ? user.pendingNotifications.length
    : 0;

  const AccountBadge = () => {
    const badges = resolveDisplayBadges(user?.accountType, user?.accountBadges, { hasAddon });
    if (!badges.length) return null;
    return (
      <span className="inline-flex flex-wrap gap-1">
        {badges.map((b) => (
          <span
            key={b}
            className={`px-1.5 py-0.5 text-[10px] font-medium rounded-full ${badgeClass(b)}`}
          >
            {t(badgeLabel(b))}
          </span>
        ))}
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <aside className="hidden lg:flex flex-col w-64 fixed inset-y-0 left-0 z-30 bg-card border-r border-border">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border shrink-0">
          <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
            <Zap className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h1 className="font-semibold text-foreground leading-tight">Tokito</h1>
            <p className="text-xs text-muted-foreground">Your Dashboard</p>
          </div>
        </div>

        <div className="px-4 py-3 border-b border-border shrink-0 space-y-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-semibold text-primary">
                {user?.discordUsername?.charAt(0).toUpperCase() || "U"}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-sm text-foreground truncate">
                  {user?.discordUsername || "..."}
                </span>
                <AccountBadge />
              </div>
            </div>
          </div>
          <button
            onClick={handleLogout}
            disabled={loggingOut}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-muted-foreground hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors border border-border/60"
          >
            <LogOut className="w-4 h-4" />
            {t("Logout")}
          </button>
        </div>

        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
          {navItems.map(({ to, icon: Icon, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-150",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                )
              }
            >
              <Icon className="w-4 h-4" />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="lg:ml-64 min-h-screen flex flex-col pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-0">
        <header className="hidden lg:flex sticky top-0 z-[45] items-center justify-end px-6 py-3 border-b border-border/60 bg-background/90 backdrop-blur-sm">
          <NotificationBell initialCount={notifCount} onChanged={refreshUser} />
        </header>

        <header className="lg:hidden sticky top-0 z-[45] flex items-center justify-between p-4 border-b border-border bg-card">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-primary/20 flex items-center justify-center">
              <Zap className="w-3.5 h-3.5 text-primary" />
            </div>
            <span className="font-semibold text-foreground">Tokito</span>
          </div>
          <div className="flex items-center gap-1.5">
            <NotificationBell initialCount={notifCount} onChanged={refreshUser} />
            <AccountBadge />
            <span className="text-xs text-muted-foreground truncate max-w-[80px]">
              {user?.discordUsername}
            </span>
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="touch-target p-2 text-muted-foreground hover:text-foreground transition-colors"
              aria-expanded={mobileMenuOpen}
              aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </header>

        {mobileMenuOpen && (
          <div className="lg:hidden fixed inset-0 z-[60]">
            <div
              className="absolute inset-0 bg-black/50"
              onClick={() => setMobileMenuOpen(false)}
            />
            <div className="absolute top-0 left-0 right-0 bg-card border-b border-border shadow-lg p-4 space-y-2 animate-slide-up">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm text-foreground truncate">{user?.discordUsername || "..."}</span>
                  <AccountBadge />
                </div>
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  className="p-2 text-muted-foreground hover:text-foreground"
                  aria-label="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <button
                onClick={handleLogout}
                disabled={loggingOut}
                className="touch-target w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium text-red-400 hover:bg-red-400/10 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                {t("Logout")}
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 page-content">
          <Outlet />
        </div>
      </main>

      <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-card border-t border-border z-40 pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-center justify-around">
          {navItems.map(({ to, icon: Icon, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  "touch-target flex flex-col items-center justify-center gap-1 py-2 px-2 flex-1 transition-colors",
                  isActive ? "text-primary" : "text-muted-foreground"
                )
              }
            >
              <Icon className="w-5 h-5" />
              <span className="text-[10px] font-medium">{label}</span>
            </NavLink>
          ))}
        </div>
      </nav>

      <RecapGate />
    </div>
  );
}
