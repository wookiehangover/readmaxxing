import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addPasskey: vi.fn(),
  generateMagicLink: vi.fn(),
  getBookIncludingDeleted: vi.fn(),
  getSession: vi.fn(),
  hasUnadoptedDemoBook: vi.fn(),
  listPasskeys: vi.fn(),
  logout: vi.fn(),
  persistAdoptedDemoContent: vi.fn(),
  register: vi.fn(),
  removePasskey: vi.fn(),
  renamePasskey: vi.fn(),
  signIn: vi.fn(),
}));

vi.mock("~/lib/auth-service", () => ({
  authService: mocks,
}));
vi.mock("~/lib/onboarding/adopt-demo", () => ({
  hasUnadoptedDemoBook: mocks.hasUnadoptedDemoBook,
  persistAdoptedDemoContent: vi.fn(() => {
    throw new Error("Auth refresh must not wait for network adoption");
  }),
}));
vi.mock("~/lib/onboarding/adopt-demo-local", () => ({
  prepareAdoptedDemoContent: mocks.persistAdoptedDemoContent,
}));
vi.mock("~/lib/stores/book-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/stores/book-store")>();
  return {
    ...actual,
    BookService: { ...actual.BookService, getBookIncludingDeleted: mocks.getBookIncludingDeleted },
  };
});

import { DEMO_BOOK_ID } from "~/lib/onboarding/demo-content";
import { authSessionSaga } from "~/lib/themis/auth-session/auth-session-sagas";
import {
  listPasskeysRequested,
  authSessionResolved,
  logoutRequested,
  registerRequested,
  refreshAuthSessionRequested,
  renamePasskeyRequested,
  signInRequested,
} from "~/lib/themis/auth-session/auth-session-slice";
import { booksSaga } from "~/lib/themis/books/books-sagas";
import { bookAdded } from "~/lib/themis/books/books-slice";
import { createAppStore, type AppStore } from "~/lib/themis/store";

const stores: AppStore[] = [];
const user = { id: "user-1", displayName: "Reader" };

