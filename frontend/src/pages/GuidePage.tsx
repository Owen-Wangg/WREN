import { appConfig } from '@/config/env';

export function GuidePage() {
  return (
    <div className="flex flex-col gap-xl">
      <h1 className="text-title-page font-sans font-bold text-text-primary">
        Guide
      </h1>
      <div className="rounded-md border border-border-subtle bg-surface-primary p-2xl">
        <p className="text-body text-text-secondary">
          Welcome to {appConfig.appName}. This guide will help you navigate the platform and make
          the most of AI-powered feedback on your legal writing.
        </p>
        <ul className="mt-lg flex flex-col gap-md text-body text-text-secondary">
          <li><strong>1. Create a document</strong> — Click "New Document" to start a new writing environment.</li>
          <li><strong>2. Select your domain</strong> — Choose your writing domain (e.g., Criminal Law, Tort Law) and document type.</li>
          <li><strong>3. Upload your draft</strong> — Upload a .docx file or write directly in the editor.</li>
          <li><strong>4. Get feedback</strong> — View the AI Debrief for structured feedback on Content, Organization, and Clarity.</li>
          <li><strong>5. Ask {appConfig.appName}</strong> — Use the chat to get Socratic questions that help you improve your draft.</li>
          <li><strong>6. Iterate</strong> — Revise your draft based on the feedback and re-upload for updated analysis.</li>
        </ul>
      </div>
    </div>
  );
}
