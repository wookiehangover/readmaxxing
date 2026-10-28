export function showHandPageTurn(container: HTMLElement, direction: "next" | "previous") {
  const document = container.ownerDocument;
  const view = document.defaultView;
  if (!view || view.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const host = container.parentElement ?? container;
  const bounds = host.getBoundingClientRect();
  const page = (container.querySelector("iframe") ?? container).getBoundingClientRect();
  const fromRight = direction === "previous";
  const viewportWidth = view.innerWidth;
  const width = Math.min(820, Math.max(380, bounds.width * 0.8));
  const height = width / 2.329;
  const reachDistance = Math.max(0, fromRight ? viewportWidth - page.left - 12 : page.right - 12);
  const pullDistance = Math.max(0, reachDistance - page.width * 0.8);
  const contactY = Math.max(bounds.top, bounds.top + bounds.height * 0.55 - height * 0.38);
  const position = (distance: number, lift: number, grip = 1) => ({
    width: `${distance}px`,
    transform: `translate3d(0,${lift}px,0) scaleY(${grip})`,
  });
  const overlay = document.createElement("div");
  overlay.dataset.pageTurnHand = direction;
  overlay.dataset.pageTurnPhase = "reach";
  overlay.setAttribute("aria-hidden", "true");
  overlay.style.cssText =
    "position:fixed;inset:0;overflow:hidden;pointer-events:none;z-index:40;contain:layout paint;";
  const orientation = document.createElement("div");
  orientation.style.cssText = `position:absolute;inset:0;transform:scaleX(${fromRight ? -1 : 1});`;
  const arm = document.createElement("div");
  arm.dataset.pageTurnArm = "";
  arm.style.cssText = `position:absolute;left:0;top:${contactY}px;width:0;height:${height}px;filter:drop-shadow(0 10px 10px rgb(0 0 0 / .18));`;
  const sleeve = document.createElement("div");
  sleeve.style.cssText = `position:absolute;left:0;top:0;width:max(0px,calc(100% - ${width}px + 1px));height:${height}px;background-image:url('/images/page-turn-sleeve.webp');background-size:auto 100%;background-position:right top;background-repeat:repeat-x;`;
  const hand = document.createElement("img");
  hand.dataset.pageTurnHandImage = "";
  hand.src = "/images/page-turn-sleeved-hand.webp";
  hand.alt = "";
  hand.draggable = false;
  hand.style.cssText = `position:absolute;top:0;right:0;width:${width}px;height:${height}px;max-width:none;`;
  arm.append(sleeve, hand);
  orientation.append(arm);
  overlay.append(orientation);
  document.body.append(overlay);
  const contact = position(reachDistance, 0);
  const grip = position(reachDistance + 6, 6, 0.98);
  const reach = arm.animate(
    [
      {
        ...position(0, 20),
        offset: 0,
        easing: "ease-out",
      },
      { ...contact, offset: 0.72, easing: "ease-in-out" },
      { ...grip, offset: 1 },
    ],
    { duration: 480, fill: "both" },
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
      pull = arm.animate(
        [
          { ...grip, offset: 0, easing: "ease-out" },
          {
            ...position(pullDistance, -12),
            offset: 0.75,
            easing: "ease-in",
          },
          { ...position(0, 60), offset: 1 },
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
