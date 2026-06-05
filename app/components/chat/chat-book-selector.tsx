import { Library, Check } from "lucide-react";
import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
} from "~/components/ui/dropdown-menu";
import { cn } from "~/lib/utils";
import type { BookSelection } from "./chat-panel";

/**
 * A dropdown checkbox row with a CIRCULAR indicator. We use the raw Base UI
 * `MenuPrimitive.CheckboxItem` here instead of the exported
 * `DropdownMenuCheckboxItem` because the latter renders a square check
 * indicator; the spec requires a round one for the book selector.
 */
function CircularCheckboxItem({
  checked,
  disabled,
  onCheckedChange,
  children,
}: {
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: () => void;
  children: React.ReactNode;
}) {
  return (
    <MenuPrimitive.CheckboxItem
      checked={checked}
      disabled={disabled}
      // Keep the menu open so the user can toggle several books in one go.
      closeOnClick={false}
      onCheckedChange={onCheckedChange}
      className={cn(
        "relative flex cursor-default items-center gap-2 rounded-md py-1 pr-2 pl-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-60",
      )}
    >
      <span
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded-full border border-input",
          {
            "border-primary bg-primary text-primary-foreground": checked,
          },
        )}
      >
        <MenuPrimitive.CheckboxItemIndicator>
          <Check className="size-3" />
        </MenuPrimitive.CheckboxItemIndicator>
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </MenuPrimitive.CheckboxItem>
  );
}

/**
 * Header dropdown for choosing which currently-open books are included in the
 * chat. Renders one circular checkbox row per open book. The chat's own book
 * (`ownBookId`) is locked-checked and cannot be toggled off. Returns null when
 * fewer than two books are open (including the standalone reader, which has no
 * open books) so it never appears when there is nothing to choose.
 */
export function ChatBookSelector({
  openBooks,
  selectedBookIds,
  ownBookId,
  onToggleBook,
}: BookSelection) {
  if (openBooks.length < 2) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" title="Select books" className="size-7" />}
      >
        <Library className="size-3.5" />
        <span className="sr-only">Select books</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Books in this chat</DropdownMenuLabel>
          {openBooks.map((book) => {
            const isOwn = book.id === ownBookId;
            const checked = isOwn || selectedBookIds.includes(book.id);
            return (
              <CircularCheckboxItem
                key={book.id}
                checked={checked}
                disabled={isOwn}
                onCheckedChange={() => onToggleBook(book.id)}
              >
                {book.title}
              </CircularCheckboxItem>
            );
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
