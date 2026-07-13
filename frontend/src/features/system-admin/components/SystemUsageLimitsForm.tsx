import { useState, useEffect } from 'react';

import { usageLimitsSchema, type UsageLimits } from '@/features/system-admin/systemAdminSchemas';

interface SystemUsageLimitsFormProps {
  initialData?: UsageLimits;
  onSubmit: (data: UsageLimits) => void;
  isLoading?: boolean;
}

export function SystemUsageLimitsForm({
  initialData,
  onSubmit,
  isLoading,
}: SystemUsageLimitsFormProps) {
  const [formData, setFormData] = useState<UsageLimits>(
    initialData || {
      messageLimit: 100,
      debriefGenerationLimit: 15,
      documentUploadLimit: 30,
      draftsPerDocumentLimit: 15,
    }
  );

  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (initialData) {
      setFormData(initialData);
    }
  }, [initialData]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    try {
      const validated = usageLimitsSchema.parse(formData);
      onSubmit(validated);
    } catch (error: any) {
      const fieldErrors: Record<string, string> = {};
      error.errors?.forEach((err: any) => {
        fieldErrors[err.path[0]] = err.message;
      });
      setErrors(fieldErrors);
    }
  };

  const inputClasses =
    'w-full rounded-lg border border-gray-300 px-4 py-2 text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900';

  return (
    <form onSubmit={handleSubmit}>
      <div className="space-y-6">
        <div>
          <label className="block text-sm font-semibold text-gray-900">
            LEON Message Limit per Document
          </label>
          <input
            type="number"
            min="1"
            value={formData.messageLimit}
            onChange={(e) =>
              setFormData({ ...formData, messageLimit: parseInt(e.target.value) })
            }
            className={inputClasses}
          />
          {errors.messageLimit && (
            <p className="mt-1 text-sm text-red-600">{errors.messageLimit}</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-900">
            Max AI Debrief Generations per Document
          </label>
          <input
            type="number"
            min="1"
            value={formData.debriefGenerationLimit}
            onChange={(e) =>
              setFormData({
                ...formData,
                debriefGenerationLimit: parseInt(e.target.value),
              })
            }
            className={inputClasses}
          />
          {errors.debriefGenerationLimit && (
            <p className="mt-1 text-sm text-red-600">
              {errors.debriefGenerationLimit}
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-900">
            Max number of Document Uploads
          </label>
          <input
            type="number"
            min="1"
            value={formData.documentUploadLimit}
            onChange={(e) =>
              setFormData({
                ...formData,
                documentUploadLimit: parseInt(e.target.value),
              })
            }
            className={inputClasses}
          />
          {errors.documentUploadLimit && (
            <p className="mt-1 text-sm text-red-600">
              {errors.documentUploadLimit}
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-900">
            Max number of Drafts per Document
          </label>
          <input
            type="number"
            min="1"
            value={formData.draftsPerDocumentLimit}
            onChange={(e) =>
              setFormData({
                ...formData,
                draftsPerDocumentLimit: parseInt(e.target.value),
              })
            }
            className={inputClasses}
          />
          {errors.draftsPerDocumentLimit && (
            <p className="mt-1 text-sm text-red-600">
              {errors.draftsPerDocumentLimit}
            </p>
          )}
        </div>

        <div className="flex items-start gap-2 rounded-lg bg-gray-50 p-3">
          <p className="text-sm text-gray-700">
            These usage limits will apply for all users across all departments in the system.
          </p>
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="rounded-lg bg-gray-900 px-6 py-2 font-semibold text-white hover:bg-gray-800 disabled:bg-gray-400"
        >
          {isLoading ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </form>
  );
}
