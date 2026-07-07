import { PdfDefaultsControls } from "~/components/settings/pdf-defaults-section";
import { ReaderDefaultsControls } from "~/components/settings/reader-defaults-section";

export function ReadingSection() {
  return (
    <section className="flex flex-col gap-10">
      <div>
        <h3 className="mb-6 text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Reader
        </h3>
        <ReaderDefaultsControls />
      </div>
      <div>
        <h3 className="mb-6 text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          PDF
        </h3>
        <PdfDefaultsControls />
      </div>
    </section>
  );
}
