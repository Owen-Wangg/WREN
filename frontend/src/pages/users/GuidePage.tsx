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
          <strong>Ask {appName}</strong> to go deeper. Ask questions about your draft, the
          AI Debrief, or aspects of your writing such as clarity and organization. It
          coaches with questions rather than rewriting your text, so you can think
          critically and develop your own revisions.
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
        <p>
          Ask {appName} supports the writing coach by helping you strengthen your writing
          through guided reflection rather than direct editing. It asks questions that
          encourage you to think critically about your draft and develop your own
          revisions.
        </p>
        <p>You can ask questions about:</p>
        <ul className="list-disc space-y-sm pl-xl">
          <li>Feedback provided in the AI Debrief</li>
          <li>Content from your uploaded draft</li>
          <li>
            Specific aspects of writing, such as clarity, organization, persuasiveness,
            tone, coherence, spelling, grammar, and consistency
          </li>
        </ul>
        <p>
          You can also track your progress and see how much work has been completed as
          you make changes. Click a quoted phrase in a reply to jump to that passage in
          the draft.
        </p>

        <p className="font-semibold text-text-primary">
          How to get the most out of Ask {appName}
        </p>
        <p>
          Ask specific questions about your draft and the quality of your writing. The
          more focused the question, the more targeted the guidance will be. Ask{' '}
          {appName} is designed to coach rather than edit. Instead of providing rewrites,
          it will often respond with questions and prompts that help you identify
          opportunities for improvement on your own.
        </p>

        <p className="font-semibold text-text-primary">Sample questions</p>
        <p>Structure and flow:</p>
        <ul className="list-disc space-y-sm pl-xl">
          <li>
            &ldquo;Does my second section actually build on the first, or does it feel
            disconnected?&rdquo;
          </li>
          <li>&ldquo;I have three main points, does the order make sense?&rdquo;</li>
          <li>&ldquo;My conclusion feels weak. What am I missing?&rdquo;</li>
          <li>
            &ldquo;Does the argument in my conclusion follow logically from the
            body?&rdquo;
          </li>
          <li>&ldquo;How could I improve the organization of this section?&rdquo;</li>
        </ul>
        <p>Clarity and argument strength:</p>
        <ul className="list-disc space-y-sm pl-xl">
          <li>&ldquo;Is my thesis clear from the first paragraph?&rdquo;</li>
          <li>
            &ldquo;I&apos;m not sure my second paragraph supports my thesis — can you
            help me think through it?&rdquo;
          </li>
          <li>
            &ldquo;I&apos;m worried this paragraph is repeating what I already said
            earlier — can you help me see if it is?&rdquo;
          </li>
          <li>
            &ldquo;Does the evidence in this section actually support the claim I&apos;m
            making?&rdquo;
          </li>
          <li>
            &ldquo;Which part of my argument is likely to be least convincing to a
            reader?&rdquo;
          </li>
        </ul>
        <p>When you are not sure what is wrong:</p>
        <ul className="list-disc space-y-sm pl-xl">
          <li>
            &ldquo;Something feels off about my introduction but I can&apos;t tell
            what.&rdquo;
          </li>
          <li>
            &ldquo;I feel like something is missing from this section, but I can&apos;t
            tell what. What questions should I ask myself?&rdquo;
          </li>
          <li>
            &ldquo;Can you push back on my argument in the third paragraph?&rdquo;
          </li>
          <li>
            &ldquo;What would a skeptical reader say about this section?&rdquo;
          </li>
        </ul>

        <p className="font-semibold text-text-primary">
          What Ask {appName} will not do
        </p>
        <p>
          {appName} will not rewrite your text for you — it asks questions and offers
          observations so you can revise in your own words. Specifically, it will not:
        </p>
        <ul className="list-disc space-y-sm pl-xl">
          <li>
            Write or rewrite sentences, paragraphs, or sections of your draft
          </li>
          <li>Verify whether legal, factual, or technical claims are accurate</li>
          <li>
            Answer questions that are unrelated to the content you uploaded or the
            feedback you received
          </li>
        </ul>
        <p>If you ask anyway, it stays in that coaching role. For example:</p>
        <ul className="list-disc space-y-sm pl-xl">
          <li>
            &ldquo;Can you rewrite this sentence for me?&rdquo; — it declines and
            redirects you with a question instead of a rewrite.
          </li>
          <li>
            &ldquo;Is this claim accurate?&rdquo; — it stays focused on writing
            craft, not fact-checking.
          </li>
          <li>
            &ldquo;Just tell me what to fix&rdquo; — it holds that line even when asked
            directly.
          </li>
        </ul>
      </GuideSection>
    </div>
  );
}
