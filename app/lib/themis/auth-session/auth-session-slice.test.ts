import { describe, expect, it } from "vitest";

import {
  authSessionCleared,
  authSessionFailed,
  authSessionReducer,
  authSessionResolved,
} from "~/lib/themis/auth-session/auth-session-slice";

const user = { id: "user-1", displayName: "Reader" };

describe("authSessionReducer", () => {
  it("resolves the initial session", () => {
    const state = authSessionReducer(undefined, authSessionResolved(user));

    expect(state).toEqual({ user, loading: false, error: null });
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it("clears the session after failure or logout", () => {
    const authenticated = authSessionReducer(undefined, authSessionResolved(user));
    const error = { _tag: "AuthError", message: "AuthError", operation: "getSession" };

    expect(authSessionReducer(authenticated, authSessionFailed(error))).toEqual({
      user: null,
      loading: false,
      error,
    });
    expect(authSessionReducer(authenticated, authSessionCleared())).toEqual({
      user: null,
      loading: false,
      error: null,
    });
  });

  it("preserves identity for no-op and unknown actions", () => {
    const error = { _tag: "AuthError", message: "AuthError", operation: "getSession" };
    const state = authSessionReducer(undefined, authSessionFailed(error));

    expect(authSessionReducer(state, authSessionFailed(error))).toBe(state);
    expect(authSessionReducer(state, { type: "unknown" })).toBe(state);
  });
});
