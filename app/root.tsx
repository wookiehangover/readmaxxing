import { useEffect } from "react";
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
  useNavigate,
} from "react-router";
import { useRegisterSW } from "virtual:pwa-register/react";
import { toast } from "sonner";

import type { Route } from "./+types/root";
import "./app.css";
import { ThemeEffect } from "~/components/theme-effect";
import { CommandBar } from "~/components/command-bar";
import { Toaster } from "~/components/ui/sonner";
import { AuthProvider } from "~/lib/context/auth-context";
import { WorkspaceProvider } from "~/lib/context/workspace-context";
import { useSync, SyncContext } from "~/lib/sync/use-sync";
import { COLOR_THEMES } from "~/lib/color-themes";
import { setSWRegistration } from "~/lib/sw-registry";

export async function loader() {
  if (import.meta.env.DEV) {
    const { startLocalReadingIngestSweep } = await import("~/lib/reading-agent/dispatch.server");
    startLocalReadingIngestSweep();
  }
  return null;
}

// Build a minimal JSON blob of non-default theme CSS variables for the FOUC script.
// This is serialized at build/SSR time and embedded in the inline script.
const colorThemeVarsJson = JSON.stringify(
  Object.fromEntries(
    Object.entries(COLOR_THEMES)
      .filter(([id]) => id !== "default")
      .map(([id, def]) => [id, { light: def.light, dark: def.dark }]),
  ),
);

// Inline script to set the theme class and color theme variables before React hydrates,
// preventing FOUC. This must be self-contained (no imports).
const themeScript = `
(function() {
  try {
    var s = JSON.parse(localStorage.getItem('app-settings') || '{}');
    var t = s.theme || 'system';
    var dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) document.documentElement.classList.add('dark');
    var ct = s.colorTheme || 'default';
    var themeColor = dark ? '#0a0a0a' : '#ffffff';
    if (ct !== 'default') {
      var m = dark ? 'dark' : 'light';
      var themes = ${colorThemeVarsJson};
      var vars = themes[ct] && themes[ct][m];
      if (vars) {
        var root = document.documentElement;
        for (var k in vars) {
          if (vars.hasOwnProperty(k)) root.style.setProperty(k, vars[k]);
        }
        if (vars['--background']) themeColor = vars['--background'];
      }
    }
    var themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (themeColorMeta) themeColorMeta.setAttribute('content', themeColor);
  } catch(e) {}
})();
`;

// One-shot recovery when a stale service-worker shell references hashed assets that
// no longer exist after a deploy. Soft-refresh keeps the SW; hard-refresh bypasses it.
// If entry chunks 404, React never boots and the normal update toast cannot appear.
const staleAssetRecoveryScript = `
(function() {
  var key = 'readmax-stale-asset-recover';
  function isAppAsset(url) {
    try {
      var u = new URL(url, location.origin);
      return u.origin === location.origin && u.pathname.indexOf('/assets/') === 0;
    } catch (e) {
      return false;
    }
  }
  window.addEventListener('error', function (event) {
    var el = event.target;
    if (!el || (el.tagName !== 'SCRIPT' && el.tagName !== 'LINK')) return;
    var url = el.src || el.href;
    if (!url || !isAppAsset(url)) return;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
    var done = function () { location.reload(); };
    if (!('serviceWorker' in navigator)) {
      done();
      return;
    }
    navigator.serviceWorker.getRegistrations().then(function (regs) {
      return Promise.all(regs.map(function (reg) { return reg.unregister(); }));
    }).then(function () {
      if (!('caches' in window)) return;
      return caches.keys().then(function (keys) {
        return Promise.all(keys.map(function (name) { return caches.delete(name); }));
      });
    }).then(done, done);
  }, true);
})();
`;

const SITE_ORIGIN = typeof __SITE_ORIGIN__ !== "undefined" ? __SITE_ORIGIN__ : "";
const SW_UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

