import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

function getSiteOrigin() {
  const productionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (productionUrl) return `https://${productionUrl}`;
  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl) return `https://${vercelUrl}`;
  return "";
}

function isNetworkOnlyDocumentPath(pathname: string) {
  return ["/settings", "/login"].some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

export default defineConfig({
  plugins: [
    tailwindcss(),
    reactRouter(),
    VitePWA({
      outDir: "build/client",
      registerType: "prompt",
      strategies: "generateSW",
      workbox: {
        globPatterns: [
          // HTML is handled via additionalManifestEntries. A content-hash
          // revision is stamped post-build (scripts/patch-sw-index-html-revision.mjs).
          // Leaving /index.html at revision:null makes Workbox reuse a stale shell
          // across deploys while cleanupOutdatedCaches drops old hashed assets.
          "**/*.{js,css}",
          "fonts/**/*.woff2",
          "*.svg",
          "*.png",
          "favicon-*.png",
          "apple-touch-icon*",
          "og-image.png",
        ],
        cleanupOutdatedCaches: true,
        // revision is stamped post-build by scripts/patch-sw-index-html-revision.mjs
        additionalManifestEntries: [{ url: "/index.html", revision: null }],
        navigateFallback: null,
        runtimeCaching: [
          {
            urlPattern: ({ request, url, sameOrigin }) =>
              sameOrigin && request.mode === "navigate" && isNetworkOnlyDocumentPath(url.pathname),
            handler: "NetworkOnly",
          },
          {
            urlPattern: ({ request, url, sameOrigin }) =>
              sameOrigin &&
              request.mode === "navigate" &&
              !isNetworkOnlyDocumentPath(url.pathname) &&
              !url.pathname.startsWith("/api/") &&
              !url.pathname.startsWith("/share/") &&
              !url.pathname.startsWith("/debug/"),
            handler: "NetworkFirst",
            options: {
              cacheName: "documents",
              cacheableResponse: {
                statuses: [0, 200],
              },
              // Use the workspace shell only when both network and runtime cache miss.
              precacheFallback: {
                fallbackURL: "/index.html",
              },
            },
          },
          {
            urlPattern: ({ url }) =>
              url.pathname === "/api/sync/files/download" &&
              url.searchParams.get("type") === "cover",
            handler: "CacheFirst",
            options: {
              cacheName: "covers-proxy",
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /^https:\/\/[^/]+\.public\.blob\.vercel-storage\.com\/covers\/.*/,
            handler: "CacheFirst",
            options: {
              cacheName: "covers-public",
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith("/api/"),
            handler: "NetworkOnly",
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
      manifest: {
        name: "Readmaxxing",
        short_name: "Readmaxxing",
        description:
          "AI-assisted ebook reader with multi-pane layout, highlights, notes, and hundreds of free books.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        theme_color: "#0a0a0a",
        icons: [
          {
            src: "/apple-touch-icon.png",
            sizes: "180x180",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/favicon-32x32.png",
            sizes: "32x32",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/favicon-16x16.png",
            sizes: "16x16",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/favicon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
          {
            src: "/apple-touch-icon.png",
            sizes: "180x180",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
  ],
  define: {
    __SITE_ORIGIN__: JSON.stringify(getSiteOrigin()),
  },
  resolve: {
    tsconfigPaths: true,
  },
});
