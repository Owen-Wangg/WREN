/**
 * Render/behavior tests for `<PromptEditor>` (task 19.2).
 *
 * **Validates: Requirements 32.2, 32.3, 32.7**
 *
 * Covers: the Admin-owned system scaffolding is shown READ-ONLY and labeled as
 * taking precedence (the edit boundary); the non-blocking ghostwriting hint
 * surfaces on a non-compliant instruction; a compliant save emits the domain
 * prompt values.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PromptEditor } from './PromptEditor';

import { GHOSTWRITING_HINT_MESSAGE } from '../ghostwritingHint';

import type { PromptConfig } from '../fieldExpertSchemas';

const promptConfig: PromptConfig = {
  writingTypeId: 'wt-1',
  domainPrompt: {
    instructionText: 'Ask Socratic questions about unclear holdings.',
    tone: 'Encouraging, direct',
    density: 'standard',
    priority: 'Recurring issues first',
  },
  systemScaffolding: {
    systemInstructions: 'You are WREN. Never produce replacement prose.',
    guardrailTemplate: 'Discard any correct version.',
  },
  updatedAt: '2024-01-02T00:00:00.000Z',
};

describe('PromptEditor', () => {
  it('shows the Admin-owned system scaffolding read-only and labeled as taking precedence', () => {
    render(<PromptEditor promptConfig={promptConfig} onSave={vi.fn()} />);

    // The scaffolding content is rendered (read-only display, not an input).
    expect(
      screen.getByText('You are WREN. Never produce replacement prose.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Discard any correct version.')).toBeInTheDocument();

    // It is clearly labeled Admin-owned / read-only and as taking precedence.
    expect(
      screen.getByText(/Admin-owned, read-only/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/always takes precedence/i)).toBeInTheDocument();

    // There is no editable input carrying the scaffolding text (edit boundary).
    expect(
      screen.queryByDisplayValue(
        'You are WREN. Never produce replacement prose.',
      ),
    ).not.toBeInTheDocument();
  });

  it('does not surface the ghostwriting hint for a compliant instruction', () => {
    render(<PromptEditor promptConfig={promptConfig} onSave={vi.fn()} />);
    expect(screen.queryByText(GHOSTWRITING_HINT_MESSAGE)).not.toBeInTheDocument();
  });

  it('surfaces a non-blocking ghostwriting hint when the instruction looks non-compliant', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<PromptEditor promptConfig={promptConfig} onSave={onSave} />);

    const instruction = screen.getByLabelText('Domain instructions');
    await user.clear(instruction);
    await user.type(instruction, 'Rewrite the sentence for the student.');

    // The hint appears...
    expect(screen.getByText(GHOSTWRITING_HINT_MESSAGE)).toBeInTheDocument();

    // ...but it is non-blocking: the writer can still save.
    const saveButton = screen.getByRole('button', { name: 'Save prompt' });
    expect(saveButton).not.toBeDisabled();
    await user.click(saveButton);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].instructionText).toBe(
      'Rewrite the sentence for the student.',
    );
  });

  it('saves the edited domain prompt values', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<PromptEditor promptConfig={promptConfig} onSave={onSave} />);

    const tone = screen.getByLabelText('Tone');
    await user.clear(tone);
    await user.type(tone, 'Warm, curious');
    await user.click(screen.getByRole('button', { name: 'Save prompt' }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toMatchObject({
      tone: 'Warm, curious',
      density: 'standard',
    });
  });
});
