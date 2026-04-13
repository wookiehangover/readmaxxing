import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Effect } from "effect";
import { AuthService, type AuthUser } from "~/lib/auth-service";
import { AppRuntime } from "~/lib/effect-runtime";

interface AuthState {
  isAuthenticated: boolean;
  user: AuthUser | null;
  isLoading: boolean;
}

const defaultState: AuthState = {
  isAuthenticated: false,
  user: null,
  isLoading: false,
};

const AuthContext = createContext<AuthState>(defaultState);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    isAuthenticated: false,
    user: null,
    isLoading: true,
  });

  useEffect(() => {
    // Check session on mount via GET /api/auth/session
    const init = Effect.gen(function* () {
      const auth = yield* AuthService;
      const session = yield* auth.getSession();
      return { user: session.user };
    });

    AppRuntime.runPromise(init)
      .then(({ user }) => {
        setState({
          isAuthenticated: user !== null,
          user,
          isLoading: false,
        });
      })
      .catch(() => {
        setState({ isAuthenticated: false, user: null, isLoading: false });
      });
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
