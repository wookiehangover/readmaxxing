import type { Route } from "./+types/home";
import { Button } from "~/components/ui/button";
import { Welcome } from "../welcome/welcome";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "New React Router App" },
    { name: "description", content: "Welcome to React Router!" },
  ];
}

export default function Home() {
  return (
    <div>
      <Welcome />
      <div className="flex justify-center p-4">
        <Button>Click me</Button>
      </div>
    </div>
  );
}
