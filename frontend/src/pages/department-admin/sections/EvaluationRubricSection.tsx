import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, Plus, Pencil, Trash2, X, Check } from 'lucide-react';
import {
  listErrorCategories,
  createErrorCategory,
  updateErrorCategory,
  deleteErrorCategory,
  getDocumentTypeConfig,
  updateDocumentTypeConfig,
} from '@/features/department-admin/departmentAdminApi';

interface EvaluationRubricSectionProps {
  documentTypeId: string;
  documentTypeName: string;
}

const DEFAULT_CATEGORIES = [
  { name: 'Spelling / Grammar', description: 'Spelling errors, grammatical mistakes, and punctuation issues' },
  { name: 'Tone', description: 'Formality, professionalism, and authority of language appropriate for the document type' },
  { name: 'Clarity', description: 'How clear, precise, and understandable the writing is; avoiding ambiguity' },
  { name: 'Consistency / Coherence', description: 'Logical consistency, coherent arguments, and maintaining parallel structure' },
  { name: 'Persuasiveness', description: 'Strength of arguments, evidence support, and persuasive impact' },
  { name: 'Objectivity / Neutrality', description: 'Maintaining neutral language and avoiding bias' },
  { name: 'Organisation', description: 'Structure, logical flow, proper section organisation, and document layout' },
];

interface OrganisationFramework {
  key: string;
  label: string;
  description: string;
}

const ORGANISATION_FRAMEWORKS: OrganisationFramework[] = [
  {
    key: 'irac',
    label: 'IRAC — Issue, Rule, Application, Conclusion',
    description:
      'State the legal question (Issue), identify the governing law (Rule), apply that law to the specific facts (Application), and conclude with the likely outcome (Conclusion). Most common convention for objective writing such as internal legal memoranda.',
  },
  {
    key: 'creac',
    label: 'CREAC — Conclusion, Rule, Explanation, Application, Conclusion',
    description:
      'Place the ultimate conclusion and issue at the very top of the analysis to immediately capture the reader\'s attention, followed by the governing Rule, an Explanation of how courts have applied it, Application to the facts, and a restated Conclusion. Frequently used in persuasive writing such as appellate briefs.',
  },
  {
    key: 'point-first',
    label: 'Point-First Writing',
    description:
      'State the major conclusion of each paragraph in the very first sentence. Subsequent sentences provide supporting legal authorities and arguments. Prioritises scannability and logical flow throughout the document.',
  },
  {
    key: 'custom',
    label: 'Custom — define below',
    description: '',
  },
];

interface CriterionOverride {
  definition: string;
  criteria: string;
  frameworkKey?: string;
}

type OverridesMap = Record<string, CriterionOverride>;

function isOrganisationCategory(name: string): boolean {
  return /organi[sz]ation/i.test(name);
}

function parseOverrides(raw: string | null | undefined): OverridesMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.v === 1 && parsed.overrides) return parsed.overrides as OverridesMap;
  } catch {
    // legacy plain text — ignore, start fresh
  }
  return {};
}

function serializeOverrides(overrides: OverridesMap): string {
  return JSON.stringify({ v: 1, overrides });
}

