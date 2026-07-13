/**
 * `<AdminConsole>` — the connected top-level (System) Admin technical console
 * (task 19.4; Requirements 33.1–33.5, 41.1, 41.2).
 *
 * Composes sections for: Model Configuration, System Prompt/Guardrails,
 * Application Settings, Organizations Management, System-Wide User/Role View,
 * Usage Limits, and Platform Analytics.
 *
 * Deliberate boundary (Requirement 33.5): NOTHING in this console touches
 * business Topics, Content Types, or custom-metadata fields — those are
 * Org-Owner concerns.
 *
 * Route path: `/admin` (wired in App.tsx preview harness).
 */
import { AppSettingsForm } from './AppSettingsForm';
import { ModelConfigForm } from './ModelConfigForm';
import { OrganizationsList } from './OrganizationsList';
import { PlatformAnalyticsView } from './PlatformAnalyticsView';
import { SystemPromptForm } from './SystemPromptForm';
import { SystemUsersList } from './SystemUsersList';
import { UsageLimitsPanel } from './UsageLimitsPanel';

import { AiDisclaimerNotice } from '@/components/ui';
import { apiClient, type HttpClient } from '@/services';

export interface AdminConsoleProps {
  /** Injectable HTTP client (defaults to the shared app client). */
  readonly client?: HttpClient;
}

export function AdminConsole({ client = apiClient }: AdminConsoleProps) {
  return (
    <div className="flex w-full max-w-4xl flex-col gap-xl">
      <header className="flex flex-col gap-sm">
        <h2 className="text-heading2 font-sans font-semibold text-text-primary">
          Admin Console
        </h2>
        <AiDisclaimerNotice />
      </header>

      <div className="flex flex-col gap-2xl">
        <ModelConfigForm client={client} />
        <SystemPromptForm client={client} />
        <AppSettingsForm client={client} />
        <OrganizationsList client={client} />
        <SystemUsersList client={client} />
        <UsageLimitsPanel client={client} />
        <PlatformAnalyticsView client={client} />
      </div>
    </div>
  );
}
