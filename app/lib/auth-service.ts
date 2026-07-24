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

export interface MagicLinkResponse {
  url: string;
  expiresAt: string;
}

export interface AuthPasskey {
  id: string;
  name: string | null;
  createdAt: string;
  deviceType: string | null;
  backedUp: boolean;
  lastUsedAt: string | null;
}

// --- Effect Service ---

export class AuthService extends Context.Tag("AuthService")<
  AuthService,
  {
    readonly register: (
      displayName?: string,
    ) => Effect.Effect<{ verified: boolean; userId: string }, AuthError>;
    readonly signIn: () => Effect.Effect<{ verified: boolean; user: AuthUser | null }, AuthError>;
    readonly generateMagicLink: () => Effect.Effect<MagicLinkResponse, AuthError>;
    readonly logout: () => Effect.Effect<void, AuthError>;
    readonly getSession: () => Effect.Effect<AuthSession, AuthError>;
    readonly listPasskeys: () => Effect.Effect<AuthPasskey[], AuthError>;
    readonly addPasskey: () => Effect.Effect<{ verified: boolean }, AuthError>;
    readonly renamePasskey: (id: string, name: string | null) => Effect.Effect<void, AuthError>;
    readonly removePasskey: (id: string) => Effect.Effect<void, AuthError>;
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

  generateMagicLink: () =>
    Effect.tryPromise({
      try: async () => {
        const res = await fetch("/api/auth/magic-link", { method: "POST" });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? "Failed to generate magic link");
        }
        return (await res.json()) as MagicLinkResponse;
      },
      catch: (cause) => new AuthError({ operation: "generateMagicLink", cause }),
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

  listPasskeys: () =>
    Effect.tryPromise({
      try: async () => {
        const res = await fetch("/api/auth/passkeys");
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? "Failed to list passkeys");
        }
        const body = (await res.json()) as { passkeys: AuthPasskey[] };
        return body.passkeys;
      },
      catch: (cause) => new AuthError({ operation: "listPasskeys", cause }),
    }),

  addPasskey: () =>
    Effect.tryPromise({
      try: async () => {
        const { startRegistration } = await import("@simplewebauthn/browser");
        const optionsRes = await fetch("/api/auth/passkeys/register-options", { method: "POST" });
        if (!optionsRes.ok) {
          const body = await optionsRes.json().catch(() => ({}));
          throw new Error(body.error ?? "Failed to get registration options");
        }
        const { options, challengeId } = await optionsRes.json();
        if (typeof challengeId !== "string" || !challengeId) {
          throw new Error("Invalid challenge ID from server");
        }
        const registration = await startRegistration({ optionsJSON: options });
        const verifyRes = await fetch("/api/auth/passkeys/register-verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ challengeId, response: registration }),
        });
        if (!verifyRes.ok) {
          const body = await verifyRes.json().catch(() => ({}));
          throw new Error(body.error ?? "Registration verification failed");
        }
        return (await verifyRes.json()) as { verified: boolean };
      },
      catch: (cause) => new AuthError({ operation: "addPasskey", cause }),
    }),

  renamePasskey: (id: string, name: string | null) =>
    Effect.tryPromise({
      try: async () => {
        const res = await fetch(`/api/auth/passkeys/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? "Failed to rename passkey");
        }
      },
      catch: (cause) => new AuthError({ operation: "renamePasskey", cause }),
    }),

  removePasskey: (id: string) =>
    Effect.tryPromise({
      try: async () => {
        const res = await fetch(`/api/auth/passkeys/${encodeURIComponent(id)}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? "Failed to remove passkey");
        }
      },
      catch: (cause) => new AuthError({ operation: "removePasskey", cause }),
    }),
});
