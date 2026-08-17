import { Fragment, useState } from "react";
import {
  Bookmark,
  BookmarkCheck,
  Download,
  FastForward,
  Library,
  MoreHorizontal,
  Minus,
  Plus,
  SettingsIcon,
  Share2,
  TableOfContents,
  Type,
  ClipboardCopyIcon,
  FileText,
} from "lucide-react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { ShareDialog } from "~/components/share-dialog";
import { TocList } from "~/components/book-list";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { useAuth } from "~/lib/context/auth-context";
import type { TocEntry } from "~/lib/context/reader-context";
import type { BookMeta } from "~/lib/stores/book-store";
import type { ReaderLayout, PdfLayout, Settings, TextAlign } from "~/lib/settings";
import { exportNotebookMarkdown } from "~/lib/editor/export-notebook-markdown";
import { Button } from "./ui/button";

interface ReaderFormattingMenuProps {
  settings: Settings;
  onUpdateSettings: (update: Partial<Settings>) => void;
  isPdf?: boolean;
}

interface ReaderActionsMenuProps {
  book?: BookMeta;
  onDownload: () => void | Promise<void>;
  onBookmarkPage: () => void | Promise<void>;
  onCopyPageAsMarkdown?: () => void;
  onOpenSpeedread?: () => void;
  isBookmarked?: boolean;
}

interface ReaderSettingsMenuProps extends ReaderFormattingMenuProps, ReaderActionsMenuProps {
  toc?: TocEntry[];
  onNavigateToToc?: (href: string) => void;
}

const layoutOptions: { value: ReaderLayout; label: string }[] = [
  { value: "single", label: "Single Page" },
  { value: "spread", label: "Two Page Spread" },
  { value: "scroll", label: "Continuous Scroll" },
];

const pdfLayoutOptions: { value: PdfLayout; label: string }[] = [
  { value: "original", label: "Original Size" },
  { value: "fit-height", label: "Fit to Height" },
  { value: "fit-width", label: "Fit to Width" },
  { value: "two-page", label: "Two Page" },
  { value: "continuous", label: "Continuous" },
];

const fontSections = [
  {
    label: "Serif",
    options: [
      { value: "Literata", label: "Literata" },
      { value: "Merriweather", label: "Merriweather" },
      { value: "Lora", label: "Lora" },
      { value: "Source Serif 4", label: "Source Serif 4" },
    ],
  },
  {
    label: "Sans-serif",
    options: [
      { value: "Geist", label: "Geist" },
      { value: "Inter", label: "Inter" },
    ],
  },
  {
    label: "Monospace",
    options: [
      { value: "Geist Mono", label: "Geist Mono" },
      { value: "Berkeley Mono", label: "Berkeley Mono" },
    ],
  },
] as const;

const textAlignOptions: { value: string; label: string; actualValue: TextAlign }[] = [
  { value: "default", label: "Default", actualValue: undefined },
  { value: "left", label: "Left", actualValue: "left" },
  { value: "center", label: "Center", actualValue: "center" },
  { value: "right", label: "Right", actualValue: "right" },
  { value: "justify", label: "Justify", actualValue: "justify" },
];

