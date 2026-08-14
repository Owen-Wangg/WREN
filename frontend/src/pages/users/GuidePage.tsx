import { appConfig } from '@/config/env';

function GuideSection({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-border-subtle bg-surface-primary p-2xl">
      <h2 className="mb-md text-heading3 font-sans font-semibold text-text-primary">
        {title}
      </h2>
      <div className="flex flex-col gap-md text-body text-text-secondary">{children}</div>
    </section>
  );
}

export function GuidePage() {
  const appName = appConfig.appName;

  return (
    <div className="flex flex-col gap-xl pb-2xl">
      <h1 className="text-title-page font-sans font-bold text-text-primary">Guide</h1>

      <GuideSection title="Getting started">
        <p>Welcome to {appName}. Here is how to use it.</p>
        <p>
          Set up your document by creating a new one and selecting your document type. This
          ensures feedback is tailored to your writing context.
        </p>
        <p>Upload your draft or start writing directly in the editor.</p>
        <p>Once you have content, two tools will help you improve:</p>
        <p>
          <strong>AI Debrief</strong> gives you a bird&apos;s-eye view of your writing. See
          what&apos;s working, what could improve, and click any quote to highlight it in your
          document.
        </p>
        <p>
          <strong>Ask {appName}</strong> to go deeper. Ask questions and get guidance that
          helps you think critically about your draft.
        </p>
        <p>
          Revise in the editor or upload a new draft as you work. Each version gives you
          updated feedback so you can track your improvement.
        </p>
      </GuideSection>

      <GuideSection title="Creating a new document draft">
        <p>
          From the Student Dashboard, find <strong>New Document</strong> in the top-right
          corner of the screen (next to <strong>All Documents</strong>, which is the page you
          are currently on).
        </p>
        <ol className="list-decimal space-y-sm pl-xl">
          <li>Click <strong>New Document</strong>.</li>
          <li>Select your department — for example, Law.</li>
          <li>
            Choose your document type — for example, Legal Memorandum.
          </li>
          <li>Give your draft a name.</li>
          <li>
            Choose a file from your computer. Prefer a <strong>.docx</strong> Word file so
            fonts, colors, headings, lists, tables, and images come through more accurately.
            PDF is supported for convenience, including many scanned files, but layout is
            best-effort.
          </li>
          <li>
            Click <strong>Activate Editor</strong>. You will open in the editor with your
            draft loaded. The same draft also appears under <strong>All Documents</strong> /
            My Documents.
          </li>
        </ol>
      </GuideSection>

      <GuideSection title="Opening and reviewing your document">
        <p>
          From My Documents, click the draft you want to open. This brings up the editor: a
          single continuous document on the right, with a side panel on the left.
        </p>
        <p>
          The document is not split into pages on screen. Header and footer regions sit at
          the top and bottom of the draft. The Contents panel shows the draft version, word
          count, and an estimated printed page count (US Letter). Add Heading 1–3 styles to
          build an outline; click a heading to jump to it.
        </p>
        <p>
          Hover or drag the scrollbar on the right to see which printed page you are on —
          for example, <strong>Page 2 of 17</strong>. That number is an estimate of how the
          document will paginate when you preview or export, not a live page break in the
          editor.
        </p>
        <p>
          On the left, the icon rail opens more information about two tools:{' '}
          <strong>AI Debrief</strong> and <strong>Ask {appName}</strong>. Click{' '}
          <strong>Contents</strong>, <strong>{appName}</strong>, or <strong>AI Debrief</strong>{' '}
          to switch the panel.
        </p>
        <p>Other options in this view:</p>
        <ul className="list-disc space-y-sm pl-xl">
          <li>
            <strong>Upload New Draft</strong> — use this if you edited the document in
            another program and need {appName} to review the updated version.
          </li>
          <li>
            <strong>Export</strong> — download your document as DOCX or PDF after you have
            made changes. Open the menu to choose a format, optionally include the AI
            Debrief (PDF only), <strong>Preview</strong> a US Letter print preview, then
            export.
          </li>
          <li>
            <strong>Close</strong> — collapse the side panel if you want more screen space.
            Drag the divider between the panel and the document to resize it.
          </li>
        </ul>
      </GuideSection>

      <GuideSection title="Using AI Debrief">
        <p>
          Click <strong>AI Debrief</strong> on the left rail. The panel opens with your
          latest report.
        </p>
        <p>
          Click <strong>Regenerate</strong> to save any inline edits and generate a new AI
          Debrief on your document.
        </p>
        <p>
          To view a previously generated report, use the drop-down and select an earlier
          draft&apos;s report from the list.
        </p>
        <p>
          Click a quoted passage in the debrief to highlight it in the document.
        </p>
      </GuideSection>

      <GuideSection title={`Using Ask ${appName}`}>
        <p>
          On the left rail, click <strong>{appName}</strong> to switch from AI Debrief (or
          Contents) into chat.
        </p>
        <p>Here you can talk directly with {appName} to:</p>
        <ul className="list-disc space-y-sm pl-xl">
          <li>Ask detailed questions about your document</li>
          <li>
            Track your progress and see how much work has been completed as you make
            changes
          </li>
        </ul>
        <p>
          Click a quoted phrase in a reply to jump to that passage in the draft.{' '}
          {appName} will not rewrite your text for you — it asks questions and offers
          observations so you can revise in your own words.
        </p>
      </GuideSection>
    </div>
  );
}
