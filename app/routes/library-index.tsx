import { BookOpen } from "lucide-react";

export default function LibraryIndex() {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <BookOpen className="mb-4 size-12 text-muted-foreground/50" />
      <p className="text-lg font-medium text-muted-foreground">Select a book from the sidebar</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Or drop an .epub file anywhere to get started
      </p>
    </div>
  );
}
