import { Link } from "react-router";
import { ArrowLeft, ArrowRight } from "lucide-react";

export default function AboutPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex h-12 max-w-2xl items-center gap-3 px-4">
          <Link
            to="/"
            aria-label="Back"
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <span className="font-semibold">About</span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl space-y-8 px-4 py-8">
        <section className="font-[Geist_Mono] space-y-[1rlh] [&>p,&>ul]:text-xs [&>p,&>ul]:leading-relaxed [&>p,&>ul]:text-foreground/80">
          <h1>
            <span className="text-muted-foreground">#</span> Readmaxxing
          </h1>

          <p>
            This is for the power-readers. The ebook hoarders. The sickos who have read all of The
            Power Broker and The Years of Lyndon Johnson and still come back for more. For people
            doing research. Library card holders who pay attention to DRM policies. Students who
            need to move a little too fast. Late night Kindle warriors who have more than 2
            dedicated reading devices in arms reach. The 200 books-a-year former librarians.
          </p>

          <p>The real readers. If there are any still left.</p>

          <p>
            If you've ever yearned to have 4 ebooks open at the same time, along with notes for all
            of them, you have come to the right place.
          </p>

          <h2 className="text-xs">
            <span className="text-muted-foreground">##</span> Thesis
          </h2>

          <p>
            The best thing about physical books when you are researching is being able to juggle
            multiple volumes at once. To really do syntopical reading you have to engage with not
            just some of the material in a domain, but with all of it. Only through an exhaustive
            survey of a subject's literary canon can you synthesize new work with the confidence
            that it is a true original.
          </p>

          <p>Doing that with ebooks is far too tedious.</p>

          <p>What this app does:</p>
          <ul className="list-disc space-y-[0.5lh] list-inside">
            <li>High-quality ebook and PDF reader</li>
            <li>Multiple tabs and split panes</li>
            <li>AI reading and research companion</li>
            <li>Highlights and notes</li>
            <li>Secure sync between unlimited devices</li>
          </ul>

          <h3 className="text-xs">
            <span className="text-muted-foreground">###</span> AI Assistance
          </h3>

          <p>
            If you're not using an AI assistant to enhance your reading, you are missing out. Any
            off-the-shelf frontier model will do a decent job responding to most inquiries on all
            but the most recently published works.
          </p>

          <p>
            But if you are truly AI-pilled, you know that with the right prompting, tools, and
            context management you can extend the capabilities of the best frontier models by quite
            a bit. We've applied learnings from years of building AI apps and put them in an
            ereader. Smart context retrieval with BM25 and semantic search? Check. Full
            understanding of what you're currently reading? Check. Suggested follow up questions?
            Check. Ability to make highlights, read & and edit your notes? Check.
          </p>

          <h3 className="text-xs">
            <span className="text-muted-foreground">###</span> Better Note Taking
          </h3>

          <p>If you're not writing, you're not reading.</p>

          <p>
            If you have ever felt constrained by the notetaking features in the kindle app, you have
            come to the right place. A digital notebook is a living document. It benefits from
            formatting, hierarchy, and links to the texts it references. And increasingly, notes may
            be co-authored by an AI agent working on your behalf.
          </p>

          <h3 className="text-xs">
            <span className="text-muted-foreground">###</span> Passkeys & Sync
          </h3>

          <p>
            No passwords. Log in with a passkey &mdash; the same cryptographic credential your phone
            uses for Face ID or Touch ID. There is nothing to remember, nothing to leak, and nothing
            to phish. We store your passkey ID and nothing else about you.
          </p>

          <p>
            The app is local-first. Your books live on your device, and the server is just a conduit
            between them. Sign in on another laptop, phone, or tablet and your library, highlights,
            notes, and reading positions are waiting for you. If you stay logged out, nothing ever
            leaves the device.
          </p>
        </section>

        <div className="flex justify-center pt-4">
          <Link
            to="/"
            className="font-[Geist_Mono] inline-flex items-center gap-2 rounded-md bg-foreground px-4 py-2 text-xs font-medium text-background transition-colors hover:bg-foreground/90"
          >
            Start reading <ArrowRight className="size-3" />
          </Link>
        </div>
      </main>
    </div>
  );
}
