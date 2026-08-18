import {
  createContext,
  useContext,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

export type ReadingRailTab = "Notes" | "Discuss" | "Outline";

interface ReadingRailTabContextValue {
  activeTab: ReadingRailTab;
  setActiveTab: Dispatch<SetStateAction<ReadingRailTab>>;
}

const ReadingRailTabContext = createContext<ReadingRailTabContextValue | null>(null);

export function ReadingRailTabProvider({ children }: { children: ReactNode }) {
  const [activeTab, setActiveTab] = useState<ReadingRailTab>("Notes");

  return (
    <ReadingRailTabContext.Provider value={{ activeTab, setActiveTab }}>
      {children}
    </ReadingRailTabContext.Provider>
  );
}

export function useReadingRailTab() {
  const context = useContext(ReadingRailTabContext);
  if (!context) throw new Error("useReadingRailTab must be used within ReadingRailTabProvider");
  return context;
}
