import { ActiveSessionsPanel } from "@/components/ActiveSessionsPanel";
import { AdminLoginActivityPanel } from "@/components/AdminLoginActivityPanel";
import { AdminAuditLogPanel } from "@/components/AdminAuditLogPanel";

export default function AdminLogPage() {
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Admin Log</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Active sessions, login attempts, and append-only admin audit trail. Sessions expire after 3
          days; password change revokes all admin sessions.
        </p>
      </div>

      <ActiveSessionsPanel
        kind="admin"
        title="Active admin sessions"
        description="Browser sessions for this dashboard — IP, country, device, UA. Revoke to force sign-in again."
      />
      <ActiveSessionsPanel
        kind="portal"
        title="Portal sessions"
        description="Active client-portal logins (who, device, IP). Revoke to force a user to sign in again."
      />
      <AdminLoginActivityPanel />
      <AdminAuditLogPanel />
    </div>
  );
}
