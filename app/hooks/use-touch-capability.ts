import * as React from "react";

const TOUCH_POINTER_QUERY = "(any-pointer: coarse)";

function hasTouchCapability() {
  return navigator.maxTouchPoints > 0 || window.matchMedia(TOUCH_POINTER_QUERY).matches;
}

export function useHasTouchCapability() {
  const [hasTouch, setHasTouch] = React.useState(false);

  React.useEffect(() => {
    const mediaQuery = window.matchMedia(TOUCH_POINTER_QUERY);
    const update = () => setHasTouch(hasTouchCapability());
    mediaQuery.addEventListener("change", update);
    update();
    return () => mediaQuery.removeEventListener("change", update);
  }, []);

  return hasTouch;
}
