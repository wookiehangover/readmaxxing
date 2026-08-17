import { redirect } from "react-router";

export function clientLoader() {
  throw redirect("/library");
}

export default function MissingBookRedirectRoute() {
  return null;
}
