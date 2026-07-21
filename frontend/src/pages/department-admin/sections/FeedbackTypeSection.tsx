import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listErrorCategories,
  createErrorCategory,
  updateDocumentTypeConfig,
} from '@/features/department-admin/departmentAdminApi';

interface FeedbackTypeSectionProps {
  documentTypeId: string;
}

const DEFAULT_CATEGORIES = [
  { name: 'Spelling/Grammar', description: 'Spelling errors, grammatical mistakes, and punctuation issues' },
  { name: 'Tone', description: 'Formality, professionalism, and authority of language appropriate for legal writing' },
  { name: 'Clarity', description: 'How clear, precise, and understandable the writing is; avoiding ambiguity' },
  { name: 'Consistency/Coherence', description: 'Logical consistency, coherent arguments, and maintaining parallel structure' },
  { name: 'Persuasiveness', description: 'Strength of arguments, evidence support, and persuasive impact' },
  { name: 'Objectivity/Neutrality', description: 'Maintaining neutral language and avoiding bias in legal writing' },
  { name: 'Organization', description: 'Structure, logical flow, proper section organization, and document layout' },
];

export function FeedbackTypeSection({ documentTypeId }: FeedbackTypeSectionProps) {
  const queryClient = useQueryClient();
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [isSeeding, setIsSeeding] = useState(false);

  const { data: categories = [], isLoading } = useQuery({
    queryKey: ['error-categories', documentTypeId],
    queryFn: () => listErrorCategories(documentTypeId),
  });

  // Auto-seed default categories when the list is empty
  useEffect(() => {
    if (!isLoading && categories.length === 0 && !isSeeding) {
      setIsSeeding(true);
      const seed = async () => {
        for (const cat of DEFAULT_CATEGORIES) {
          await createErrorCategory(documentTypeId, cat.name);
        }
        await queryClient.invalidateQueries({ queryKey: ['error-categories', documentTypeId] });
        setIsSeeding(false);
      };
      void seed();
    }
  }, [isLoading, categories.length, documentTypeId, queryClient, isSeeding]);

  // Once categories load, default all to selected if no priority saved
  useEffect(() => {
    if (categories.length > 0) {
      setSelectedCategories(new Set(categories.map((c) => c.id)));
    }
  }, [categories]);

  const saveMutation = useMutation({
    mutationFn: (categoryIds: string[]) =>
      updateDocumentTypeConfig(documentTypeId, { categoryPriority: categoryIds }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['document-type-config', documentTypeId] });
    },
  });

  const toggleCategory = (categoryId: string) => {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  };

  const handleSave = () => {
    saveMutation.mutate(Array.from(selectedCategories));
  };

  if (isLoading || isSeeding) {
    return (
      <div>
        <h1 className="mb-4 text-3xl font-bold text-gray-900">Feedback Types</h1>
        <p className="text-sm text-gray-600">
          {isSeeding ? 'Setting up default feedback categories…' : 'Loading…'}
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Feedback Types</h1>
        <p className="mt-2 text-gray-600">
          Select which feedback categories are applicable for this document type.
          Students will receive feedback only in the selected categories.
        </p>
      </div>

      <div className="space-y-3">
        {categories.map((category) => (
          <div
            key={category.id}
            className="rounded-lg border border-gray-200 bg-white p-4 hover:border-gray-300"
          >
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={selectedCategories.has(category.id)}
                onChange={() => toggleCategory(category.id)}
                className="mt-1 h-5 w-5 rounded border-gray-300 text-gray-900 focus:ring-gray-900"
              />
              <div>
                <p className="font-semibold text-gray-900">{category.name}</p>
              </div>
            </label>
          </div>
        ))}
      </div>

      <div className="mt-8 flex gap-3">
        <button
          onClick={handleSave}
          disabled={saveMutation.isPending}
          className="rounded-lg bg-gray-900 px-4 py-2 font-semibold text-white hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saveMutation.isPending ? 'Saving...' : 'Save Changes'}
        </button>
        {saveMutation.isSuccess && (
          <span className="text-green-600 font-semibold">Saved successfully!</span>
        )}
        {saveMutation.isError && (
          <span className="text-red-600 font-semibold">Error saving changes</span>
        )}
      </div>
    </div>
  );
}
