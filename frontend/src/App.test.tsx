import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from '@/App';
import { AppProviders } from '@/app/AppProviders';
import { appConfig } from '@/config/env';

describe('App', () => {
  it('renders the application name from the single config value', () => {
    render(
      <AppProviders>
        <App />
      </AppProviders>,
    );

    expect(
      screen.getByRole('heading', { level: 1, name: appConfig.appName }),
    ).toBeInTheDocument();
  });

  it('sets the document title from the single config value (Requirement 53.2)', () => {
    render(
      <AppProviders>
        <App />
      </AppProviders>,
    );

    expect(document.title).toBe(appConfig.appName);
  });
});
