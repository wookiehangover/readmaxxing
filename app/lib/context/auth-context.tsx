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
}

const defaultValue: AuthContextValue = {
  isAuthenticated: false,
  user: null,
  isLoading: false,
  refreshAuth: () => {},
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

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      refreshAuth: checkSession,
    }),
    [state, checkSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
