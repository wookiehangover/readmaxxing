import { Library, Check } from "lucide-react";
import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import {
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "~/components/ui/dropdown-menu";
import type { ChatBookSelection } from "~/lib/context/reading-chat-menu-context";
import { cn } from "~/lib/utils";

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

export function ChatBookSelectorMenu({
  openBooks,
  selectedBookIds,
  ownBookId,
  onToggleBook,
}: ChatBookSelection) {
  if (openBooks.length < 2) return null;

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Library />
        Books in this chat
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="min-w-52">
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
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
