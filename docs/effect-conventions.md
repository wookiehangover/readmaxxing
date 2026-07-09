# Effect.ts Conventions

The project uses Effect.ts for service-based dependency injection and typed error handling.

## Services

Define with `Context.Tag`, implement with `Layer.succeed`:

```ts
import { Context, Effect, Layer } from "effect";

export class MyService extends Context.Tag("MyService")<
  MyService,
  { readonly doThing: (arg: string) => Effect.Effect<Result, MyError> }
>() {}

export const MyServiceLive = Layer.succeed(MyService, {
  doThing: (arg) =>
    Effect.tryPromise({
      try: () => someAsyncWork(arg),
      catch: (cause) => new MyError({ operation: "doThing", cause }),
    }),
});
```

## Errors

Define with `Data.TaggedError` in `app/lib/errors.ts`. Always include an `operation` field and optional `cause`:

```ts
import { Data } from "effect";

export class MyError extends Data.TaggedError("MyError")<{
  readonly operation: string;
  readonly cause?: unknown;
}> {}
```

## Runtime

All service layers compose in `app/lib/effect-runtime.ts` via `Layer.mergeAll`, exposed as `AppRuntime` (a `ManagedRuntime`). When adding a service, add its live layer to `AppLayer` there.

## Executing effects

Run effects through `AppRuntime.runPromise(...)` at call sites (route loaders, event handlers, fire-and-forget). Access patterns:

1. Pipe from the service tag (one-shot calls):
   ```ts
   await AppRuntime.runPromise(BookService.pipe(Effect.andThen((s) => s.getBooks())));
   ```
2. Generator style (chaining multiple service calls):
   ```ts
   const program = Effect.gen(function* () {
     const svc = yield* AnnotationService;
     return yield* svc.getHighlightsByBook(bookId);
   });
   await AppRuntime.runPromise(program);
   ```
3. `useEffectQuery` hook — **preferred** for declarative data loading in React components. Reserve `AppRuntime.runPromise` for loaders, event handlers, and fire-and-forget:
   ```ts
   const { data, error, isLoading } = useEffectQuery(
     () => BookService.pipe(Effect.andThen((s) => s.getBooks())),
     [deps],
   );
   ```

## Error handling

Handle errors in the Effect pipeline, not after `runPromise`.

- Use `Effect.catchAll` / `Effect.catchTag` *before* `runPromise`, not `try/catch` after:
  ```ts
  Effect.catchTag("BookNotFoundError", () =>
    Effect.die(new Response("Book not found", { status: 404 })),
  );
  ```
- Fire-and-forget `runPromise` calls (e.g. debounced saves) must always have `.catch()`:
  ```ts
  AppRuntime.runPromise(effect).catch(console.error);
  ```
- Use `Effect.ensuring` for cleanup, not `finally`.
- Do NOT use raw `try/catch` around IndexedDB or other async service calls. Wrap them in `Effect.tryPromise` and let Effect propagate typed errors.
