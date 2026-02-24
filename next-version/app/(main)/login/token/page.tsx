"use client";

import { useEffect, useState } from "react";

type AuthState =
  | { loading: true }
  | { loading: false; authenticated: true; data: any }
  | { loading: false; authenticated: false; error: string };

export default function TokenCheckPage() {
  const [state, setState] = useState<AuthState>({ loading: true });

  useEffect(() => {
    async function checkToken() {
      try {
        const res = await fetch("/api/token", {
          method: "GET",
          credentials: "include", // ensures HttpOnly cookie is sent
        });

        if (!res.ok) {
          const err = await res.json();
          setState({
            loading: false,
            authenticated: false,
            error: err.error || "Unauthorized",
          });
          return;
        }

        const data = await res.json();

        setState({
          loading: false,
          authenticated: true,
          data,
        });
      } catch (err) {
        setState({
          loading: false,
          authenticated: false,
          error: "Failed to reach server",
        });
      }
    }

    checkToken();
  }, []);

  if (state.loading) {
    return <div>Checking authentication...</div>;
  }

  if (!state.authenticated) {
    return (
      <div>
        <h1>Unauthorized</h1>
        <p>{state.error}</p>
      </div>
    );
  }

  return (
    <div>
      <h1>Authenticated</h1>
      <pre>{JSON.stringify(state.data, null, 2)}</pre>
    </div>
  );
}
