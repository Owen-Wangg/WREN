/**
 * `<UsageLimitsPanel>` — lists usage limits with current usage and allows
 * editing limitActions per scope (task 19.4; Requirement 33.4).
 */
import { useState } from 'react';

import { useUsageLimits, useUpdateUsageLimit } from '../useAdmin';

import type { HttpClient } from '@/services';

export interface UsageLimitsPanelProps {
  readonly client?: HttpClient;
}

export function UsageLimitsPanel({ client }: UsageLimitsPanelProps) {
  const limitsQuery = useUsageLimits(client);
  const updateMutation = useUpdateUsageLimit(client);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');

  const startEdit = (id: string, currentLimit: number) => {
    setEditingId(id);
    setEditValue(String(currentLimit));
  };

  const saveEdit = () => {
    if (editingId && editValue.trim()) {
      const parsed = parseInt(editValue, 10);
      if (parsed > 0) {
        updateMutation.mutate(
          { id: editingId, limitActions: parsed },
          { onSuccess: () => setEditingId(null) },
        );
      }
    }
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValue('');
  };

  return (
    <section aria-labelledby="usage-limits-heading" className="flex flex-col gap-md">
      <h3
        id="usage-limits-heading"
        className="text-heading3 font-sans font-semibold text-text-primary"
      >
        Usage Limits
      </h3>

      {limitsQuery.isLoading && (
        <p role="status" className="text-bodySmall text-text-secondary">
          Loading usage limits…
        </p>
      )}

      {limitsQuery.isError && (
        <p role="alert" className="text-bodySmall text-signal-critical">
          Failed to load usage limits.
        </p>
      )}

      {limitsQuery.data && limitsQuery.data.length === 0 && (
        <p className="text-bodySmall text-text-secondary">
          No usage limits configured.
        </p>
      )}

      {limitsQuery.data && limitsQuery.data.length > 0 && (
        <table className="w-full border-collapse text-left">
          <thead>
            <tr>
              <th
                scope="col"
                className="border-b border-border-subtle px-md py-sm text-caption font-sans font-semibold text-text-secondary"
              >
                Scope
              </th>
              <th
                scope="col"
                className="border-b border-border-subtle px-md py-sm text-caption font-sans font-semibold text-text-secondary"
              >
                Limit
              </th>
              <th
                scope="col"
                className="border-b border-border-subtle px-md py-sm text-caption font-sans font-semibold text-text-secondary"
              >
                Current Usage
              </th>
              <th
                scope="col"
                className="border-b border-border-subtle px-md py-sm text-caption font-sans font-semibold text-text-secondary"
              >
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {limitsQuery.data.map((limit) => (
              <tr key={limit.id}>
                <td className="border-b border-border-subtle px-md py-sm text-bodySmall text-text-primary">
                  {limit.scopeLabel}
                </td>
                <td className="border-b border-border-subtle px-md py-sm text-bodySmall text-text-primary">
                  {editingId === limit.id ? (
                    <input
                      type="number"
                      min="1"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      aria-label={`Edit limit for ${limit.scopeLabel}`}
                      className="w-24 rounded-md border border-border-strong bg-surface-primary px-sm py-xs text-bodySmall text-text-primary"
                    />
                  ) : (
                    limit.limitActions
                  )}
                </td>
                <td className="border-b border-border-subtle px-md py-sm text-bodySmall text-text-secondary">
                  {limit.currentUsage}
                </td>
                <td className="border-b border-border-subtle px-md py-sm text-bodySmall">
                  {editingId === limit.id ? (
                    <div className="flex gap-sm">
                      <button
                        type="button"
                        onClick={saveEdit}
                        disabled={updateMutation.isPending}
                        className="text-bodySmall font-sans font-medium text-text-primary underline"
                      >
                        {updateMutation.isPending ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        type="button"
                        onClick={cancelEdit}
                        className="text-bodySmall font-sans font-medium text-text-secondary underline"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => startEdit(limit.id, limit.limitActions)}
                      className="text-bodySmall font-sans font-medium text-text-primary underline"
                    >
                      Edit
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
