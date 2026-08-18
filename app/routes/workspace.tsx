import { redirect } from "react-router";

export function clientLoader() {
  throw redirect("/library");
}

export default function WorkspaceRedirectRoute() {
  return null;
}
