import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { useSession } from "./lib/auth-client";
import { AccountSettingsPage } from "./routes/AccountSettingsPage";
import { AgentDetailPage } from "./routes/AgentDetailPage";
import { AgentNewPage } from "./routes/AgentNewPage";
import { AgentsPage } from "./routes/AgentsPage";
import { AuthCallbackPage } from "./routes/AuthCallbackPage";
import { AuthPage } from "./routes/AuthPage";
import { BoardPage } from "./routes/BoardPage";
import { BoardRedirect } from "./routes/BoardRedirect";
import { MachineDetailPage } from "./routes/MachineDetailPage";
import { MachinesPage } from "./routes/MachinesPage";
import { RepositoriesPage } from "./routes/RepositoriesPage";

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
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <BoardRedirect />
            </ProtectedRoute>
          }
        />
        <Route
          path="/boards/:boardId"
          element={
            <ProtectedRoute>
              <BoardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/machines"
          element={
            <ProtectedRoute>
              <MachinesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/machines/:id"
          element={
            <ProtectedRoute>
              <MachineDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/agents"
          element={
            <ProtectedRoute>
              <AgentsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/agents/new"
          element={
            <ProtectedRoute>
              <AgentNewPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/agents/:id"
          element={
            <ProtectedRoute>
              <AgentDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/repositories"
          element={
            <ProtectedRoute>
              <RepositoriesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <ProtectedRoute>
              <AccountSettingsPage />
            </ProtectedRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
