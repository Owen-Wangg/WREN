import { useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useMutation } from '@tanstack/react-query';
import { FileText, Upload, X } from 'lucide-react';
import {
  MAX_DEPARTMENT_ENROLLMENT_IMPORT,
  type DepartmentEnrollmentImportResult,
} from '@wren/types';

import { importDepartmentEnrollments } from '../systemAdminApi';
import { parseRosterCsv, type ParsedRoster } from '../rosterCsv';

const MAX_FILE_BYTES = 1024 * 1024;
const PREVIEW_LIMIT = 5;

type ImportMode = 'add' | 'replace';

interface ImportStudentsDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly departmentId: string;
  readonly departmentName?: string;
  readonly isLocked: boolean;
  /** Called after a successful import so the page can refresh its lists. */
  readonly onImported: () => void;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function EmailSample({ emails }: { readonly emails: readonly string[] }) {
  return (
    <ul className="mt-1 space-y-0.5 text-xs text-gray-600">
      {emails.slice(0, PREVIEW_LIMIT).map((email) => (
        <li key={email} className="truncate">{email}</li>
      ))}
      {emails.length > PREVIEW_LIMIT && <li>and {emails.length - PREVIEW_LIMIT} more</li>}
    </ul>
  );
}

/**
 * System Admin CSV upload for Permitted users: a CSV of student emails either
 * adds to the list or replaces it. Students with an account are enrolled
 * now; the rest are enrolled automatically the first time they sign in with
 * that email. Replacing always shows a preview of who would be removed first.
 */
