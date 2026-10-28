export function showHandPageTurn(container: HTMLElement, direction: "next" | "previous") {
  const document = container.ownerDocument;
  const view = document.defaultView;
  if (!view || view.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const host = container.parentElement ?? container;
  const bounds = host.getBoundingClientRect();
  const page = (container.querySelector("iframe") ?? container).getBoundingClientRect();
  const fromRight = direction === "next";
  const width = Math.min(820, Math.max(380, bounds.width * 0.8));
  const height = width / 2.104;
  const overlap = Math.min(140, width * 0.34);
  const edge = (fromRight ? page.right : page.left) - bounds.left;
  const contactX = fromRight ? edge - overlap : edge - width + overlap;
  const contactY = Math.max(0, bounds.height * 0.55 - height * 0.38);
  const startX = fromRight ? bounds.width + 40 : -width - 40;
  const pullX = contactX + (fromRight ? -1 : 1) * page.width * 0.75;
  const exitX = fromRight ? -width - 40 : bounds.width + 40;
  const transform = (x: number, y: number, angle: number, grip = 1) =>
    `translate3d(${x}px,${y}px,0) rotate(${angle}deg) scale(${fromRight ? -grip : grip},1)`;
  const overlay = document.createElement("div");
  overlay.dataset.pageTurnHand = direction;
  overlay.dataset.pageTurnPhase = "reach";
  overlay.setAttribute("aria-hidden", "true");
  overlay.style.cssText =
    "position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:6;contain:layout paint;";
  const hand = document.createElement("img");
  hand.src = "/images/page-turn-palm-down.webp";
  hand.alt = "";
  hand.draggable = false;
  hand.style.cssText = `position:absolute;top:0;left:0;width:${width}px;height:${height}px;max-width:none;transform-origin:50% 38%;filter:drop-shadow(0 10px 10px rgb(0 0 0 / .18));`;
  overlay.append(hand);
  host.append(overlay);
  const contact = transform(contactX, contactY, 0);
  const grip = transform(contactX, contactY + 6, fromRight ? -3 : 3, 0.96);
  const reach = hand.animate(
    [
      {
        transform: transform(startX, contactY + 20, fromRight ? 8 : -8),
        offset: 0,
        easing: "ease-out",
      },
      { transform: contact, offset: 0.72, easing: "ease-in-out" },
      { transform: grip, offset: 1 },
    ],
    { duration: 360, fill: "both" },
  );
  let pull: Animation | undefined;
  let cancelled = false;
  const cancel = () => {
    cancelled = true;
    reach.cancel();
    pull?.cancel();
    overlay.remove();
  };
  const ready = reach.finished.then(
    () => {
      if (cancelled) return;
      overlay.dataset.pageTurnPhase = "pull";
      pull = hand.animate(
        [
          { transform: grip, offset: 0, easing: "ease-out" },
          {
            transform: transform(pullX, contactY - 24, fromRight ? -12 : 12, 0.96),
            offset: 0.75,
            easing: "ease-in",
          },
          { transform: transform(exitX, contactY + 100, fromRight ? -18 : 18), offset: 1 },
        ],
        { duration: 870, fill: "both" },
      );
      reach.cancel();
      void pull.finished.then(cancel, cancel);
    },
    () => {},
  );
  return { ready, cancel };
}
