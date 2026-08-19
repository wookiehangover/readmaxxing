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

    expect(state).toEqual({ user, loading: false });
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it("clears the session after failure or logout", () => {
    const authenticated = authSessionReducer(undefined, authSessionResolved(user));

    expect(authSessionReducer(authenticated, authSessionFailed())).toEqual({
      user: null,
      loading: false,
    });
    expect(authSessionReducer(authenticated, authSessionCleared())).toEqual({
      user: null,
      loading: false,
    });
  });

  it("preserves identity for no-op and unknown actions", () => {
    const state = authSessionReducer(undefined, authSessionFailed());

    expect(authSessionReducer(state, authSessionFailed())).toBe(state);
    expect(authSessionReducer(state, { type: "unknown" })).toBe(state);
  });
});
