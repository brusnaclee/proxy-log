import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { auth } from "@/lib/api";
import Layout from "@/components/Layout";
import LoginPage from "@/pages/LoginPage";
import OverviewPage from "@/pages/OverviewPage";
import KeysPage from "@/pages/KeysPage";
import KeyDetailPage from "@/pages/KeyDetailPage";
import LogsPage from "@/pages/LogsPage";
import AnalyticsPage from "@/pages/AnalyticsPage";
import SettingsPage from "@/pages/SettingsPage";
import SessionDetailPage from "@/pages/SessionDetailPage";
import ModelMonitorPage from "@/pages/ModelMonitorPage";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const [checking, setChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    auth.me()
      .then((res) => {
        setAuthenticated(res.authenticated);
        if (!res.authenticated) navigate("/login");
      })
      .catch(() => navigate("/login"))
      .finally(() => setChecking(false));
  }, [navigate]);

  if (checking) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return authenticated ? <>{children}</> : null;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<OverviewPage />} />
        <Route path="keys" element={<KeysPage />} />
        <Route path="keys/:id" element={<KeyDetailPage />} />
        <Route path="sessions/:sessionId" element={<SessionDetailPage />} />
        <Route path="logs" element={<LogsPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="monitor" element={<ModelMonitorPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
