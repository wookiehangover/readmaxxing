import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";

test("book camera origin follows updates and clamps to the resized scene", async ({ page }) => {
  const stylesheet = await readFile("app/components/bookshelf/bookshelf.css", "utf8");
  await page.setContent(`
    <style>${stylesheet}</style>
    <div class="bookshelf-scene" data-active="true"
      style="width: 600px; height: 120px; padding: 0"></div>
  `);
  const scene = page.locator(".bookshelf-scene");
  await expect(scene).toHaveCSS("perspective-origin", "300px 60px");

  for (const [camera, expected] of [
    [-320, -320],
    [-80, -80],
    [40, 40],
    [500, 144],
  ]) {
    await scene.evaluate((element, position) => {
      element.style.setProperty("--shelf-camera-y", `${position}px`);
    }, camera);
    await expect(scene).toHaveCSS("perspective-origin", `300px ${expected}px`);
  }

  await scene.evaluate((element) => {
    element.style.width = "400px";
    element.style.height = "160px";
  });
  await expect(scene).toHaveCSS("perspective-origin", "200px 184px");

  await scene.evaluate((element) => element.style.setProperty("--shelf-camera-y", "-200px"));
  await expect(scene).toHaveCSS("perspective-origin", "200px -200px");
});
