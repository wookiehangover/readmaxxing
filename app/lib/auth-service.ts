import { Context, Effect, Layer } from "effect";
import { AuthError } from "~/lib/errors";

// --- Types ---

export interface AuthUser {
  id: string;
  displayName: string | null;
}

export interface AuthSession {
  user: AuthUser | null;
}

// --- Effect Service ---

export class AuthService extends Context.Tag("AuthService")<
  AuthService,
  {
    readonly register: (
      displayName?: string,
    ) => Effect.Effect<{ verified: boolean; userId: string }, AuthError>;
    readonly signIn: () => Effect.Effect<{ verified: boolean; user: AuthUser | null }, AuthError>;
    readonly logout: () => Effect.Effect<void, AuthError>;
    readonly getSession: () => Effect.Effect<AuthSession, AuthError>;
  }
>() {}

export const AuthServiceLive = Layer.succeed(AuthService, {
  register: (_displayName?: string) =>
    Effect.tryPromise({
      try: async () => {
        const { startRegistration } = await import("@simplewebauthn/browser");

        // 1. Get registration options from server
        const optionsRes = await fetch("/api/auth/register-options");
        if (!optionsRes.ok) {
          throw new Error("Failed to get registration options");
        }
        const { options, userId, challengeId } = await optionsRes.json();

        // 2. Start WebAuthn registration ceremony in the browser
        const registration = await startRegistration({ optionsJSON: options });

        // 3. Send registration response to server for verification
        const verifyRes = await fetch("/api/auth/register-verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ challengeId, userId, response: registration }),
        });
        if (!verifyRes.ok) {
          const body = await verifyRes.json().catch(() => ({}));
          throw new Error(body.error ?? "Registration verification failed");
        }

        return (await verifyRes.json()) as { verified: boolean; userId: string };
      },
      catch: (cause) => new AuthError({ operation: "register", cause }),
    }),

  signIn: () =>
    Effect.tryPromise({
      try: async () => {
        const { startAuthentication } = await import("@simplewebauthn/browser");

        // 1. Get authentication options from server
        const optionsRes = await fetch("/api/auth/login-options");
        if (!optionsRes.ok) {
          throw new Error("Failed to get login options");
        }
        const { options, challengeId } = await optionsRes.json();

        // 2. Start WebAuthn authentication ceremony in the browser
        const authentication = await startAuthentication({ optionsJSON: options });

        // 3. Send authentication response to server for verification
        const verifyRes = await fetch("/api/auth/login-verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ challengeId, response: authentication }),
        });
        if (!verifyRes.ok) {
          const body = await verifyRes.json().catch(() => ({}));
          throw new Error(body.error ?? "Login verification failed");
        }

        return (await verifyRes.json()) as { verified: boolean; user: AuthUser | null };
      },
      catch: (cause) => new AuthError({ operation: "signIn", cause }),
    }),

  logout: () =>
    Effect.tryPromise({
      try: async () => {
        const res = await fetch("/api/auth/logout", { method: "POST" });
        if (!res.ok) {
          throw new Error("Logout failed");
        }
      },
      catch: (cause) => new AuthError({ operation: "logout", cause }),
    }),

  getSession: () =>
    Effect.tryPromise({
      try: async () => {
        const res = await fetch("/api/auth/session");
        if (!res.ok) {
          return { user: null } as AuthSession;
        }
        return (await res.json()) as AuthSession;
      },
      catch: (cause) => new AuthError({ operation: "getSession", cause }),
    }),
});
