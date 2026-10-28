import { createContext, useContext, useState, type ReactNode } from "react";

const PageTurnExperimentContext = createContext<{
  animation: "slide" | "hand";
  setAnimation: (animation: "slide" | "hand") => void;
} | null>(null);

export function PageTurnExperiment({ children }: { children: ReactNode }) {
  const [animation, setAnimation] = useState<"slide" | "hand">("slide");
  return (
    <PageTurnExperimentContext value={{ animation, setAnimation }}>
      {animation === "hand" && (
        <link rel="preload" as="image" href="/images/page-turn-palm-down.webp" />
      )}
      {children}
    </PageTurnExperimentContext>
  );
}

export function usePageTurnExperiment() {
  return useContext(PageTurnExperimentContext);
}
