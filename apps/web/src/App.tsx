import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { BoardPage } from "./routes/BoardPage";
import { SettingsPage } from "./routes/SettingsPage";
import { MachinesPage } from "./routes/MachinesPage";
import { AgentsPage } from "./routes/AgentsPage";
import { AuthPage } from "./routes/AuthPage";
import { AuthCallbackPage } from "./routes/AuthCallbackPage";
import { useSession } from "./lib/auth-client";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { data: session, isPending } = useSession();

  if (isPending) return null;
  if (!session) return <Navigate to="/auth" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/auth" element={<AuthPage />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route path="/" element={<ProtectedRoute><BoardPage /></ProtectedRoute>} />
        <Route path="/machines" element={<ProtectedRoute><MachinesPage /></ProtectedRoute>} />
        <Route path="/agents" element={<ProtectedRoute><AgentsPage /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
      </Routes>
    </BrowserRouter>
  );
}
