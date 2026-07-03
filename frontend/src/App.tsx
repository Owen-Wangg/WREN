/**
 * Application shell.
 *
 * NOTE (temporary dev scaffold): this file currently mounts each Track B
 * feature component on its own route so the work built ahead of convergence can
 * be explored in the browser against the mock API. This is NOT the final,
 * role-aware page composition — that is Wave B3 (`19.x` role consoles + writer
 * dashboard) and the convergence tasks. Treat the routes below as a preview
 * harness, not the production information architecture.
 */
import { useEffect, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';

import { appConfig } from '@/config/env';

import { LoginForm, SignupForm } from '@/features/auth';
import { AnchoredFeedbackEditorContainer } from '@/features/editor';
import { AiDebriefModal } from '@/features/debrief';
import { NewDocumentForm } from '@/features/documents';
import { WrenChatPanel, MockAskWrenService } from '@/features/ask-wren';
import { AiDisclaimerNotice } from '@/components/ui';

import type { JSONContent } from '@tiptap/react';
import type { WritingType } from '@wren/types';

/* -------------------------------------------------------------------------- */
/* Fixtures for the preview harness (mirror src/services/mockApi.ts).          */
/* -------------------------------------------------------------------------- */

const previewWritingTypes: readonly WritingType[] = [
  {
    id: 'wt-legal-memo',
    organizationId: 'org-allard-law',
    name: 'Legal Memo',
    accessState: 'OPEN',
    sizeLimitWords: null,
  },
];

const previewEditorContent: JSONContent = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'The court held that the appeal succeeded on narrow grounds, and the reasoning turned on a single disputed fact.',
        },
      ],
    },
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'squashed the subpoena — a term that may not be the one courts actually use here.',
        },
      ],
    },
  ],
};

const previewCategoryLabels: Readonly<Record<string, string>> = {
  'cat-clarity': 'Clarity',
  'cat-terminology': 'Terminology',
  'cat-grammar': 'Grammar',
  'cat-structure': 'Structure',
};

const askWrenService = new MockAskWrenService();

/* -------------------------------------------------------------------------- */
/* Preview routes.                                                             */
/* -------------------------------------------------------------------------- */

function DevHome() {
  return (
    <div className="flex flex-col gap-md">
      <p className="text-body text-text-secondary">
        Preview harness for the components built so far (Waves B0–B2), wired
        against the mock API. Use the navigation above to explore each surface.
        Final role-aware page composition lands in Wave B3.
      </p>
      <AiDisclaimerNotice />
    </div>
  );
}

function DevLogin() {
  return (
    <div className="flex flex-col gap-2xl md:flex-row">
      <section className="flex flex-col gap-md">
        <h2 className="text-heading3 font-sans font-semibold text-text-primary">
          Log in
        </h2>
        <LoginForm onSuccess={() => window.alert('Signed in (mock).')} />
      </section>
      <section className="flex flex-col gap-md">
        <h2 className="text-heading3 font-sans font-semibold text-text-primary">
          Sign up
        </h2>
        <SignupForm onSuccess={() => window.alert('Account created (mock).')} />
      </section>
    </div>
  );
}

function DevEditor() {
  return (
    <div className="flex flex-col gap-md">
      <h2 className="text-heading3 font-sans font-semibold text-text-primary">
        Document editor + inline anchored feedback
      </h2>
      <AnchoredFeedbackEditorContainer
        environmentId="doc-1"
        ariaLabel="Draft editor"
        initialContent={previewEditorContent}
        categoryLabels={previewCategoryLabels}
      />
    </div>
  );
}

function DevDebrief() {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-md">
      <h2 className="text-heading3 font-sans font-semibold text-text-primary">
        AI Debrief
      </h2>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start rounded-md bg-text-primary px-md py-sm text-body font-sans font-medium text-text-on-accent"
      >
        Open AI Debrief
      </button>
      <AiDebriefModal environmentId="doc-1" open={open} onOpenChange={setOpen} />
    </div>
  );
}

function DevNewDocument() {
  return (
    <div className="flex flex-col gap-md">
      <h2 className="text-heading3 font-sans font-semibold text-text-primary">
        New document
      </h2>
      <NewDocumentForm
        writingTypes={previewWritingTypes}
        onActivate={(values) =>
          window.alert(`Activate Editor (mock):\n${JSON.stringify(values, null, 2)}`)
        }
      />
    </div>
  );
}

function DevAskWren() {
  return (
    <div className="flex flex-col gap-md">
      <h2 className="text-heading3 font-sans font-semibold text-text-primary">
        Ask WREN
      </h2>
      <WrenChatPanel
        documentId="doc-1"
        draftId="draft-1"
        draftVersion={1}
        askWrenService={askWrenService}
      />
    </div>
  );
}

const navLinks: readonly { readonly to: string; readonly label: string }[] = [
  { to: '/', label: 'Home' },
  { to: '/login', label: 'Auth' },
  { to: '/editor', label: 'Editor' },
  { to: '/debrief', label: 'AI Debrief' },
  { to: '/new-document', label: 'New Document' },
  { to: '/ask-wren', label: 'Ask WREN' },
];

export function App() {
  useEffect(() => {
    document.title = appConfig.appName;
  }, []);

  return (
    <div className="min-h-screen bg-surface-muted text-text-primary">
      <header className="border-b border-border-subtle bg-surface-primary">
        <div className="mx-auto flex max-w-5xl flex-col gap-sm px-xl py-lg">
          <div className="flex items-baseline gap-md">
            <h1 className="text-heading2 font-sans font-bold text-text-primary">
              {appConfig.appName}
            </h1>
            <span className="text-caption uppercase text-text-muted">
              dev preview
            </span>
          </div>
          <nav className="flex flex-wrap gap-md" aria-label="Preview navigation">
            {navLinks.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.to === '/'}
                className={({ isActive }) =>
                  [
                    'text-bodySmall font-sans font-medium',
                    isActive
                      ? 'text-text-primary underline'
                      : 'text-text-secondary hover:text-text-primary',
                  ].join(' ')
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-xl py-2xl">
        <Routes>
          <Route path="/" element={<DevHome />} />
          <Route path="/login" element={<DevLogin />} />
          <Route path="/editor" element={<DevEditor />} />
          <Route path="/debrief" element={<DevDebrief />} />
          <Route path="/new-document" element={<DevNewDocument />} />
          <Route path="/ask-wren" element={<DevAskWren />} />
        </Routes>
      </main>
    </div>
  );
}
