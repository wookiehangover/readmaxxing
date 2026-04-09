import { Context, Effect, Layer } from "effect";
import type { Session, AuthResult } from "@simplepasskey/browser";
import { AuthError } from "~/lib/errors";

// --- Lazy-initialized SimplePasskey client (SSR safety) ---

let _client: import("@simplepasskey/browser").SimplePasskey | null = null;

async function getClient() {
  if (!_client) {
    const { SimplePasskey } = await import("@simplepasskey/browser");
    _client = new SimplePasskey({ clientId: "01KNSW2SAJ9X563ASQB3R6FGRQ", autoRefresh: false });
  }
  return _client;
}

// --- Effect Service ---

export class AuthService extends Context.Tag("AuthService")<
  AuthService,
  {
    readonly register: (displayName?: string) => Effect.Effect<AuthResult, AuthError>;
    readonly signIn: () => Effect.Effect<AuthResult, AuthError>;
    readonly logout: () => Effect.Effect<void, AuthError>;
    readonly isAuthenticated: () => Effect.Effect<boolean, AuthError>;
    readonly getSession: () => Effect.Effect<Session, AuthError>;
    readonly onAuthChange: (
      callback: (session: Session | null) => void,
    ) => Effect.Effect<() => void, AuthError>;
  }
>() {}

export const AuthServiceLive = Layer.succeed(AuthService, {
  register: (displayName?: string) =>
    Effect.tryPromise({
      try: async () => {
        const client = await getClient();
        return client.register({ displayName: displayName ?? "Reader" });
      },
      catch: (cause) => new AuthError({ operation: "register", cause }),
    }),

  signIn: () =>
    Effect.tryPromise({
      try: async () => {
        const client = await getClient();
        return client.signIn();
      },
      catch: (cause) => new AuthError({ operation: "signIn", cause }),
    }),

  logout: () =>
    Effect.tryPromise({
      try: async () => {
        const client = await getClient();
        await client.logout();
      },
      catch: (cause) => new AuthError({ operation: "logout", cause }),
    }),

  isAuthenticated: () =>
    Effect.tryPromise({
      try: async () => {
        const client = await getClient();
        return client.isAuthenticated();
      },
      catch: (cause) => new AuthError({ operation: "isAuthenticated", cause }),
    }),

  getSession: () =>
    Effect.tryPromise({
      try: async () => {
        const client = await getClient();
        return client.getSession();
      },
      catch: (cause) => new AuthError({ operation: "getSession", cause }),
    }),

  onAuthChange: (callback: (session: Session | null) => void) =>
    Effect.tryPromise({
      try: async () => {
        const client = await getClient();
        return client.onAuthChange(callback);
      },
      catch: (cause) => new AuthError({ operation: "onAuthChange", cause }),
    }),
});
