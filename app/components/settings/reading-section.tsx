import { PdfDefaultsControls } from "~/components/settings/pdf-defaults-section";
import { ReaderDefaultsControls } from "~/components/settings/reader-defaults-section";

export function ReadingSection() {
  return (
    <section className="flex flex-col gap-6">
      <div>
        <h3 className="mb-3 text-sm font-medium">Reader</h3>
        <ReaderDefaultsControls />
      </div>
      <div>
        <h3 className="mb-3 text-sm font-medium">PDF</h3>
        <PdfDefaultsControls />
      </div>
    </section>
  );
}
