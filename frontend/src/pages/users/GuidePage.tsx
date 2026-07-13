import { appConfig } from '@/config/env';

export function GuidePage() {
  return (
    <div className="flex flex-col gap-xl">
      <h1 className="text-title-page font-sans font-bold text-text-primary">
        Guide
      </h1>
      <div className="rounded-md border border-border-subtle bg-surface-primary p-2xl">
        <div className="flex flex-col gap-md text-body text-text-secondary">
          <p>Welcome to {appConfig.appName}. Here's how to use it:</p>

          <p>Set up your document by creating a new one and selecting your document type. This ensures feedback is tailored to your writing context.</p>

          <p>Upload your draft or start writing directly in the editor.</p>

          <p>Once you have content, two tools will help you improve:</p>

          <p><strong>AI Debrief</strong> gives you a bird's-eye view of your writing. See what's working, what could improve, and click any quote to highlight it in your document.</p>

          <p><strong>Ask {appConfig.appName}</strong> to go deeper. Ask questions and get guidance that helps you think critically about your draft.</p>

          <p>Revise and re-upload as you work. Each version gives you updated feedback so you can track your improvement.</p>
        </div>
      </div>
    </div>
  );
}