declare global {
  interface Window {
    __readmaxSWUpdateIntervalId?: number;
    __readmaxSWVisibilityHandler?: () => void;
  }
}

function startSWUpdatePolling(registration: ServiceWorkerRegistration) {
  if (typeof window === "undefined" || window.__readmaxSWUpdateIntervalId !== undefined) {
    return;
  }

  const checkForUpdate = () => {
    registration.update().catch(console.error);
  };

  window.__readmaxSWUpdateIntervalId = window.setInterval(
    checkForUpdate,
    SW_UPDATE_CHECK_INTERVAL_MS,
  );

  // Catch deploys sooner than the hourly poll when the user returns to the tab.
  if (!window.__readmaxSWVisibilityHandler) {
    window.__readmaxSWVisibilityHandler = () => {
      if (document.visibilityState === "visible") {
        checkForUpdate();
      }
    };
    document.addEventListener("visibilitychange", window.__readmaxSWVisibilityHandler);
  }
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#ffffff" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <link rel="manifest" href="/manifest.webmanifest" />
        <link
          rel="preload"
          href="/fonts/Geist[wght].woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/GeistMono[wght].woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/BerkeleyMonoVariable.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link rel="icon" href="/favicon-32x32.png" type="image/png" sizes="32x32" />
        <link rel="icon" href="/favicon-16x16.png" type="image/png" sizes="16x16" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link
          rel="apple-touch-icon"
          href="/apple-touch-icon-dark.png"
          sizes="180x180"
          media="(prefers-color-scheme: dark)"
        />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180" />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="Readmaxxing" />
        <meta property="og:title" content="Readmaxxing" />
        <meta
          property="og:description"
          content="AI-assisted ebook reader with multi-pane layout, highlights, notes, and hundreds of free books."
        />
        <meta property="og:image" content={`${SITE_ORIGIN}/og-image.png`} />
        <meta property="og:image:width" content="1360" />
        <meta property="og:image:height" content="768" />
        <meta property="og:image:type" content="image/png" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Readmaxxing" />
        <meta
          name="twitter:description"
          content="AI-assisted ebook reader with multi-pane layout, highlights, notes, and hundreds of free books."
        />
        <meta name="twitter:image" content={`${SITE_ORIGIN}/og-image.png`} />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <script dangerouslySetInnerHTML={{ __html: staleAssetRecoveryScript }} />
        <Meta />
        <Links />
      </head>
      <body>
        <div aria-hidden="true" className="safari-titlebar-color" />
        {children}
        <ThemeEffect />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

function SyncProvider({ children }: { children: React.ReactNode }) {
  // Actions only — isSyncing/pending live on an external store so status flips
  // do not re-render the workspace tree under this provider.
  const syncActions = useSync();
  return <SyncContext.Provider value={syncActions}>{children}</SyncContext.Provider>;
}

function SettingsShortcut() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        if (location.pathname !== "/settings") {
          navigate("/settings");
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigate, location.pathname]);

  return null;
}

function ServiceWorkerRefreshToast() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      setSWRegistration(registration);
      if (registration) {
        startSWUpdatePolling(registration);
      }
    },
  });

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator) || !needRefresh) {
      return;
    }

    const toastId = toast("A new version is available", {
      action: {
        label: "Refresh",
        onClick: () => {
          void updateServiceWorker(true);
        },
      },
      duration: Infinity,
    });

    return () => {
      toast.dismiss(toastId);
    };
  }, [needRefresh, updateServiceWorker]);

  return null;
}

export default function App() {
  return (
    <AuthProvider>
      <SyncProvider>
        <WorkspaceProvider>
          <SettingsShortcut />
          <ServiceWorkerRefreshToast />
          <CommandBar />
          <Outlet />
          <Toaster />
        </WorkspaceProvider>
      </SyncProvider>
    </AuthProvider>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Uh oh.";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404 ? "The requested page could not be found." : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="pt-16 p-4 container mx-auto">
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre className="w-full p-4 overflow-x-auto">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
