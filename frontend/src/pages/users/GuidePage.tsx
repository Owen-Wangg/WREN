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
        <p>
          Welcome to {appName}. This guide shows you how to create a document, get feedback,
          and revise your writing.
        </p>
        <p>
          Start by creating a new document and selecting its document type. This makes sure
          the feedback you get fits the kind of writing you are doing.
        </p>
        <p>Upload your draft or start writing directly in the editor.</p>
        <p>Once you have some content, two tools help you improve it:</p>
        <p>
          <strong>AI Debrief</strong> gives you a bird&apos;s-eye view of your writing. It
          shows what is working and what could be improved. Click any quote in the debrief to
          highlight that passage in your document.
        </p>
        <p>
          <strong>Ask {appName}</strong> to go deeper. You can ask about your draft, the AI
          Debrief, or parts of your writing such as clarity and organization. It coaches you
          by asking questions instead of rewriting your text, so you can think critically
          and make your own revisions.
        </p>
        <p>
          As you work, revise in the editor or upload a new draft. Each new version gets
          updated feedback, so you can track your improvement.
        </p>
      </GuideSection>

      <GuideSection title="Creating a new document draft">
        <p>
          To start a new document, click <strong>New Document</strong> in the menu at the
          top of the screen, next to <strong>All Documents</strong>.
        </p>
        <p>
          The department list shows the departments available to you. Some departments are
          visible to everyone; others appear only if you have been given permission.
          Documents you have already created are not affected and stay in All Documents.
        </p>
        <p>
          Seeing a department in the list does not always mean you can submit to it. Some
          document types are locked, which means you need to be given access before you can
          use them. To ask for access, click <strong>Request access</strong> next to the
          locked document type. If a department you expect is missing, contact your System
          Admin.
        </p>
        <ol className="list-decimal space-y-sm pl-xl">
          <li>Click <strong>New Document</strong>.</li>
          <li>Select your department — for example, Law.</li>
          <li>
            Choose your document type — for example, Legal Memorandum.
          </li>
          <li>Give your draft a name.</li>
          <li>
            Choose a file from your computer. For the best results, use a{' '}
            <strong>Word (.docx)</strong> file so fonts, colors, headings, lists, tables, and
            images carry over accurately. PDF files, including many scanned PDFs, also work,
            but their layout may not be kept exactly.
          </li>
          <li>
            Click <strong>Activate Editor</strong>. The editor opens with your draft loaded.
            Your draft also appears in your document list under{' '}
            <strong>All Documents</strong>.
          </li>
        </ol>
      </GuideSection>

      <GuideSection title="Opening and reviewing your document">
        <p>
          In <strong>All Documents</strong>, click the draft you want to work on. The editor
          opens, with your document on the right and a side panel on the left.
        </p>
        <p>
          On screen, your document is shown as one continuous page rather than separate
          pages. The header and footer areas are at the very top and bottom of the draft.
          The <strong>Contents</strong> panel shows the draft version, the word count, and
          about how many pages the document will be when printed on US Letter (8.5 × 11
          inch) paper. To build an outline, apply the Heading 1, Heading 2, or Heading 3
          style to your headings. Click a heading in the outline to jump to it.
        </p>
        <p>
          Hover over or drag the scrollbar on the right to see which printed page you are
          on, for example <strong>Page 2 of 17</strong>. This number estimates where page
          breaks will fall when you preview or export your document. The editor itself does
          not show page breaks.
        </p>
        <p>
          Use the icon bar on the far left to change what the side panel shows. Click{' '}
          <strong>Contents</strong> for your outline, <strong>{appName}</strong> for Ask{' '}
          {appName}, or <strong>AI Debrief</strong> for your feedback report.
        </p>
        <p>Other options in the editor:</p>
        <ul className="list-disc space-y-sm pl-xl">
          <li>
            <strong>Upload New Draft</strong> — use this if you edited your document in
            another program, such as Word, and want {appName} to review the updated version.
          </li>
          <li>
            <strong>Export</strong> — download your document as a Word (.docx) or PDF file.
            Open the Export menu and choose a format. If you choose PDF, you can also include
            your AI Debrief. Click <strong>Preview</strong> to see how the printed document
            will look, then export.
          </li>
          <li>
            <strong>Close</strong> — hide the side panel to give your document more room.
            You can also drag the divider between the panel and the document to resize the
            panel.
          </li>
        </ul>
      </GuideSection>

      <GuideSection title="Using AI Debrief">
        <p>
          Click <strong>AI Debrief</strong> in the icon bar on the left. The panel opens and
          shows your latest report.
        </p>
        <p>
          Click <strong>Regenerate</strong> to save your edits and create a new AI Debrief
          for the current version of your document.
        </p>
        <p>
          To see an earlier report, open the drop-down list and select the draft you want to
          review.
        </p>
        <p>
          Click a quoted passage in the report to highlight it in your document.
        </p>
      </GuideSection>

      <GuideSection title={`Using Ask ${appName}`}>
        <p>
          In the icon bar on the left, click <strong>{appName}</strong> to open the chat.
        </p>
        <p>
          Ask {appName} is your writing coach. It helps you strengthen your writing through
          guided reflection rather than direct editing. It asks questions that encourage you
          to think critically about your draft and make your own revisions.
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
          As you make changes, you can also track your progress and see how much work you
          have completed. Click a quoted phrase in a reply to jump to that passage in your
          draft.
        </p>

        <p className="font-semibold text-text-primary">
          How to get the most out of Ask {appName}
        </p>
        <p>
          Ask specific questions about your draft and the quality of your writing. The
          more focused the question, the more targeted the guidance will be. Ask{' '}
          {appName} is designed to coach, not edit. Instead of rewriting your text, it
          often responds with questions and prompts that help you find ways to improve on
          your own.
        </p>

        <p className="font-semibold text-text-primary">Sample questions</p>
        <p>Structure and flow:</p>
        <ul className="list-disc space-y-sm pl-xl">
          <li>
            &ldquo;Does my second section actually build on the first, or does it feel
            disconnected?&rdquo;
          </li>
          <li>&ldquo;I have three main points. Does the order make sense?&rdquo;</li>
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
            &ldquo;Something feels off about my introduction, but I can&apos;t tell
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
          Ask {appName} will not rewrite your text for you. Instead, it asks questions and
          offers observations so you can revise in your own words. Specifically, it will
          not:
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
            &ldquo;Just tell me what to fix&rdquo; — it keeps coaching you instead of
            listing fixes, even when asked directly.
          </li>
        </ul>
      </GuideSection>
    </div>
  );
}
