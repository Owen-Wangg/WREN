import { useState, useEffect } from 'react';

import { modelConfigSchema, type ModelConfig } from '@/features/system-admin/systemAdminSchemas';

interface ModelConfigurationFormProps {
  initialData?: ModelConfig;
  onSubmit: (data: ModelConfig) => void;
  isLoading?: boolean;
}

export function ModelConfigurationForm({
  initialData,
  onSubmit,
  isLoading,
}: ModelConfigurationFormProps) {
  const [formData, setFormData] = useState<ModelConfig>(
    initialData ?? { modelIdentifier: '' }
  );

  const [errors, setErrors] = useState<Record<string, string>>({});

  const availableModels = [
    { id: 'us.anthropic.claude-sonnet-4-6', name: 'Claude Sonnet 4.6 (cross-region)' },
    { id: 'us.anthropic.claude-haiku-4-5', name: 'Claude Haiku 4.5 (cross-region)' },
    { id: 'us.anthropic.claude-opus-4-8', name: 'Claude Opus 4.8 (cross-region)' },
  ];

  useEffect(() => {
    if (initialData) {
      setFormData(initialData);
    }
  }, [initialData]);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrors({});

    try {
      const validated = modelConfigSchema.parse(formData);
      onSubmit(validated);
    } catch (error: any) {
      const fieldErrors: Record<string, string> = {};
      error.errors?.forEach((err: any) => {
        fieldErrors[err.path[0]] = err.message;
      });
      setErrors(fieldErrors);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="space-y-6">
        <div>
          <label className="block text-sm font-semibold text-gray-900">
            Model Identifier
          </label>
          <p className="mb-3 text-sm text-gray-600">
            This model will be applied system-wide across all departments. The setting is applied at deploy time via the <code>BEDROCK_MODEL_ID</code> environment variable; contact your infrastructure team to apply a change.
          </p>
          <select
            value={formData.modelIdentifier}
            onChange={(e) => setFormData({ modelIdentifier: e.target.value })}
            className="w-full rounded-lg border border-gray-300 px-4 py-2 text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
          >
            <option value="">Select a model</option>
            {availableModels.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
          </select>
          {errors.modelIdentifier && (
            <p className="mt-1 text-sm text-red-600">{errors.modelIdentifier}</p>
          )}
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
