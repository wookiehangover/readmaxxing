import { Wrench } from "lucide-react";
import { DropdownMenuItem } from "~/components/ui/dropdown-menu";
import { useReadingRail } from "~/components/reading-shell/reading-rail-context";
import { useAppStore } from "~/lib/themis/provider";
import { startRepair } from "~/lib/themis/repairs/repairs-slice";

export function RepairMenuItem({ bookId }: { bookId: string }) {
  const store = useAppStore();
  const { setActiveTab } = useReadingRail();
  return (
    <DropdownMenuItem
      onClick={() => {
        store.dispatch(startRepair(bookId));
        setActiveTab("Repair");
      }}
    >
      <Wrench data-icon="inline-start" />
      Fix this book
    </DropdownMenuItem>
  );
}
