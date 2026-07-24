import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { LayoutDashboard, Key, Activity, Settings, LogOut, Menu, X, Zap, Boxes } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import RecapGate from "./RecapGate";

export default function Layout() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [user, setUser] = useState<any>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    api.me().then((data: any) => setUser(data)).catch(() => navigate("/login"));
  }, [navigate]);

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

  const accountType = user?.accountType;
  const AccountBadge = () => {
    if (!accountType) return null;
    return (
      <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded-full ${
        accountType === "phantom"
          ? "bg-primary/15 text-primary"
          : "bg-yellow-400/15 text-yellow-400"
      }`}>
        {accountType === "phantom" ? t("Phantom") : t("Trial")}
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-background flex flex-col lg:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex flex-col w-64 bg-card border-r border-border min-h-screen">
        {/* Brand */}
        <div className="flex items-center gap-3 p-6 border-b border-border">
          <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
            <Zap className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h1 className="font-semibold text-foreground">Tokito</h1>
            <p className="text-xs text-muted-foreground">Your Dashboard</p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-1">
          {navItems.map(({ to, icon: Icon, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150",
                  isActive
                    ? "bg-primary/10 text-primary shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                )
              }
            >
              <Icon className="w-4 h-4" />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* User section */}
        <div className="p-4 border-t border-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                <span className="text-xs font-semibold text-primary">
                  {user?.discordUsername?.charAt(0).toUpperCase() || "U"}
                </span>
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm text-foreground truncate max-w-[90px]">
                    {user?.discordUsername || "..."}
                  </span>
                  <AccountBadge />
                </div>
              </div>
            </div>
            <button
              onClick={handleLogout}
              disabled={loggingOut}
              className="p-2 text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors"
              title={t("Logout")}
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content area */}
      <main className="flex-1 flex flex-col min-h-screen pb-20 lg:pb-0">
        {/* Mobile header */}
        <header className="lg:hidden flex items-center justify-between p-4 border-b border-border bg-card">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-primary/20 flex items-center justify-center">
              <Zap className="w-3.5 h-3.5 text-primary" />
            </div>
            <span className="font-semibold text-foreground">Tokito</span>
          </div>
          <div className="flex items-center gap-2">
            <AccountBadge />
            <span className="text-xs text-muted-foreground truncate max-w-[80px]">
              {user?.discordUsername}
            </span>
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 text-muted-foreground hover:text-foreground transition-colors"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </header>

        {/* Mobile dropdown menu */}
        {mobileMenuOpen && (
          <div className="lg:hidden absolute top-[57px] left-0 right-0 bg-card border-b border-border z-50 animate-slide-up">
            <nav className="p-4 space-y-1">
              {navItems.map(({ to, icon: Icon, label, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  onClick={() => setMobileMenuOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium transition-colors",
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
              <button
                onClick={handleLogout}
                disabled={loggingOut}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium text-red-400 hover:bg-red-400/10 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                {t("Logout")}
              </button>
            </nav>
          </div>
        )}

        {/* Page content */}
        <div className="flex-1 page-content animate-fade-in">
          <Outlet />
        </div>
      </main>

      {/* Mobile bottom tab bar */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-card border-t border-border z-40">
        <div className="flex items-center justify-around">
          {navItems.map(({ to, icon: Icon, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  "flex flex-col items-center gap-1 py-3 px-4 flex-1 transition-colors",
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
