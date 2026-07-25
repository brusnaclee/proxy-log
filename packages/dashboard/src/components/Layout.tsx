import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { auth } from "@/lib/api";
import { useRealtime } from "@/lib/realtime-context";
import { useState, useEffect } from "react";
import {
  LayoutDashboard,
  Key,
  ScrollText,
  BarChart3,
  Settings,
  LogOut,
  Zap,
  Activity,
  Menu,
  X,
  ChevronLeft,
  Bug,
  Shield,
  Gift,
  Package,
} from "lucide-react";
import { cn } from "@/lib/utils";

const mainNav = [
  { to: "/", icon: LayoutDashboard, label: "Overview" },
  { to: "/keys", icon: Key, label: "API Keys" },
  { to: "/logs", icon: ScrollText, label: "Logs" },
  { to: "/analytics", icon: BarChart3, label: "Analytics" },
  { to: "/monitor", icon: Activity, label: "Model Monitor" },
  { to: "/buglog", icon: Bug, label: "Bug Log" },
];

const sysNav = [
  { to: "/settings", icon: Settings, label: "Settings" },
  { to: "/addons", icon: Package, label: "Add-ons" },
  { to: "/trial", icon: Gift, label: "Trial Mode" },
  { to: "/quota-guard", icon: Shield, label: "Quota Guard" },
];

export default function Layout() {
  const navigate = useNavigate();
  const { realtimeEnabled } = useRealtime();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Close mobile sidebar on route change or resize
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1024) {
        setSidebarOpen(false);
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const handleLogout = async () => {
    try {
      await auth.logout();
    } catch {}
    navigate("/login");
  };

  const sidebarWidth = sidebarCollapsed ? "w-[72px]" : "w-64";

  return (
    <div className="flex h-screen bg-background">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-[45] border-r border-border bg-gradient-to-b from-card to-background flex flex-col transition-[width,transform] duration-300 ease-in-out",
          sidebarWidth,
          // Mobile: slide in/out
          "lg:relative lg:translate-x-0 lg:h-full lg:shrink-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        {/* Logo */}
        <div className={cn(
          "h-16 flex items-center border-b border-border/50 shrink-0",
          sidebarCollapsed ? "justify-center px-2" : "justify-between px-5"
        )}>
          {!sidebarCollapsed && (
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 shadow-lg shadow-indigo-500/20 flex items-center justify-center shrink-0">
                <Zap className="h-4 w-4 text-white" />
              </div>
              <div>
                <h1 className="text-sm font-bold tracking-tight">AI Proxy</h1>
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold">Gateway</p>
              </div>
            </div>
          )}
          {sidebarCollapsed && (
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 shadow-lg shadow-indigo-500/20 flex items-center justify-center">
              <Zap className="h-4 w-4 text-white" />
            </div>
          )}
          {!sidebarCollapsed && realtimeEnabled && (
            <div title="Dashboard realtime feed (bukan status model Online)" className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 live-dot"></span>
              <span className="text-[9px] font-bold text-emerald-500 uppercase tracking-wider">SSE</span>
            </div>
          )}
          {/* Mobile close button */}
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className={cn(
          "flex-1 py-6 overflow-y-auto",
          sidebarCollapsed ? "px-2" : "px-3"
        )}>
          <div className="space-y-8">
            <div>
              {!sidebarCollapsed && (
                <p className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Main</p>
              )}
              <div className={cn("space-y-1", sidebarCollapsed && "flex flex-col items-center")}>
                {mainNav.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === "/"}
                    onClick={() => setSidebarOpen(false)}
                    title={sidebarCollapsed ? item.label : undefined}
                    className={({ isActive }) =>
                      cn(
                        "flex items-center gap-3 rounded-lg text-sm font-medium transition-colors duration-200",
                        sidebarCollapsed ? "p-2.5 justify-center w-11 h-11" : "px-3 py-2.5",
                        isActive
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                      )
                    }
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    {!sidebarCollapsed && item.label}
                  </NavLink>
                ))}
              </div>
            </div>

            <div>
              {!sidebarCollapsed && (
                <p className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">System</p>
              )}
              <div className={cn("space-y-1", sidebarCollapsed && "flex flex-col items-center")}>
                {sysNav.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === "/"}
                    onClick={() => setSidebarOpen(false)}
                    title={sidebarCollapsed ? item.label : undefined}
                    className={({ isActive }) =>
                      cn(
                        "flex items-center gap-3 rounded-lg text-sm font-medium transition-colors duration-200",
                        sidebarCollapsed ? "p-2.5 justify-center w-11 h-11" : "px-3 py-2.5",
                        isActive
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                      )
                    }
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    {!sidebarCollapsed && item.label}
                  </NavLink>
                ))}
              </div>
            </div>
          </div>
        </nav>

        {/* Footer */}
        <div className={cn(
          "border-t border-border/50 bg-card/50 shrink-0",
          sidebarCollapsed ? "p-2" : "p-3"
        )}>
          {/* Collapse toggle - desktop only */}
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="hidden lg:flex items-center justify-center w-full p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors duration-200 mb-2"
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <ChevronLeft className={cn("h-4 w-4 transition-transform duration-300", sidebarCollapsed && "rotate-180")} />
          </button>
          <button
            onClick={handleLogout}
            className={cn(
              "flex items-center gap-3 rounded-lg text-sm font-medium text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors duration-200 w-full",
              sidebarCollapsed ? "p-2.5 justify-center" : "px-3 py-2.5"
            )}
            title="Logout"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            {!sidebarCollapsed && "Logout"}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto bg-background/95 min-w-0">
        {/* Mobile header */}
        <div className="lg:hidden sticky top-0 z-30 flex items-center gap-3 px-4 h-14 border-b border-border/50 bg-card/80 backdrop-blur-md">
          <button
            onClick={() => setSidebarOpen(true)}
            className="touch-target p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-md bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
              <Zap className="h-3 w-3 text-white" />
            </div>
            <span className="text-sm font-bold">AI Proxy</span>
          </div>
          {realtimeEnabled && (
            <div title="Dashboard realtime feed (bukan status model Online)" className="ml-auto flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 live-dot"></span>
              <span className="text-[9px] font-bold text-emerald-500 uppercase tracking-wider">SSE</span>
            </div>
          )}
        </div>

        <div className="p-4 sm:p-6 lg:p-8 max-w-[1600px] mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
