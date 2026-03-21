import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { authClient, setAuthToken } from "../lib/auth-client";

export function AuthCallbackPage() {
  const navigate = useNavigate();

  useEffect(() => {
    authClient.getSession().then(({ data }) => {
      if (data?.session?.token) {
        setAuthToken(data.session.token);
        navigate("/", { replace: true });
      } else {
        navigate("/auth", { replace: true });
      }
    });
  }, [navigate]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-surface-primary">
      <p className="text-sm text-content-secondary">Signing in...</p>
    </div>
  );
}
