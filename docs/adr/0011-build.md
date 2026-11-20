# ADR 0011: Build and tooling decisions

- Status: Accepted
- Date: 2026-11-20
- Source: code comments removed in the comment cleanup

## Detect service worker updates via event plus registration state

**Context.** registration.update() can discover a new worker, but some browsers expose it synchronously before the updatefound listener fires, or move it to waiting quickly after install.

**Decision.** triggerUpdateCheck treats an update as found if updatefound fired, or if registration.installing changed from before the call, or if registration.waiting is non-null.

**Consequences.** More robust update detection across browsers; a worker already waiting before the check also reports updateFound.

**Code.** `app/lib/sw-registry.ts#triggerUpdateCheck`

## Check for service worker updates on tab focus

**Context.** SW update checks poll hourly.

**Decision.** A visibilitychange handler calls checkForUpdate when the tab becomes visible, registered once on window.

**Consequences.** Returning users see the update toast sooner.

**Code.** `app/root.tsx`

## One-shot stale asset recovery after deploy

**Context.** A stale service-worker shell can reference hashed assets that no longer exist after a deploy. If entry chunks 404, React never boots, so the normal update toast cannot appear.

**Decision.** An inline script listens for script/link load errors on same-origin /assets/ URLs and, once per session (sessionStorage key readmax-stale-asset-recover), reloads: soft refresh keeps the service worker, hard refresh bypasses it.

**Consequences.** Users recover from broken deploy states automatically, at most once per session.

**Code.** `app/root.tsx#staleAssetRecoveryScript`

## Fixture ZIPs use a fixed local-time mtime

**Context.** ZIP DOS timestamps have no timezone and fflate serializes a Date's local fields.

**Decision.** FIXED_MTIME is new Date(2000,0,1) in local time so archives are byte-identical across timezones.

**Consequences.** Deterministic fixtures.

**Code.** `packages/epub-successor/fixtures/build.ts`

## Stamp content hash on /index.html in the SW manifest

**Context.** Workbox treats revision:null as already versioned and never refetches; /index.html is not hashed, so new SWs reuse old shell HTML while cleanupOutdatedCaches drops old hashed assets, causing 404s on soft refresh.

**Decision.** HTML is excluded from globPatterns and added via additionalManifestEntries with revision:null; scripts/patch-sw-index-html-revision.mjs runs after the client build and stamps a content hash.

**Consequences.** Build has a post step.

**Code.** `scripts/patch-sw-index-html-revision.mjs`

## Shell fallback only on network and cache miss

**Context.** Navigation offline.

**Decision.** precacheFallback to /index.html only when both network and runtime cache miss.

**Consequences.** Prefers fresher responses.

**Code.** `vite.config.ts`

## SW returns empty 204 on loader fetch failure

**Context.** Offline loader data requests fail.

**Decision.** Workbox handlerDidError returns 204, which React Router reads as no server loader data so clientLoaders continue with IndexedDB.

**Consequences.** Offline navigation works.

**Code.** `vite.config.ts`
