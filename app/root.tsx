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

import type { Route } from "./+types/root";
import "./app.css";
import { ThemeEffect } from "~/components/theme-effect";
import { CommandBar } from "~/components/command-bar";
import { Toaster } from "~/components/ui/sonner";
import { AuthProvider } from "~/lib/context/auth-context";
import { WorkspaceProvider } from "~/lib/context/workspace-context";
import { useSync, SyncContext } from "~/lib/sync/use-sync";
import { COLOR_THEMES } from "~/lib/color-themes";

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
    if (ct !== 'default') {
      var m = dark ? 'dark' : 'light';
      var themes = ${colorThemeVarsJson};
      var vars = themes[ct] && themes[ct][m];
      if (vars) {
        var root = document.documentElement;
        for (var k in vars) {
          if (vars.hasOwnProperty(k)) root.style.setProperty(k, vars[k]);
        }
      }
    }
  } catch(e) {}
})();
`;

const SITE_ORIGIN = typeof __SITE_ORIGIN__ !== "undefined" ? __SITE_ORIGIN__ : "";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
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
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Literata:wght@400;500;600;700&family=Lora:wght@400;500;600;700&family=Merriweather:wght@400;700&family=Source+Serif+4:wght@400;500;600;700&display=swap"
          rel="stylesheet"
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
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ThemeEffect />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

function SyncProvider({ children }: { children: React.ReactNode }) {
  const syncState = useSync();
  return <SyncContext.Provider value={syncState}>{children}</SyncContext.Provider>;
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

export default function App() {
  return (
    <AuthProvider>
      <SyncProvider>
        <WorkspaceProvider>
          <SettingsShortcut />
          <CommandBar />
          <Outlet />
          <Toaster />
        </WorkspaceProvider>
      </SyncProvider>
    </AuthProvider>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!";
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
