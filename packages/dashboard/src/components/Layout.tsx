import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { auth } from "@/lib/api";
import { useRealtime } from "@/lib/realtime-context";
import {
  LayoutDashboard,
  Key,
  ScrollText,
  BarChart3,
  Settings,
  LogOut,
  Zap,
  Activity
} from "lucide-react";
import { cn } from "@/lib/utils";

const mainNav = [
  { to: "/", icon: LayoutDashboard, label: "Overview" },
  { to: "/keys", icon: Key, label: "API Keys" },
  { to: "/logs", icon: ScrollText, label: "Logs" },
  { to: "/analytics", icon: BarChart3, label: "Analytics" },
  { to: "/monitor", icon: Activity, label: "Model Monitor" },
];

const sysNav = [
  { to: "/settings", icon: Settings, label: "Settings" },
];

export default function Layout() {
  const navigate = useNavigate();
  const { realtimeEnabled } = useRealtime();

  const handleLogout = async () => {
    try {
      await auth.logout();
    } catch {}
    navigate("/login");
  };

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside className="w-64 border-r border-border bg-gradient-to-b from-card to-background flex flex-col">
        {/* Logo */}
        <div className="h-16 flex items-center justify-between px-5 border-b border-border/50">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 shadow-lg shadow-indigo-500/20 flex items-center justify-center">
              <Zap className="h-4 w-4 text-white" />
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight">AI Proxy</h1>
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold">Gateway</p>
            </div>
          </div>
          {realtimeEnabled && (
            <div title="Realtime updates enabled" className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 live-dot"></span>
              <span className="text-[9px] font-bold text-emerald-500 uppercase tracking-wider">Live</span>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-6 px-3 space-y-8 overflow-y-auto">
          <div>
            <p className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Main</p>
            <div className="space-y-1">
              {mainNav.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/"}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                    )
                  }
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </NavLink>
              ))}
            </div>
          </div>

          <div>
            <p className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">System</p>
            <div className="space-y-1">
              {sysNav.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/"}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                    )
                  }
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </NavLink>
              ))}
            </div>
          </div>
        </nav>

        {/* Footer */}
        <div className="p-3 border-t border-border/50 bg-card/50">
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-all duration-200 w-full"
          >
            <LogOut className="h-4 w-4" />
            Logout
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto bg-background/95">
        <div className="p-8 max-w-[1600px] mx-auto animate-fade-in">
          <Outlet />
        </div>
      </main>
    </div>
  );
}