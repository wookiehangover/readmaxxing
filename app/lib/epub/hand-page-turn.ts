export function showHandPageTurn(container: HTMLElement, direction: "next" | "previous") {
  const document = container.ownerDocument;
  const view = document.defaultView;
  if (!view || view.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const host = container.parentElement ?? container;
  const overlay = document.createElement("div");
  overlay.dataset.pageTurnHand = direction;
  overlay.setAttribute("aria-hidden", "true");
  overlay.style.cssText =
    "position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:6;contain:layout paint;";
  const hand = document.createElement("img");
  hand.src = "/images/page-turn-hand.webp";
  hand.alt = "";
  hand.draggable = false;
  hand.style.cssText =
    "position:absolute;height:min(110%,850px);width:auto;max-width:none;top:18%;left:0;transform-origin:50% 8%;filter:drop-shadow(0 14px 12px rgb(0 0 0 / .18));";
  const mirrored = direction === "next";
  const width = host.clientWidth;
  const handWidth = Math.min(host.clientHeight * 1.1, 850) * 0.462;
  const transform = (x: number, y: number, angle: number) =>
    `translate3d(${x}px,${y}%,0) rotate(${angle}deg) scaleX(${mirrored ? -1 : 1})`;
  overlay.append(hand);
  host.append(overlay);
  const animation = hand.animate(
    [
      {
        transform: transform(
          mirrored ? width + handWidth : -handWidth * 2,
          18,
          mirrored ? 35 : -35,
        ),
        offset: 0,
      },
      {
        transform: transform(
          (mirrored ? width * 0.85 : width * 0.15) - handWidth / 2,
          0,
          mirrored ? 24 : -24,
        ),
        offset: 0.18,
      },
      {
        transform: transform(
          (mirrored ? width * 0.2 : width * 0.8) - handWidth / 2,
          -4,
          mirrored ? -12 : 12,
        ),
        offset: 0.64,
      },
      {
        transform: transform(
          mirrored ? -handWidth * 2 : width + handWidth,
          60,
          mirrored ? -35 : 35,
        ),
        offset: 1,
      },
    ],
    { duration: 900, easing: "linear", fill: "both" },
  );
  const remove = () => {
    animation.cancel();
    overlay.remove();
  };
  void animation.finished.then(remove, () => overlay.remove());
  return remove;
}
