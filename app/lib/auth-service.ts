import { AuthError } from "~/lib/errors";

// --- Types ---

export interface AuthUser {
  id: string;
  displayName: string | null;
}

export interface AuthSession {
  user: AuthUser | null;
}

export interface AuthRegistrationResponse {
  verified: boolean;
  userId: string;
}

export interface AuthSignInResponse {
  verified: boolean;
  user: AuthUser | null;
}

export interface AuthPasskeyRegistrationResponse {
  verified: boolean;
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

async function runAuthOperation<T>(operation: string, task: () => Promise<T>): Promise<T> {
  try {
    return await task();
  } catch (cause) {
    throw new AuthError({ operation, cause });
  }
}

async function readError(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
  return typeof body?.error === "string" ? body.error : fallback;
}

export const authService = {
  register: (_displayName?: string) =>
    runAuthOperation("register", async () => {
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
        throw new Error(await readError(verifyRes, "Registration verification failed"));
      }

      return (await verifyRes.json()) as AuthRegistrationResponse;
    }),

  signIn: () =>
    runAuthOperation("signIn", async () => {
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
        throw new Error(await readError(verifyRes, "Login verification failed"));
      }

      return (await verifyRes.json()) as AuthSignInResponse;
    }),

  generateMagicLink: () =>
    runAuthOperation("generateMagicLink", async () => {
      const res = await fetch("/api/auth/magic-link", { method: "POST" });
      if (!res.ok) {
        throw new Error(await readError(res, "Failed to generate magic link"));
      }
      return (await res.json()) as MagicLinkResponse;
    }),

  logout: () =>
    runAuthOperation("logout", async () => {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      if (!res.ok) {
        throw new Error("Logout failed");
      }
    }),

  getSession: () =>
    runAuthOperation("getSession", async () => {
      const res = await fetch("/api/auth/session");
      if (!res.ok) {
        return { user: null } as AuthSession;
      }
      return (await res.json()) as AuthSession;
    }),

  listPasskeys: () =>
    runAuthOperation("listPasskeys", async () => {
      const res = await fetch("/api/auth/passkeys");
      if (!res.ok) {
        throw new Error(await readError(res, "Failed to list passkeys"));
      }
      const body = (await res.json()) as { passkeys: AuthPasskey[] };
      return body.passkeys;
    }),

  addPasskey: () =>
    runAuthOperation("addPasskey", async () => {
      const { startRegistration } = await import("@simplewebauthn/browser");
      const optionsRes = await fetch("/api/auth/passkeys/register-options", { method: "POST" });
      if (!optionsRes.ok) {
        throw new Error(await readError(optionsRes, "Failed to get registration options"));
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
        throw new Error(await readError(verifyRes, "Registration verification failed"));
      }
      return (await verifyRes.json()) as AuthPasskeyRegistrationResponse;
    }),

  renamePasskey: (id: string, name: string | null) =>
    runAuthOperation("renamePasskey", async () => {
      const res = await fetch(`/api/auth/passkeys/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        throw new Error(await readError(res, "Failed to rename passkey"));
      }
    }),

  removePasskey: (id: string) =>
    runAuthOperation("removePasskey", async () => {
      const res = await fetch(`/api/auth/passkeys/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        throw new Error(await readError(res, "Failed to remove passkey"));
      }
    }),
};
