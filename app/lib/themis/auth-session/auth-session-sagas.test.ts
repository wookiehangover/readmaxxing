import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addPasskey: vi.fn(),
  generateMagicLink: vi.fn(),
  getSession: vi.fn(),
  listPasskeys: vi.fn(),
  logout: vi.fn(),
  register: vi.fn(),
  removePasskey: vi.fn(),
  renamePasskey: vi.fn(),
  signIn: vi.fn(),
}));

vi.mock("~/lib/auth-service", () => ({
  authService: mocks,
}));

import { authSessionSaga } from "~/lib/themis/auth-session/auth-session-sagas";
import {
  listPasskeysRequested,
  authSessionResolved,
  logoutRequested,
  registerRequested,
  refreshAuthSessionRequested,
  renamePasskeyRequested,
} from "~/lib/themis/auth-session/auth-session-slice";
import { createAppStore, type AppStore } from "~/lib/themis/store";

const stores: AppStore[] = [];
const user = { id: "user-1", displayName: "Reader" };

function startStore() {
  const store = createAppStore();
  stores.push(store);
  store.init();
  store.runSaga(authSessionSaga);
  return store;
}

afterEach(() => {
  for (const store of stores.splice(0)) store.dispose();
  for (const mock of Object.values(mocks)) mock.mockReset();
});

describe("authSessionSaga", () => {
  it("refreshes the canonical session state", async () => {
    mocks.getSession.mockResolvedValueOnce({ user });
    const store = startStore();

    store.dispatch(refreshAuthSessionRequested());

    await vi.waitFor(() =>
      expect(store.authSessionSelectors.selectAuthUser.select(store.state)).toEqual(user),
    );
    expect(store.authSessionSelectors.selectIsAuthenticated.select(store.state)).toBe(true);
    expect(store.authSessionSelectors.selectAuthLoading.select(store.state)).toBe(false);
  });

  it("resolves a failed refresh as signed out", async () => {
    mocks.getSession.mockRejectedValueOnce(new Error("offline"));
    const store = startStore();

    store.dispatch(refreshAuthSessionRequested());

    await vi.waitFor(() =>
      expect(store.authSessionSelectors.selectAuthLoading.select(store.state)).toBe(false),
    );
    expect(store.authSessionSelectors.selectIsAuthenticated.select(store.state)).toBe(false);
  });

  it("clears the session and completes logout after the request succeeds", async () => {
    mocks.logout.mockResolvedValueOnce(undefined);
    const onCompleted = vi.fn();
    const onFailed = vi.fn();
    const store = startStore();
    store.dispatch(authSessionResolved(user));

    store.dispatch(logoutRequested(onCompleted, onFailed));

    await vi.waitFor(() => expect(onCompleted).toHaveBeenCalledOnce());
    expect(onFailed).not.toHaveBeenCalled();
    expect(store.authSessionSelectors.selectIsAuthenticated.select(store.state)).toBe(false);
  });

  it("keeps the session and reports a failed logout", async () => {
    const error = new Error("offline");
    mocks.logout.mockRejectedValueOnce(error);
    const onCompleted = vi.fn();
    const onFailed = vi.fn();
    const store = startStore();
    store.dispatch(authSessionResolved(user));

    store.dispatch(logoutRequested(onCompleted, onFailed));

    await vi.waitFor(() => expect(onFailed).toHaveBeenCalledWith(error));
    expect(onCompleted).not.toHaveBeenCalled();
    expect(store.authSessionSelectors.selectIsAuthenticated.select(store.state)).toBe(true);
  });

  it("runs registration and passkey commands through the async auth module", async () => {
    const registration = { verified: true, userId: "user-1" };
    const passkeys = [
      {
        id: "credential-1",
        name: "Laptop",
        createdAt: "2026-01-02T12:00:00.000Z",
        deviceType: "multiDevice",
        backedUp: true,
        lastUsedAt: null,
      },
    ];
    mocks.register.mockResolvedValueOnce(registration);
    mocks.listPasskeys.mockResolvedValueOnce(passkeys);
    mocks.renamePasskey.mockResolvedValueOnce(undefined);
    const registered = vi.fn();
    const listed = vi.fn();
    const renamed = vi.fn();
    const failed = vi.fn();
    const store = startStore();

    store.dispatch(registerRequested("Reader", registered, failed));
    store.dispatch(listPasskeysRequested(listed, failed));
    store.dispatch(renamePasskeyRequested("credential-1", "Work laptop", renamed, failed));

    await vi.waitFor(() => expect(renamed).toHaveBeenCalledOnce());
    expect(registered).toHaveBeenCalledWith(registration);
    expect(listed).toHaveBeenCalledWith(passkeys);
    expect(failed).not.toHaveBeenCalled();
    expect(mocks.register).toHaveBeenCalledWith("Reader");
    expect(mocks.renamePasskey).toHaveBeenCalledWith("credential-1", "Work laptop");
  });
});