function ReaderFormattingMenuItems({
  settings,
  onUpdateSettings,
  isPdf,
}: ReaderFormattingMenuProps) {
  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuLabel>Layout</DropdownMenuLabel>
        {isPdf ? (
          <DropdownMenuRadioGroup
            value={settings.pdfLayout}
            onValueChange={(value) => onUpdateSettings({ pdfLayout: value as PdfLayout })}
          >
            {pdfLayoutOptions.map((option) => (
              <DropdownMenuRadioItem key={option.value} value={option.value}>
                {option.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        ) : (
          <DropdownMenuRadioGroup
            value={settings.readerLayout}
            onValueChange={(value) => onUpdateSettings({ readerLayout: value as ReaderLayout })}
          >
            {layoutOptions.map((option) => (
              <DropdownMenuRadioItem key={option.value} value={option.value}>
                {option.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        )}
      </DropdownMenuGroup>

      {!isPdf && <DropdownMenuSeparator />}

      {!isPdf && (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Font: {settings.fontFamily}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {fontSections.map((section, index) => (
              <Fragment key={section.label}>
                {index > 0 && <DropdownMenuSeparator />}
                <DropdownMenuGroup>
                  <DropdownMenuLabel>{section.label}</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={settings.fontFamily}
                    onValueChange={(value) => onUpdateSettings({ fontFamily: value as string })}
                  >
                    {section.options.map((option) => (
                      <DropdownMenuRadioItem key={option.value} value={option.value}>
                        {option.label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuGroup>
              </Fragment>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      )}

      {!isPdf && <DropdownMenuSeparator />}

      {!isPdf && (
        <DropdownMenuGroup>
          <DropdownMenuLabel>Size &amp; Spacing</DropdownMenuLabel>
          <DropdownMenuItem closeOnClick={false} className="flex items-center justify-between">
            <span className="text-sm">Size</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() =>
                  onUpdateSettings({
                    fontSize: Math.max(75, settings.fontSize - 5),
                  })
                }
                className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-accent"
                aria-label="Decrease font size"
              >
                <Minus className="size-3" />
              </button>
              <span className="w-10 text-center text-sm tabular-nums">{settings.fontSize}%</span>
              <button
                onClick={() =>
                  onUpdateSettings({
                    fontSize: Math.min(200, settings.fontSize + 5),
                  })
                }
                className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-accent"
                aria-label="Increase font size"
              >
                <Plus className="size-3" />
              </button>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem closeOnClick={false} className="flex items-center justify-between">
            <span className="text-sm">Spacing</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() =>
                  onUpdateSettings({
                    lineHeight: Math.max(1.0, Math.round((settings.lineHeight - 0.1) * 10) / 10),
                  })
                }
                className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-accent"
                aria-label="Decrease line height"
              >
                <Minus className="size-3" />
              </button>
              <span className="w-10 text-center text-sm tabular-nums">
                {settings.lineHeight.toFixed(1)}
              </span>
              <button
                onClick={() =>
                  onUpdateSettings({
                    lineHeight: Math.min(2.5, Math.round((settings.lineHeight + 0.1) * 10) / 10),
                  })
                }
                className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-accent"
                aria-label="Increase line height"
              >
                <Plus className="size-3" />
              </button>
            </div>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      )}

      {!isPdf && (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            Align:{" "}
            {textAlignOptions.find((opt) => opt.actualValue === settings.textAlign)?.label ||
              "Default"}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              value={settings.textAlign ?? "default"}
              onValueChange={(value) =>
                onUpdateSettings({
                  textAlign: value === "default" ? undefined : (value as TextAlign),
                })
              }
            >
              {textAlignOptions.map((option) => (
                <DropdownMenuRadioItem key={option.value} value={option.value}>
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      )}
    </>
  );
}

export function ReaderFormattingMenu(props: ReaderFormattingMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" title="Reader formatting" />}
      >
        <Type className="size-4" />
        <span className="sr-only">Reader formatting</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52 text-xs">
        <ReaderFormattingMenuItems {...props} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ReaderActionItems({
  book,
  onDownload,
  onBookmarkPage,
  onCopyPageAsMarkdown,
  onOpenSpeedread,
  isBookmarked,
  isAuthenticated,
  onShare,
}: ReaderActionsMenuProps & { isAuthenticated: boolean; onShare: () => void }) {
  const BookmarkIcon = isBookmarked ? BookmarkCheck : Bookmark;

  return (
    <DropdownMenuGroup>
      {onOpenSpeedread && (
        <DropdownMenuItem onClick={onOpenSpeedread}>
          <FastForward className="size-4" />
          Speedread
        </DropdownMenuItem>
      )}
      {onCopyPageAsMarkdown && (
        <DropdownMenuItem onClick={onCopyPageAsMarkdown}>
          <ClipboardCopyIcon className="size-4" />
          Copy chapter
        </DropdownMenuItem>
      )}
      {isAuthenticated && book && (
        <DropdownMenuItem onClick={onShare}>
          <Share2 className="size-4" />
          Share
        </DropdownMenuItem>
      )}
      <DropdownMenuItem
        onClick={() => {
          void Promise.resolve(onDownload()).catch(console.error);
        }}
      >
        <Download className="size-4" />
        Download
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={() => {
          void Promise.resolve(onBookmarkPage()).catch(console.error);
        }}
      >
        <BookmarkIcon className="size-4" />
        {isBookmarked ? "Remove bookmark" : "Bookmark page"}
      </DropdownMenuItem>
    </DropdownMenuGroup>
  );
}

function useReaderActionState(book?: BookMeta) {
  const { isAuthenticated } = useAuth();
  const [shareOpen, setShareOpen] = useState(false);

  function handleShare() {
    if (!book?.remoteFileUrl) {
      toast.warning("Sign in and sync this book before sharing it.");
      return;
    }
    setShareOpen(true);
  }

  return { isAuthenticated, shareOpen, setShareOpen, handleShare };
}

export function ReaderActionsMenu(props: ReaderActionsMenuProps) {
  const { isAuthenticated, shareOpen, setShareOpen, handleShare } = useReaderActionState(
    props.book,
  );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon" title="Reader actions" />}>
          <MoreHorizontal className="size-4" />
          <span className="sr-only">Reader actions</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52 text-xs">
          <ReaderActionItems {...props} isAuthenticated={isAuthenticated} onShare={handleShare} />
        </DropdownMenuContent>
      </DropdownMenu>
      <ShareDialog book={props.book ?? null} open={shareOpen} onOpenChange={setShareOpen} />
    </>
  );
}

export function ReaderSettingsMenu(props: ReaderSettingsMenuProps) {
  const navigate = useNavigate();
  const book = props.book;
  const { isAuthenticated, shareOpen, setShareOpen, handleShare } = useReaderActionState(book);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon" title="Reader menu" />}>
          <MoreHorizontal className="size-4" />
          <span className="sr-only">Reader menu</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52 text-xs">
          <DropdownMenuGroup>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Formatting</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-52 text-xs">
                <ReaderFormattingMenuItems {...props} />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Actions</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-52 text-xs">
                <ReaderActionItems
                  {...props}
                  isAuthenticated={isAuthenticated}
                  onShare={handleShare}
                />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            {props.toc && props.toc.length > 0 && props.onNavigateToToc ? (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <TableOfContents className="size-4" />
                  Table of Contents
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="max-h-80 w-64 overflow-y-auto p-1.5">
                  <ul>
                    <TocList entries={props.toc} onNavigate={props.onNavigateToToc} />
                  </ul>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ) : null}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => navigate("/library")}>
              <Library className="size-4" />
              Library
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate("/settings")}>
              <SettingsIcon className="size-4" />
              Settings
            </DropdownMenuItem>
          </DropdownMenuGroup>
          {book ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => navigate(`/books/${book.id}/details`)}>
                  <FileText className="size-4" />
                  Details
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    void exportNotebookMarkdown(book.id, book.title).catch(console.error);
                  }}
                >
                  <Download className="size-4" />
                  Export as Markdown
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <ShareDialog book={book ?? null} open={shareOpen} onOpenChange={setShareOpen} />
    </>
  );
}
