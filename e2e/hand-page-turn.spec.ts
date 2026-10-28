import { test, expect, type Page } from "@playwright/test";
import { seedShelf } from "./helpers/bookshelf";

test.use({ serviceWorkers: "block" });

async function turn(page: Page, key: "ArrowRight" | "ArrowLeft") {
  await page
    .locator("iframe")
    .first()
    .evaluate((frame, key) => {
      (frame as HTMLIFrameElement).contentDocument!.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true }),
      );
    }, key);
}

async function openFormatting(page: Page) {
  await page.mouse.move(1, 1);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Reader menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Formatting", exact: true }).click();
}

async function swipe(page: Page, distance: number) {
  await page
    .locator("iframe")
    .first()
    .evaluate((frame, distance) => {
      const document = (frame as HTMLIFrameElement).contentDocument!;
      for (const [type, x, time] of [
        ["touchstart", 280, 10],
        ["touchmove", 280 - distance, 210],
        ["touchend", 280 - distance, 410],
      ] as const) {
        const point = { identifier: 1, clientX: x, clientY: 100 };
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperties(event, {
          touches: { value: type === "touchend" ? [] : [point] },
          changedTouches: { value: [point] },
          timeStamp: { value: time },
        });
        document.dispatchEvent(event);
      }
    }, distance);
}

for (const mobile of [false, true]) {
  test(`hand page turning ${mobile ? "mobile" : "desktop"}`, async ({ page }) => {
    await page.setViewportSize(
      mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
    );
    await page.addInitScript((mobile) => {
      localStorage.setItem("demo-onboarding", "complete");
      localStorage.setItem("app-settings", JSON.stringify({ theme: mobile ? "dark" : "light" }));
    }, mobile);
    await page.route("**/api/chapter-questions", (route) => route.fulfill({ json: [] }));
    await seedShelf(page);
    await page.goto("/books/shelf-local");
    if (mobile) await page.getByRole("tab", { name: "Read", exact: true }).click();
    const body = page.frameLocator("iframe").first().locator("body");
    await expect(body).not.toBeEmpty();
    const before = await body.textContent();
    const size = mobile ? "mobile" : "desktop";
    await page.screenshot({ path: `.intent/artifacts/hand-${size}-before.png` });
    await openFormatting(page);
    await page.getByRole("menuitem", { name: "Page turn: Slide", exact: true }).click();
    await page.screenshot({ path: `.intent/artifacts/hand-${size}-menu.png` });
    await page.getByRole("menuitemradio", { name: "Hand (experimental)", exact: true }).click();
    await page.mouse.move(1, 1);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(page.locator('[role="menu"]')).toHaveCount(0);
    await page.evaluate(() => {
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (...args) {
        const animation = animate.apply(this, args);
        if (this.closest("[data-page-turn-hand]")) {
          animation.pause();
          animation.currentTime =
            this.closest<HTMLElement>("[data-page-turn-hand]")?.dataset.pageTurnPhase === "reach"
              ? 450
              : 260;
        }
        return animation;
      };
    });
    if (mobile) {
      await swipe(page, 30);
      await expect(page.locator("[data-page-turn-hand]")).toHaveCount(0);
      await expect(body).toHaveText(before!);
      await swipe(page, 180);
    } else await turn(page, "ArrowRight");
    const hand = page.locator('[data-page-turn-hand="next"]');
    await expect(hand).toHaveCount(1);
    const handImage = hand.locator("[data-page-turn-hand-image]");
    await handImage.evaluate((image) => (image as HTMLImageElement).decode());
    const reachBounds = await handImage.boundingBox();
    const armBounds = await hand.locator("[data-page-turn-arm]").boundingBox();
    const pageBounds = await page.locator("iframe").first().boundingBox();
    expect(armBounds!.x).toBeCloseTo(0);
    expect(
      Math.abs(reachBounds!.x + reachBounds!.width - pageBounds!.x - pageBounds!.width),
    ).toBeLessThan(16);
    await expect(body).toHaveText(before!);
    await page.screenshot({ path: `.intent/artifacts/sleeved-hand-${size}-reach-right.png` });
    await hand
      .locator("[data-page-turn-arm]")
      .evaluate((arm) => arm.getAnimations().forEach((animation) => animation.finish()));
    await expect(body).not.toHaveText(before!);
    const pullBounds = await handImage.boundingBox();
    expect(pullBounds!.x).toBeLessThan(reachBounds!.x);
    expect((await hand.locator("[data-page-turn-arm]").boundingBox())!.x).toBeCloseTo(0);
    await page.screenshot({ path: `.intent/artifacts/sleeved-hand-${size}-pull-left.png` });
    await turn(page, "ArrowLeft");
    await expect(page.locator('[data-page-turn-hand="previous"]')).toHaveCount(1);
    await expect(hand).toHaveCount(0);
    const previous = page.locator('[data-page-turn-hand="previous"]');
    const previousArmBounds = await previous.locator("[data-page-turn-arm]").boundingBox();
    expect(previousArmBounds!.x + previousArmBounds!.width).toBeCloseTo(page.viewportSize()!.width);
    const previousReach = await previous.locator("[data-page-turn-hand-image]").boundingBox();
    expect(Math.abs(previousReach!.x - pageBounds!.x)).toBeLessThan(16);
    await page.screenshot({ path: `.intent/artifacts/sleeved-hand-${size}-reach-left.png` });
    await page
      .locator('[data-page-turn-hand="previous"] [data-page-turn-arm]')
      .evaluate((arm) => arm.getAnimations().forEach((animation) => animation.finish()));
    await expect(body).toHaveText(before!);
    const previousPull = await previous.locator("[data-page-turn-hand-image]").boundingBox();
    expect(previousPull!.x).toBeGreaterThan(previousReach!.x);
    const previousPullArm = await previous.locator("[data-page-turn-arm]").boundingBox();
    expect(previousPullArm!.x + previousPullArm!.width).toBeCloseTo(page.viewportSize()!.width);
    await page.screenshot({ path: `.intent/artifacts/sleeved-hand-${size}-pull-right.png` });
    await page.evaluate(() => {
      for (const animation of document.getAnimations()) {
        const target = (animation.effect as KeyframeEffect)?.target;
        if (target instanceof Element && target.closest("[data-page-turn-hand]"))
          animation.finish();
      }
    });
    await expect(page.locator("[data-page-turn-hand]")).toHaveCount(0);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await turn(page, "ArrowRight");
    await expect(page.locator("[data-page-turn-hand]")).toHaveCount(0);
    await expect(body).not.toHaveText(before!);
    await openFormatting(page);
    await page.getByRole("menuitemradio", { name: "Continuous Scroll", exact: true }).click();
    await openFormatting(page);
    await expect(
      page.getByRole("menuitem", { name: "Page turn: Hand", exact: true }),
    ).toBeDisabled();
  });
}
