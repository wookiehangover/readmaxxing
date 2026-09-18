import { chromium } from "@playwright/test";
import { createServer } from "vite";

// Runs only in the verification sandbox, against the app's actual engine sources.
const server = await createServer({
  configFile: false,
  root: process.cwd(),
  server: { host: "127.0.0.1", port: 4173, strictPort: true },
});
await server.listen();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  await page.goto("http://127.0.0.1:4173/check.html");
  const result = await page.evaluate(async () => {
    const { openZipResourceProvider, openPublication, createNavigator } =
      await import("/engine/index.ts");
    const data = await (await fetch("/candidate.epub")).arrayBuffer();
    const provider = await openZipResourceProvider(data);
    let navigator;
    try {
      const { publication, diagnostics } = await openPublication(provider);
      if (!publication || diagnostics.some((d) => d.severity === "error"))
        throw new Error(JSON.stringify(diagnostics));
      const container = document.getElementById("reader");
      navigator = createNavigator(publication, {
        container,
        flow: "paginated",
        security: { resourceProvider: provider },
      });
      let rendered = 0;
      for (const flow of ["paginated", "scrolled"]) {
        await navigator.setPreferences({ flow });
        for (let spineIndex = 0; spineIndex < publication.readingOrder.length; spineIndex++) {
          await navigator.display({ spineIndex });
          const document = navigator.contentDocument;
          if (
            !document?.body ||
            !(document.body.textContent?.trim() || document.body.querySelector("img, svg"))
          )
            throw new Error(`Empty chapter ${spineIndex + 1} (${flow})`);
          await Promise.all(Array.from(document.images, (img) => img.decode()));
          if (document.body.getBoundingClientRect().height <= 0)
            throw new Error(`Chapter ${spineIndex + 1} has no layout (${flow})`);
          rendered++;
        }
      }
      if (!rendered) throw new Error("No readable chapters");
      return `Rendered ${publication.readingOrder.length} chapters in paginated and scrolled modes.`;
    } finally {
      navigator?.destroy();
      provider.close();
    }
  });
  console.log(result);
} finally {
  await browser.close();
  await server.close();
}
