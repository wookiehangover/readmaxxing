import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";

import type {
  AuthPasskey,
  AuthPasskeyRegistrationResponse,
  AuthRegistrationResponse,
  AuthSignInResponse,
  AuthUser,
  MagicLinkResponse,
} from "~/lib/auth-service";
import {
  addPasskeyRequested,
  generateMagicLinkRequested,
  listPasskeysRequested,
  logoutRequested,
  registerRequested,
  removePasskeyRequested,
  renamePasskeyRequested,
  refreshAuthSessionRequested,
  signInRequested,
} from "~/lib/themis/auth-session/auth-session-slice";
import { useAppStore } from "~/lib/themis/provider";

interface AuthState {
  isAuthenticated: boolean;
  user: AuthUser | null;
  isLoading: boolean;
}

interface AuthContextValue extends AuthState {
  refreshAuth: () => void;
  logout: () => Promise<void>;
  register: (displayName?: string) => Promise<AuthRegistrationResponse>;
  signIn: () => Promise<AuthSignInResponse>;
  generateMagicLink: () => Promise<MagicLinkResponse>;
  listPasskeys: () => Promise<AuthPasskey[]>;
  addPasskey: () => Promise<AuthPasskeyRegistrationResponse>;
  renamePasskey: (id: string, name: string | null) => Promise<void>;
  removePasskey: (id: string) => Promise<void>;
}

const defaultValue: AuthContextValue = {
  isAuthenticated: false,
  user: null,
  isLoading: false,
  refreshAuth: () => {},
  logout: () => Promise.resolve(),
  register: () => Promise.resolve({ verified: false, userId: "" }),
  signIn: () => Promise.resolve({ verified: false, user: null }),
  generateMagicLink: () => Promise.resolve({ url: "", expiresAt: "" }),
  listPasskeys: () => Promise.resolve([]),
  addPasskey: () => Promise.resolve({ verified: false }),
  renamePasskey: () => Promise.resolve(),
  removePasskey: () => Promise.resolve(),
};

const AuthContext = createContext<AuthContextValue>(defaultValue);

export function AuthProvider({ children }: { children: ReactNode }) {
  const store = useAppStore();
  const user = store.authSessionSelectors.selectAuthUser.useValue();
  const isAuthenticated = store.authSessionSelectors.selectIsAuthenticated.useValue();
  const isLoading = store.authSessionSelectors.selectAuthLoading.useValue();

  const refreshAuth = useCallback(() => {
    store.dispatch(refreshAuthSessionRequested());
  }, [store]);

  const logout = useCallback(
    () =>
      new Promise<void>((resolve, reject) => {
        store.dispatch(logoutRequested(resolve, reject));
      }),
    [store],
  );
  const register = useCallback(
    (displayName?: string) =>
      new Promise<AuthRegistrationResponse>((resolve, reject) => {
        store.dispatch(registerRequested(displayName, resolve, reject));
      }),
    [store],
  );
  const signIn = useCallback(
    () =>
      new Promise<AuthSignInResponse>((resolve, reject) => {
        store.dispatch(signInRequested(resolve, reject));
      }),
    [store],
  );
  const generateMagicLink = useCallback(
    () =>
      new Promise<MagicLinkResponse>((resolve, reject) => {
        store.dispatch(generateMagicLinkRequested(resolve, reject));
      }),
    [store],
  );
  const listPasskeys = useCallback(
    () =>
      new Promise<AuthPasskey[]>((resolve, reject) => {
        store.dispatch(listPasskeysRequested(resolve, reject));
      }),
    [store],
  );
  const addPasskey = useCallback(
    () =>
      new Promise<AuthPasskeyRegistrationResponse>((resolve, reject) => {
        store.dispatch(addPasskeyRequested(resolve, reject));
      }),
    [store],
  );
  const renamePasskey = useCallback(
    (id: string, name: string | null) =>
      new Promise<void>((resolve, reject) => {
        store.dispatch(renamePasskeyRequested(id, name, resolve, reject));
      }),
    [store],
  );
  const removePasskey = useCallback(
    (id: string) =>
      new Promise<void>((resolve, reject) => {
        store.dispatch(removePasskeyRequested(id, resolve, reject));
      }),
    [store],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      isAuthenticated,
      user,
      isLoading,
      refreshAuth,
      logout,
      register,
      signIn,
      generateMagicLink,
      listPasskeys,
      addPasskey,
      renamePasskey,
      removePasskey,
    }),
    [
      isAuthenticated,
      user,
      isLoading,
      refreshAuth,
      logout,
      register,
      signIn,
      generateMagicLink,
      listPasskeys,
      addPasskey,
      renamePasskey,
      removePasskey,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