export function ImportStudentsDialog({
  open,
  onOpenChange,
  departmentId,
  departmentName,
  isLocked,
  onImported,
}: ImportStudentsDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [roster, setRoster] = useState<ParsedRoster | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [mode, setMode] = useState<ImportMode>('add');
  /** Dry-run outcome awaiting confirmation (replace mode only). */
  const [preview, setPreview] = useState<DepartmentEnrollmentImportResult | null>(null);
  const [result, setResult] = useState<DepartmentEnrollmentImportResult | null>(null);

  const importMutation = useMutation({
    mutationFn: ({ emails, dryRun }: { emails: string[]; dryRun: boolean }) =>
      importDepartmentEnrollments(departmentId, emails, { mode, dryRun }),
    onSuccess: (data) => {
      if (data.dryRun) {
        setPreview(data);
        return;
      }
      setPreview(null);
      setResult(data);
      onImported();
    },
  });

  function reset() {
    setFileName(null);
    setRoster(null);
    setFileError(null);
    setMode('add');
    setPreview(null);
    setResult(null);
    importMutation.reset();
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function close() {
    onOpenChange(false);
    reset();
  }

  async function handleFile(file: File | undefined) {
    setRoster(null);
    setPreview(null);
    setResult(null);
    setFileError(null);
    importMutation.reset();
    if (!file) return;
    setFileName(file.name);
    if (file.size > MAX_FILE_BYTES) {
      setFileError('This file is larger than 1 MB. Split it into smaller files.');
      return;
    }
    const parsed = parseRosterCsv(await file.text());
    if (parsed.emails.length === 0) {
      setFileError('No email addresses were found in this file.');
      return;
    }
    if (parsed.emails.length > MAX_DEPARTMENT_ENROLLMENT_IMPORT) {
      setFileError(
        `This file lists ${parsed.emails.length} emails. Import at most ${MAX_DEPARTMENT_ENROLLMENT_IMPORT} at a time.`,
      );
      return;
    }
    setRoster(parsed);
  }

  function submit() {
    if (!roster) return;
    // Replacing removes students, so it is previewed before anything is saved.
    importMutation.mutate({ emails: roster.emails, dryRun: mode === 'replace' && !preview });
  }

  const errorMessage = importMutation.isError
    ? (importMutation.error as { details?: { message?: string } })?.details?.message ??
      'Import failed. Please try again.'
    : null;

  const primaryLabel = importMutation.isPending
    ? preview || mode === 'add'
      ? 'Importing…'
      : 'Checking…'
    : preview
      ? preview.removed.length > 0
        ? `Replace list and remove ${plural(preview.removed.length, 'user')}`
        : 'Replace list'
      : mode === 'replace'
        ? 'Review changes'
        : roster
          ? `Import ${plural(roster.emails.length, 'student')}`
          : 'Import';

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (importMutation.isPending) return;
        if (next) onOpenChange(true);
        else close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content
          aria-busy={importMutation.isPending}
          className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100vh-2rem)] w-[min(520px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl bg-white shadow-xl focus:outline-none"
        >
          <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
            <Dialog.Title className="text-lg font-semibold text-gray-900">
              Import permitted users
            </Dialog.Title>
            <Dialog.Close
              disabled={importMutation.isPending}
              aria-label="Close"
              className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
            >
              <X size={18} />
            </Dialog.Close>
          </div>

          <div className="space-y-4 px-6 py-5">
            <Dialog.Description className="text-sm text-gray-600">
              Upload a CSV of student email addresses to add to Permitted users for{' '}
              <strong>{departmentName ?? 'this department'}</strong>. Use the email each student
              signs in to WREN with. Students who already have an account are added right away;
              everyone else is added automatically the first time they sign in.
            </Dialog.Description>

            <p className="rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600">
              Permitted users can see this department and submit to every document type in it,
              including ones added later.
              {!isLocked &&
                ' This department is currently open, so this takes effect if it is locked or its visibility is limited.'}
            </p>

            {!result && !preview && (
              <>
                <label
                  htmlFor="roster-csv"
                  className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-gray-300 px-4 py-6 text-center hover:border-gray-400 hover:bg-gray-50"
                >
                  {fileName ? (
                    <FileText size={22} className="text-gray-500" />
                  ) : (
                    <Upload size={22} className="text-gray-500" />
                  )}
                  <span className="text-sm font-semibold text-gray-900">
                    {fileName ?? 'Choose a CSV file'}
                  </span>
                  <span className="text-xs text-gray-500">
                    One email per row, or a column with an “Email” header
                  </span>
                  <input
                    ref={fileInputRef}
                    id="roster-csv"
                    type="file"
                    accept=".csv,text/csv,text/plain"
                    className="sr-only"
                    disabled={importMutation.isPending}
                    onChange={(event) => void handleFile(event.target.files?.[0])}
                  />
                </label>

                {fileError && (
                  <p role="alert" className="text-sm text-red-600">{fileError}</p>
                )}

                {roster && (
                  <div className="rounded-lg border border-gray-200 p-3 text-sm">
                    <p className="font-medium text-gray-900">
                      {plural(roster.emails.length, 'email')} found
                    </p>
                    <EmailSample emails={roster.emails} />
                    {roster.skipped.length > 0 && (
                      <p className="mt-2 text-xs text-amber-700">
                        {plural(roster.skipped.length, 'row')} without a valid email will be skipped.
                      </p>
                    )}
                  </div>
                )}

                <fieldset className="space-y-2">
                  <legend className="mb-1 text-sm font-semibold text-gray-900">
                    How should this file update Permitted users?
                  </legend>
                  {(
                    [
                      ['add', 'Add to the list', 'Add these students. Everyone already permitted stays.'],
                      [
                        'replace',
                        'Replace the list',
                        'Make this file the whole list. Permitted users not in it are removed and lose access to this department. You’ll review the changes first.',
                      ],
                    ] as const
                  ).map(([value, label, help]) => (
                    <label
                      key={value}
                      className={`flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 transition ${
                        mode === value
                          ? 'border-gray-900 bg-gray-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name="roster-import-mode"
                        value={value}
                        checked={mode === value}
                        onChange={() => setMode(value)}
                        disabled={importMutation.isPending}
                        className="mt-0.5 accent-gray-900"
                      />
                      <span>
                        <span className="block text-sm font-medium text-gray-900">{label}</span>
                        <span className="block text-xs text-gray-500">{help}</span>
                      </span>
                    </label>
                  ))}
                </fieldset>
              </>
            )}

            {preview && (
              <div className="space-y-3 rounded-lg border border-gray-200 p-4 text-sm">
                <p className="font-semibold text-gray-900">Review changes</p>
                <p className="text-gray-700">
                  After replacing, Permitted users will have{' '}
                  {plural(preview.enrolled.length + preview.pending.length, 'student')} (
                  {preview.enrolled.length} with accounts, {preview.pending.length} waiting to sign
                  up).
                </p>
                {preview.removed.length > 0 ? (
                  <div className="rounded-md border border-red-200 bg-red-50 p-3">
                    <p className="font-medium text-red-800">
                      {plural(preview.removed.length, 'student')} will be removed and lose access:
                    </p>
                    <EmailSample emails={preview.removed} />
                  </div>
                ) : (
                  <p className="text-gray-600">No one will be removed.</p>
                )}
              </div>
            )}

            {errorMessage && (
              <p role="alert" className="text-sm text-red-600">{errorMessage}</p>
            )}

            {result && (
              <div role="status" className="space-y-2 rounded-lg border border-gray-200 p-4 text-sm">
                <p className="font-semibold text-gray-900">Permitted users updated</p>
                <ul className="space-y-1 text-gray-700">
                  <li>
                    <span className="font-medium text-green-700">{result.enrolled.length}</span>{' '}
                    enrolled now (existing accounts)
                  </li>
                  <li>
                    <span className="font-medium text-gray-900">{result.pending.length}</span>{' '}
                    will be enrolled when they sign up
                  </li>
                  {result.removed.length > 0 && (
                    <li>
                      <span className="font-medium text-red-700">{result.removed.length}</span>{' '}
                      removed from Permitted users
                    </li>
                  )}
                  {result.alreadyOnRoster > 0 && (
                    <li className="text-gray-500">
                      {plural(result.alreadyOnRoster, 'email')} were already permitted
                    </li>
                  )}
                  {result.invalid.length > 0 && (
                    <li className="text-amber-700">
                      {plural(result.invalid.length, 'value')} skipped as invalid:{' '}
                      {result.invalid.slice(0, PREVIEW_LIMIT).join(', ')}
                      {result.invalid.length > PREVIEW_LIMIT ? '…' : ''}
                    </li>
                  )}
                </ul>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 border-t border-gray-100 px-6 py-4">
            {result ? (
              <>
                <button
                  type="button"
                  onClick={reset}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Import another file
                </button>
                <button
                  type="button"
                  onClick={close}
                  className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800"
                >
                  Done
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    if (preview) {
                      setPreview(null);
                      importMutation.reset();
                    } else {
                      close();
                    }
                  }}
                  disabled={importMutation.isPending}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  {preview ? 'Back' : 'Cancel'}
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={!roster || importMutation.isPending}
                  className={`rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${
                    preview && preview.removed.length > 0
                      ? 'bg-red-600 hover:bg-red-700'
                      : 'bg-gray-900 hover:bg-gray-800'
                  }`}
                >
                  {primaryLabel}
                </button>
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
