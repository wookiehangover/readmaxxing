let swRegistration: ServiceWorkerRegistration | undefined;

export function setSWRegistration(registration: ServiceWorkerRegistration | undefined) {
  swRegistration = registration;
}

export async function triggerUpdateCheck(): Promise<{ checked: boolean; updateFound: boolean }> {
  if (!swRegistration) {
    return { checked: false, updateFound: false };
  }

  const registration = swRegistration;
  const installingBefore = registration.installing;
  let updateFound = false;

  function handleUpdateFound() {
    updateFound = true;
  }

  registration.addEventListener("updatefound", handleUpdateFound);

  try {
    await registration.update();
  } finally {
    registration.removeEventListener("updatefound", handleUpdateFound);
  }

  updateFound ||= registration.installing !== null && registration.installing !== installingBefore;
  updateFound ||= registration.waiting !== null;

  return { checked: true, updateFound };
}