export function EvaluationRubricSection({
  documentTypeId,
  documentTypeName,
}: EvaluationRubricSectionProps) {
  const queryClient = useQueryClient();

  // ── Document Context state ────────────────────────────────────────────────
  const [contextOpen, setContextOpen] = useState(false);
  const [context, setContext] = useState({
    purpose: '',
    restrictions: '',
    notes: '',
  });

  // ── Criteria state ────────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [overrides, setOverrides] = useState<OverridesMap>({});
  const [isSeeding, setIsSeeding] = useState(false);

  // ── Add custom criterion ──────────────────────────────────────────────────
  const [addingCustom, setAddingCustom] = useState(false);
  const [customName, setCustomName] = useState('');

  // ── Save state ────────────────────────────────────────────────────────────
  const [saveSuccess, setSaveSuccess] = useState(false);

  // ── Queries ───────────────────────────────────────────────────────────────
  const { data: categories = [], isLoading: categoriesLoading } = useQuery({
    queryKey: ['error-categories', documentTypeId],
    queryFn: () => listErrorCategories(documentTypeId),
  });

  const { data: existingConfig, isLoading: configLoading } = useQuery({
    queryKey: ['document-type-config', documentTypeId],
    queryFn: () => getDocumentTypeConfig(documentTypeId),
  });

  // ── Seed defaults if no categories yet ───────────────────────────────────
  useEffect(() => {
    if (!categoriesLoading && categories.length === 0 && !isSeeding) {
      setIsSeeding(true);
      const seed = async () => {
        try {
          for (const cat of DEFAULT_CATEGORIES) {
            await createErrorCategory(documentTypeId, cat.name);
          }
          await queryClient.invalidateQueries({ queryKey: ['error-categories', documentTypeId] });
        } catch (err) {
          console.error('Failed to seed default feedback categories', err);
        } finally {
          setIsSeeding(false);
        }
      };
      void seed();
    }
  }, [categoriesLoading, categories.length, documentTypeId, queryClient, isSeeding]);

  // ── Hydrate from saved config ─────────────────────────────────────────────
  useEffect(() => {
    if (existingConfig) {
      setContext({
        purpose: existingConfig.typePromptText ?? '',
        restrictions: existingConfig.restrictionsDescription ?? '',
        notes: existingConfig.notesDescription ?? '',
      });
      setOverrides(parseOverrides(existingConfig.densityDescription));
    }
  }, [existingConfig]);

  // ── Default all categories selected on first load ─────────────────────────
  useEffect(() => {
    if (categories.length === 0) return;
    if (existingConfig) {
      // Config row exists — use whatever was saved, even if the array is empty.
      // An empty array means the admin explicitly deselected everything.
      // A non-empty array means use exactly those ids.
      // If the saved array is non-empty but some ids no longer exist (deleted),
      // filter to only valid ids so stale ids don't silently persist.
      const validIds = new Set(categories.map((c) => c.id));
      const saved = (existingConfig.categoryPriority ?? []).filter((id) => validIds.has(id));
      if (saved.length > 0 || (existingConfig.categoryPriority ?? []).length > 0) {
        setSelectedIds(new Set(saved));
      } else {
        // No config row had priority set yet — default to all selected.
        setSelectedIds(new Set(categories.map((c) => c.id)));
      }
    } else {
      // No config row at all yet — default to all selected.
      setSelectedIds(new Set(categories.map((c) => c.id)));
    }
  }, [categories, existingConfig]);

  // ── Mutations ─────────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: () =>
      updateDocumentTypeConfig(documentTypeId, {
        typePromptText: context.purpose,
        restrictionsDescription: context.restrictions,
        notesDescription: context.notes,
        densityDescription: serializeOverrides(overrides),
        categoryPriority: Array.from(selectedIds),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['document-type-config', documentTypeId] });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    },
  });

  const addCategoryMutation = useMutation({
    mutationFn: (name: string) => createErrorCategory(documentTypeId, name),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ['error-categories', documentTypeId] });
      setSelectedIds((prev) => new Set([...prev, created.id]));
      setExpandedIds((prev) => new Set([...prev, created.id]));
      setCustomName('');
      setAddingCustom(false);
    },
  });

  // ── Rename state ─────────────────────────────────────────────────────────
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      updateErrorCategory(documentTypeId, id, name),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['error-categories', documentTypeId] });
      setRenamingId(null);
      setRenameValue('');
    },
  });

  // ── Delete state ──────────────────────────────────────────────────────────
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteErrorCategory(documentTypeId, id),
    onSuccess: (_, id) => {
      void queryClient.invalidateQueries({ queryKey: ['error-categories', documentTypeId] });
      setSelectedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
      setExpandedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
      setConfirmDeleteId(null);
    },
  });

  const startRename = (id: string, currentName: string) => {
    setRenamingId(id);
    setRenameValue(currentName);
    // close confirmation if open
    setConfirmDeleteId(null);
  };

  const commitRename = (id: string) => {
    const trimmed = renameValue.trim();
    if (trimmed) renameMutation.mutate({ id, name: trimmed });
  };

  // ── Helpers ───────────────────────────────────────────────────────────────
  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        setExpandedIds((exp) => { const e = new Set(exp); e.delete(id); return e; });
      } else {
        next.add(id);
        setExpandedIds((exp) => new Set([...exp, id]));
      }
      return next;
    });
  };

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const setOverrideField = (id: string, field: keyof CriterionOverride, value: string) => {
    setOverrides((prev) => {
      const existing = prev[id] ?? { definition: '', criteria: '' };
      return { ...prev, [id]: { ...existing, [field]: value } };
    });
  };

  const selectFramework = (id: string, key: string) => {
    const framework = ORGANISATION_FRAMEWORKS.find((f) => f.key === key);
    setOverrides((prev) => {
      const existing = prev[id] ?? { definition: '', criteria: '' };
      return {
        ...prev,
        [id]: {
          ...existing,
          frameworkKey: key,
          // pre-fill definition only if selecting a real framework (not custom)
          definition: framework && key !== 'custom' ? framework.description : existing.definition,
        },
      };
    });
  };

  const defaultDescriptionFor = (name: string) =>
    DEFAULT_CATEGORIES.find((d) => d.name === name)?.description ?? null;

  const isLoading = categoriesLoading || configLoading || isSeeding;

  if (isLoading) {
    return (
      <div>
        <h1 className="mb-4 text-3xl font-bold text-gray-900">Evaluation Rubric</h1>
        <p className="text-sm text-gray-600">
          {isSeeding ? 'Setting up default criteria…' : 'Loading…'}
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-8">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Evaluation Rubric</h1>
        <p className="mt-2 text-gray-600">
          Define how the AI evaluates <strong>{documentTypeName}</strong> drafts: which criteria apply and what each one should look like when done well.
        </p>
      </div>

      {/* ── Section 1: Document Context ───────────────────────────────────── */}
      <div className="rounded-lg border border-gray-200 bg-white">
        <button
          type="button"
          onClick={() => setContextOpen((o) => !o)}
          className="flex w-full items-center justify-between px-6 py-4 text-left"
        >
          <div>
            <p className="font-semibold text-gray-900">Document Context</p>
            <p className="text-sm text-gray-500">
              General background the AI uses for all criteria.
            </p>
          </div>
          {contextOpen ? <ChevronUp size={18} className="shrink-0 text-gray-400" /> : <ChevronDown size={18} className="shrink-0 text-gray-400" />}
        </button>

        {contextOpen && (
          <div className="border-t border-gray-100 px-6 pb-6 pt-4 space-y-5">
            {[
              { id: 'purpose', label: 'Purpose', placeholder: 'What is this document? When and why do students write it?' },
              { id: 'restrictions', label: "Common mistakes to avoid", placeholder: 'What errors or patterns should the AI flag? What must students never do in this document type?' },
              { id: 'notes', label: 'Additional background', placeholder: 'Any other context the AI needs about this document type that does not belong in a specific criterion.' },
            ].map((field) => (
              <div key={field.id}>
                <label className="block text-sm font-semibold text-gray-900 mb-1">
                  {field.label}
                </label>
                <textarea
                  value={context[field.id as keyof typeof context]}
                  onChange={(e) => setContext((prev) => ({ ...prev, [field.id]: e.target.value }))}
                  placeholder={field.placeholder}
                  rows={3}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Section 2: Evaluation Criteria ───────────────────────────────── */}
      <div>
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Evaluation Criteria</h2>
          <p className="mt-1 text-sm text-gray-600">
            Select which criteria the AI evaluates for this document type. Expand an active
            criterion to define what it means here. These definitions will shape the AI's feedback.
          </p>
        </div>

        <div className="space-y-2">
          {categories.map((category) => {
            const isActive = selectedIds.has(category.id);
            const isExpanded = expandedIds.has(category.id);
            const override = overrides[category.id];
            const defaultDesc = defaultDescriptionFor(category.name);

            return (
              <div
                key={category.id}
                className={`group rounded-lg border transition-colors ${
                  isActive ? 'border-gray-300 bg-white' : 'border-gray-200 bg-gray-50'
                }`}
              >
                {/* Row header */}
                <div className="flex items-center gap-2 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={() => toggleSelected(category.id)}
                    className="h-4 w-4 shrink-0 rounded border-gray-300 text-gray-900 focus:ring-gray-900"
                  />

                  {/* Inline rename or static name */}
                  {renamingId === category.id ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename(category.id);
                        if (e.key === 'Escape') { setRenamingId(null); setRenameValue(''); }
                      }}
                      className="flex-1 rounded border border-gray-300 px-2 py-0.5 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                    />
                  ) : (
                    <span className={`flex-1 text-sm font-semibold ${isActive ? 'text-gray-900' : 'text-gray-400'}`}>
                      {category.name}
                    </span>
                  )}

                  {/* Rename commit / cancel */}
                  {renamingId === category.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => commitRename(category.id)}
                        disabled={!renameValue.trim() || renameMutation.isPending}
                        className="rounded p-1 text-gray-600 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-40"
                        aria-label="Confirm rename"
                      >
                        <Check size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => { setRenamingId(null); setRenameValue(''); }}
                        className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                        aria-label="Cancel rename"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {/* Rename */}
                      <button
                        type="button"
                        onClick={() => startRename(category.id, category.name)}
                        className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                        aria-label={`Rename ${category.name}`}
                      >
                        <Pencil size={13} />
                      </button>

                      {/* Delete — two-step */}
                      {confirmDeleteId === category.id ? (
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-red-600 font-medium">Delete?</span>
                          <button
                            type="button"
                            onClick={() => deleteMutation.mutate(category.id)}
                            disabled={deleteMutation.isPending}
                            className="rounded px-1.5 py-0.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                          >
                            Yes
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="rounded px-1.5 py-0.5 text-xs font-semibold text-gray-500 hover:bg-gray-100"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(category.id)}
                          className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500"
                          aria-label={`Delete ${category.name}`}
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  )}

                  {/* Expand / collapse — only when not renaming */}
                  {isActive && renamingId !== category.id && (
                    <button
                      type="button"
                      onClick={() => toggleExpanded(category.id)}
                      className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-900 ml-1"
                    >
                      {isExpanded ? (
                        <><ChevronUp size={14} /> Collapse</>
                      ) : (
                        <><ChevronDown size={14} /> {override?.definition || override?.criteria ? 'Edit' : 'Define'}</>
                      )}
                    </button>
                  )}
                </div>

                {/* Expanded fields */}
                {isActive && isExpanded && (
                  <div className="border-t border-gray-100 px-4 pb-4 pt-4 space-y-4">
                    {/* Default shown as reference */}
                    {defaultDesc && (
                      <div className="rounded-md bg-gray-50 border border-gray-200 px-3 py-2">
                        <p className="text-xs font-semibold text-gray-500 mb-0.5">Default definition</p>
                        <p className="text-sm text-gray-600">{defaultDesc}</p>
                      </div>
                    )}

                    {/* Organisation-specific: framework dropdown */}
                    {isOrganisationCategory(category.name) && (
                      <div>
                        <label className="block text-sm font-semibold text-gray-900 mb-1">
                          Organisational framework
                        </label>
                        <p className="text-xs text-gray-500 mb-1.5">
                          Select the framework this document type follows. The definition below will
                          be pre-filled — you can edit it freely.
                        </p>
                        <select
                          value={override?.frameworkKey ?? ''}
                          onChange={(e) => selectFramework(category.id, e.target.value)}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                        >
                          <option value="">— Select a framework —</option>
                          {ORGANISATION_FRAMEWORKS.map((f) => (
                            <option key={f.key} value={f.key}>{f.label}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* Definition override */}
                    <div>
                      <label className="block text-sm font-semibold text-gray-900 mb-1">
                        {isOrganisationCategory(category.name)
                          ? 'Framework description'
                          : <>Definition for <em>{documentTypeName}</em></>}
                      </label>
                      <p className="text-xs text-gray-500 mb-1.5">
                        {isOrganisationCategory(category.name)
                          ? 'Edit the framework description as needed for this document type. Leave blank to use the default.'
                          : `What does "${category.name}" mean specifically for this document type? Leave blank to use the default.`}
                      </p>
                      <textarea
                        value={override?.definition ?? ''}
                        onChange={(e) => setOverrideField(category.id, 'definition', e.target.value)}
                        placeholder={`e.g. For a ${documentTypeName}, ${category.name.toLowerCase()} means…`}
                        rows={3}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                      />
                    </div>

                    {/* Criteria / what good looks like */}
                    <div>
                      <label className="block text-sm font-semibold text-gray-900 mb-1">
                        Standard for this criterion
                      </label>
                      <p className="text-xs text-gray-500 mb-1.5">
                        Describe a strong {documentTypeName} for this criterion. The AI uses this as guidance when evaluating drafts.
                      </p>
                      <textarea
                        value={override?.criteria ?? ''}
                        onChange={(e) => setOverrideField(category.id, 'criteria', e.target.value)}
                        placeholder={`Describe what a well-scored ${category.name.toLowerCase()} looks like in a ${documentTypeName}…`}
                        rows={3}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Add custom criterion */}
        <div className="mt-3">
          {addingCustom ? (
            <div className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2">
              <input
                type="text"
                autoFocus
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && customName.trim()) addCategoryMutation.mutate(customName.trim());
                  if (e.key === 'Escape') { setAddingCustom(false); setCustomName(''); }
                }}
                placeholder="Criterion name…"
                className="flex-1 text-sm text-gray-900 outline-none placeholder-gray-400"
              />
              <button
                type="button"
                onClick={() => { if (customName.trim()) addCategoryMutation.mutate(customName.trim()); }}
                disabled={!customName.trim() || addCategoryMutation.isPending}
                className="text-xs font-semibold text-gray-900 hover:underline disabled:opacity-50"
              >
                Add
              </button>
              <button
                type="button"
                onClick={() => { setAddingCustom(false); setCustomName(''); }}
                className="text-gray-400 hover:text-gray-700"
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAddingCustom(true)}
              className="flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-900"
            >
              <Plus size={15} />
              Add custom criterion
            </button>
          )}
        </div>
      </div>

      {/* ── Save bar ───────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 border-t border-gray-200 pt-6">
        <button
          type="button"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          className="rounded-lg bg-gray-900 px-5 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saveMutation.isPending ? 'Saving…' : 'Save Rubric'}
        </button>
        {saveSuccess && (
          <span className="text-sm font-semibold text-green-600">Saved successfully</span>
        )}
        {saveMutation.isError && (
          <span className="text-sm font-semibold text-red-600">Error saving — please try again</span>
        )}
      </div>
    </div>
  );
}
