import { PdfDefaultsControls } from "~/components/settings/pdf-defaults-section";
import { ReaderDefaultsControls } from "~/components/settings/reader-defaults-section";

export function ReadingSection() {
  return (
    <section className="flex flex-col gap-10">
      <div>
        <h3 className="mb-4 text-sm font-medium text-muted-foreground">EPUB</h3>
        <ReaderDefaultsControls />
      </div>
      <div>
        <h3 className="mb-4 text-sm font-medium text-muted-foreground">PDF</h3>
        <PdfDefaultsControls />
      </div>
    </section>
  );
}
