/**
 * `<FootnotePanel>` — inline editing popup for a footnote marker
 * (footnote-citation-support spec, Requirements 3.2, 3.4, 3.7, 4.4).
 *
 * A Radix `Popover` anchored to the focused/clicked footnote marker, opened
 * synchronously from the caller's click/focus handler (no async work gating
 * the open transition, satisfying the 200ms budget in Requirement 3.2).
 * React Hook Form + Zod drive the body-content and five citation fields;
 * inline missing-field errors are sourced from
 * `validateFootnoteAgainstCitationConfig` so the same gating logic drives
 * both the save-blocking behavior and the inline error display.
 *
 * Design tokens only (frontend steering §9) — no hardcoded colors/sizes.
 */
import * as Popover from '@radix-ui/react-popover';
import { zodResolver } from '@hookform/resolvers/zod';
import { X } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import {
  CITATION_FIELD_NAMES,
  MAX_CITATION_FIELD_LENGTH,
  validateFootnoteAgainstCitationConfig,
  type CitationConfigLike,
  type CitationFieldName,
  type FootnoteAttrs,
} from '../tiptapFootnote';

const FIELD_LABELS: Record<CitationFieldName, string> = {
  author: 'Author',
  title: 'Title',
  source: 'Source',
  pinpoint: 'Pinpoint',
  year: 'Year',
};

const citationFieldSchema = z.string().max(MAX_CITATION_FIELD_LENGTH);

const footnoteFormSchema = z.object({
  bodyText: z.string(),
  author: citationFieldSchema,
  title: citationFieldSchema,
  source: citationFieldSchema,
  pinpoint: citationFieldSchema,
  year: citationFieldSchema,
});

export type FootnoteFormValues = z.infer<typeof footnoteFormSchema>;

/** Plain-text flatten of a footnote's rich-text body for the textarea field. */
function flattenBodyText(content: FootnoteAttrs['content']): string {
  const node = content as { text?: string; content?: unknown[] } | null | undefined;
  if (!node) return '';
  if (typeof node.text === 'string') return node.text;
  if (!Array.isArray(node.content)) return '';
  return node.content.map((child) => flattenBodyText(child as FootnoteAttrs['content'])).join('\n');
}

export interface FootnotePanelProps {
  /** Controls popover visibility — the caller owns open/close state. */
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** The footnote being edited. */
  readonly footnote: FootnoteAttrs;
  /** Department Admin's citation config for this footnote's Document Type, if any. */
  readonly citationConfig?: CitationConfigLike | null;
  /** Called with the patch to apply via `updateFootnoteFields`. */
  readonly onSave: (fields: Partial<Omit<FootnoteAttrs, 'footnoteNumber'>>) => void;
  /** Called when the student deletes this footnote. */
  readonly onDelete: () => void;
  /** The element the popover anchors to (the clicked/focused marker). */
  readonly anchor: React.ReactNode;
}

export function FootnotePanel({
  open,
  onOpenChange,
  footnote,
  citationConfig,
  onSave,
  onDelete,
  anchor,
}: FootnotePanelProps) {
  const defaultValues = useMemo<FootnoteFormValues>(
    () => ({
      bodyText: flattenBodyText(footnote.content),
      author: footnote.author,
      title: footnote.title,
      source: footnote.source,
      pinpoint: footnote.pinpoint,
      year: footnote.year,
    }),
    [footnote],
  );

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors },
  } = useForm<FootnoteFormValues>({
    resolver: zodResolver(footnoteFormSchema),
    defaultValues,
  });

  useEffect(() => {
    reset(defaultValues);
  }, [defaultValues, reset]);

  const values = watch();
  const missingFields = validateFootnoteAgainstCitationConfig(
    { author: values.author, title: values.title, source: values.source, pinpoint: values.pinpoint, year: values.year },
    citationConfig,
  );

  const onSubmit = (data: FootnoteFormValues) => {
    if (missingFields.length > 0) return; // save-blocking (Requirement 4.4)
    onSave({
      content: {
        type: 'doc',
        content: data.bodyText.length > 0 ? [{ type: 'paragraph', content: [{ type: 'text', text: data.bodyText }] }] : [{ type: 'paragraph' }],
      },
      author: data.author,
      title: data.title,
      source: data.source,
      pinpoint: data.pinpoint,
      year: data.year,
    });
    onOpenChange(false);
  };

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>{anchor}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          data-footnote-panel=""
          side="bottom"
          align="start"
          sideOffset={4}
          className="z-50 w-80 rounded-lg border border-border-strong bg-surface-primary p-lg shadow-lg"
          onOpenAutoFocus={(e) => {
            // Open synchronously from the trigger's own click/focus handler
            // (no async gating) — this default autofocus behavior is kept
            // so the 200ms open budget (Requirement 3.2) is satisfied by the
            // same render pass that shows the popover.
            e.preventDefault();
          }}
        >
          <div className="mb-md flex items-center justify-between">
            <span className="text-bodySmall font-medium text-text-primary">
              Footnote {footnote.footnoteNumber}
            </span>
            <Popover.Close
              aria-label="Close footnote editor"
              className="rounded-md p-xs text-text-muted hover:bg-surface-muted hover:text-text-primary"
            >
              <X size={16} aria-hidden="true" />
            </Popover.Close>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-sm">
            <label className="flex flex-col gap-2xs">
              <span className="text-caption text-text-secondary">Note</span>
              <textarea
                {...register('bodyText')}
                rows={3}
                className="rounded-md border border-border-subtle bg-surface-primary p-sm text-bodySmall text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/40"
              />
            </label>

            {CITATION_FIELD_NAMES.map((field) => {
              const isMissing = missingFields.includes(field);
              return (
                <label key={field} className="flex flex-col gap-2xs">
                  <span className="text-caption text-text-secondary">{FIELD_LABELS[field]}</span>
                  <input
                    {...register(field)}
                    type="text"
                    maxLength={MAX_CITATION_FIELD_LENGTH}
                    aria-invalid={isMissing || Boolean(errors[field])}
                    className={[
                      'rounded-md border bg-surface-primary p-sm text-bodySmall text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/40',
                      isMissing || errors[field] ? 'border-signal-critical' : 'border-border-subtle',
                    ].join(' ')}
                  />
                  {isMissing && (
                    <span role="alert" className="text-caption text-signal-critical">
                      {FIELD_LABELS[field]} is required.
                    </span>
                  )}
                  {errors[field] && (
                    <span role="alert" className="text-caption text-signal-critical">
                      {errors[field]?.message}
                    </span>
                  )}
                </label>
              );
            })}

            <div className="mt-sm flex items-center justify-between">
              <button
                type="button"
                onClick={onDelete}
                className="text-caption text-signal-critical hover:underline"
              >
                Delete footnote
              </button>
              <button
                type="submit"
                disabled={missingFields.length > 0}
                className="rounded-md bg-accent-primary px-md py-xs text-bodySmall font-medium text-surface-primary disabled:pointer-events-none disabled:opacity-40"
              >
                Save
              </button>
            </div>
          </form>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
