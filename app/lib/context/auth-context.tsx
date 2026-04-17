import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Effect } from "effect";
import { AuthService, type AuthUser } from "~/lib/auth-service";
import { AppRuntime } from "~/lib/effect-runtime";

interface AuthState {
  isAuthenticated: boolean;
  user: AuthUser | null;
  isLoading: boolean;
}

interface AuthContextValue extends AuthState {
  refreshAuth: () => void;
  logout: () => Promise<void>;
}

const defaultValue: AuthContextValue = {
  isAuthenticated: false,
  user: null,
  isLoading: false,
  refreshAuth: () => {},
  logout: () => Promise.resolve(),
};

const AuthContext = createContext<AuthContextValue>(defaultValue);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    isAuthenticated: false,
    user: null,
    isLoading: true,
  });

  const checkSession = useCallback(() => {
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

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  const logout = useCallback(async () => {
    await AppRuntime.runPromise(AuthService.pipe(Effect.andThen((s) => s.logout())));
    setState({ isAuthenticated: false, user: null, isLoading: false });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      refreshAuth: checkSession,
      logout,
    }),
    [state, checkSession, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