function startStore({ runBooksSaga = false }: { runBooksSaga?: boolean } = {}) {
  const store = createAppStore();
  stores.push(store);
  store.init();
  store.runSaga(authSessionSaga);
  if (runBooksSaga) store.runSaga(booksSaga);
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

  it("adopts a locally present demo before exposing the authenticated session", async () => {
    const demo = {
      id: DEMO_BOOK_ID,
      title: "The Great Gatsby",
      author: "F. Scott Fitzgerald",
      coverImage: null,
      format: "epub" as const,
    };
    const adopted = { bookId: "account-book", sessionId: "account-session" };
    const adoptedBook = { ...demo, id: adopted.bookId };
    let finishAdoption!: (result: typeof adopted) => void;
    const adoption = new Promise<typeof adopted>((resolve) => {
      finishAdoption = resolve;
    });
    mocks.getSession.mockResolvedValueOnce({ user });
    mocks.hasUnadoptedDemoBook.mockResolvedValueOnce(true);
    mocks.persistAdoptedDemoContent.mockReturnValueOnce(adoption);
    mocks.getBookIncludingDeleted.mockResolvedValueOnce(adoptedBook);
    const onCompleted = vi.fn();
    const onFailed = vi.fn();
    const store = startStore({ runBooksSaga: true });
    store.dispatch(bookAdded(demo));

    store.dispatch(refreshAuthSessionRequested(onCompleted, onFailed));

    await vi.waitFor(() => expect(mocks.persistAdoptedDemoContent).toHaveBeenCalledWith(user.id));
    expect(store.authSessionSelectors.selectIsAuthenticated.select(store.state)).toBe(false);
    expect(store.authSessionSelectors.selectAuthLoading.select(store.state)).toBe(true);
    expect(onCompleted).not.toHaveBeenCalled();

    finishAdoption(adopted);

    await vi.waitFor(() => expect(onCompleted).toHaveBeenCalledOnce());
    expect(store.authSessionSelectors.selectAuthUser.select(store.state)).toEqual(user);
    expect(store.booksSelectors.selectBookById.select(store.state, adopted.bookId)).toEqual(
      adoptedBook,
    );
    expect(store.booksSelectors.selectBookById.select(store.state, DEMO_BOOK_ID)).toBeUndefined();
    expect(mocks.persistAdoptedDemoContent).toHaveBeenCalledOnce();
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("finishes an adoption-bearing refresh before processing a later refresh", async () => {
    const demo = {
      id: DEMO_BOOK_ID,
      title: "The Great Gatsby",
      author: "F. Scott Fitzgerald",
      coverImage: null,
      format: "epub" as const,
    };
    const adopted = { bookId: "account-book", sessionId: "account-session" };
    let finishAdoption!: (result: typeof adopted) => void;
    mocks.getSession.mockResolvedValue({ user });
    mocks.hasUnadoptedDemoBook.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    mocks.persistAdoptedDemoContent.mockReturnValueOnce(
      new Promise<typeof adopted>((resolve) => {
        finishAdoption = resolve;
      }),
    );
    mocks.getBookIncludingDeleted.mockResolvedValueOnce({ ...demo, id: adopted.bookId });
    const firstCompleted = vi.fn();
    const secondCompleted = vi.fn();
    const failed = vi.fn();
    const store = startStore({ runBooksSaga: true });
    store.dispatch(bookAdded(demo));

    store.dispatch(refreshAuthSessionRequested(firstCompleted, failed));
    await vi.waitFor(() => expect(mocks.persistAdoptedDemoContent).toHaveBeenCalledOnce());
    store.dispatch(refreshAuthSessionRequested(secondCompleted, failed));

    expect(mocks.getSession).toHaveBeenCalledOnce();
    expect(store.authSessionSelectors.selectIsAuthenticated.select(store.state)).toBe(false);
    expect(firstCompleted).not.toHaveBeenCalled();
    expect(secondCompleted).not.toHaveBeenCalled();

    finishAdoption(adopted);

    await vi.waitFor(() => expect(secondCompleted).toHaveBeenCalledOnce());
    expect(firstCompleted).toHaveBeenCalledOnce();
    expect(mocks.persistAdoptedDemoContent).toHaveBeenCalledOnce();
    expect(store.authSessionSelectors.selectAuthUser.select(store.state)).toEqual(user);
    expect(failed).not.toHaveBeenCalled();
  });

  it.each(["register", "signIn"] as const)(
    "adopts the demo before completing ordinary %s authentication",
    async (operation) => {
      const demo = {
        id: DEMO_BOOK_ID,
        title: "The Great Gatsby",
        author: "F. Scott Fitzgerald",
        coverImage: null,
        format: "epub" as const,
      };
      const adopted = { bookId: "account-book", sessionId: "account-session" };
      const registration = { verified: true, userId: user.id };
      const signIn = { verified: true, user };
      let finishAdoption!: (result: typeof adopted) => void;
      mocks[operation].mockResolvedValueOnce(operation === "register" ? registration : signIn);
      mocks.getSession.mockResolvedValueOnce({ user });
      mocks.hasUnadoptedDemoBook.mockResolvedValueOnce(true);
      mocks.persistAdoptedDemoContent.mockReturnValueOnce(
        new Promise<typeof adopted>((resolve) => {
          finishAdoption = resolve;
        }),
      );
      mocks.getBookIncludingDeleted.mockResolvedValueOnce({ ...demo, id: adopted.bookId });
      const completed = vi.fn();
      const failed = vi.fn();
      const store = startStore({ runBooksSaga: true });
      store.dispatch(bookAdded(demo));

      store.dispatch(
        operation === "register"
          ? registerRequested("Reader", completed, failed, true)
          : signInRequested(completed, failed, true),
      );

      await vi.waitFor(() => expect(mocks.persistAdoptedDemoContent).toHaveBeenCalledWith(user.id));
      expect(completed).not.toHaveBeenCalled();
      expect(store.authSessionSelectors.selectIsAuthenticated.select(store.state)).toBe(false);

      finishAdoption(adopted);

      await vi.waitFor(() => expect(completed).toHaveBeenCalledOnce());
      expect(completed).toHaveBeenCalledWith(operation === "register" ? registration : signIn);
      expect(store.authSessionSelectors.selectAuthUser.select(store.state)).toEqual(user);
      expect(mocks.persistAdoptedDemoContent).toHaveBeenCalledOnce();
      expect(failed).not.toHaveBeenCalled();
    },
  );

  it("does not read or adopt a demo while the session is signed out", async () => {
    mocks.getSession.mockResolvedValueOnce({ user: null });
    const store = startStore();

    store.dispatch(refreshAuthSessionRequested());

    await vi.waitFor(() =>
      expect(store.authSessionSelectors.selectAuthLoading.select(store.state)).toBe(false),
    );
    expect(mocks.hasUnadoptedDemoBook).not.toHaveBeenCalled();
    expect(mocks.persistAdoptedDemoContent).not.toHaveBeenCalled();
  });

  it("skips adoption when the demo is missing, deleted, or already adopted", async () => {
    mocks.getSession.mockResolvedValueOnce({ user });
    mocks.hasUnadoptedDemoBook.mockResolvedValueOnce(false);
    const store = startStore({ runBooksSaga: true });

    store.dispatch(refreshAuthSessionRequested());

    await vi.waitFor(() =>
      expect(store.authSessionSelectors.selectAuthUser.select(store.state)).toEqual(user),
    );
    expect(mocks.persistAdoptedDemoContent).not.toHaveBeenCalled();
  });

  it.each(["refresh", "register", "signIn"] as const)(
    "completes %s when optional demo adoption fails",
    async (operation) => {
      mocks.getSession.mockResolvedValueOnce({ user });
      mocks.register.mockResolvedValueOnce({ verified: true, userId: user.id });
      mocks.signIn.mockResolvedValueOnce({ verified: true, user });
      mocks.hasUnadoptedDemoBook.mockResolvedValueOnce(true);
      mocks.persistAdoptedDemoContent.mockRejectedValueOnce(
        new Error("The demo conversation could not be found."),
      );
      const onCompleted = vi.fn();
      const onFailed = vi.fn();
      const store = startStore({ runBooksSaga: true });

      store.dispatch(
        operation === "refresh"
          ? refreshAuthSessionRequested(onCompleted, onFailed)
          : operation === "register"
            ? registerRequested("Reader", onCompleted, onFailed, true)
            : signInRequested(onCompleted, onFailed, true),
      );

      await vi.waitFor(() => expect(onCompleted).toHaveBeenCalledOnce());
      expect(store.authSessionSelectors.selectAuthUser.select(store.state)).toEqual(user);
      expect(store.authSessionSelectors.selectIsAuthenticated.select(store.state)).toBe(true);
      expect(store.authSessionSelectors.selectAuthLoading.select(store.state)).toBe(false);
      expect(store.authSessionSelectors.selectAuthError.select(store.state)).toBeNull();
      expect(onFailed).not.toHaveBeenCalled();
    },
  );

  it("completes session refresh when checking local demo state fails", async () => {
    mocks.getSession.mockResolvedValueOnce({ user });
    mocks.hasUnadoptedDemoBook.mockRejectedValueOnce(new Error("local storage unavailable"));
    const onCompleted = vi.fn();
    const onFailed = vi.fn();
    const store = startStore();

    store.dispatch(refreshAuthSessionRequested(onCompleted, onFailed));

    await vi.waitFor(() => expect(onCompleted).toHaveBeenCalledOnce());
    expect(store.authSessionSelectors.selectAuthUser.select(store.state)).toEqual(user);
    expect(store.authSessionSelectors.selectIsAuthenticated.select(store.state)).toBe(true);
    expect(store.authSessionSelectors.selectAuthLoading.select(store.state)).toBe(false);
    expect(store.authSessionSelectors.selectAuthError.select(store.state)).toBeNull();
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("still rejects sign-in when passkey verification fails", async () => {
    const error = new Error("Verification failed");
    mocks.signIn.mockRejectedValueOnce(error);
    const onCompleted = vi.fn();
    const onFailed = vi.fn();
    const store = startStore();

    store.dispatch(signInRequested(onCompleted, onFailed, true));

    await vi.waitFor(() => expect(onFailed).toHaveBeenCalledWith(error));
    expect(onCompleted).not.toHaveBeenCalled();
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.persistAdoptedDemoContent).not.toHaveBeenCalled();
    expect(store.authSessionSelectors.selectIsAuthenticated.select(store.state)).toBe(false);
  });

  it("resolves a failed refresh as signed out", async () => {
    mocks.getSession.mockRejectedValueOnce(new Error("offline"));
    const store = startStore();

    store.dispatch(refreshAuthSessionRequested());

    await vi.waitFor(() =>
      expect(store.authSessionSelectors.selectAuthLoading.select(store.state)).toBe(false),
    );
    expect(store.authSessionSelectors.selectIsAuthenticated.select(store.state)).toBe(false);
    expect(store.authSessionSelectors.selectAuthError.select(store.state)).toEqual({
      _tag: "Error",
      message: "offline",
    });
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
    expect(store.authSessionSelectors.selectAuthError.select(store.state)).toEqual({
      _tag: "Error",
      message: "offline",
    });
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
