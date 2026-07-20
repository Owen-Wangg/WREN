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
    initialData || {
      modelIdentifier: '',
      temperature: 0.7,
      maxTokens: 2048,
    }
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

  const handleSubmit = (e: React.FormEvent) => {
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
            This model configuration will be applied system-wide across all departments.
          </p>
          <select
            value={formData.modelIdentifier}
            onChange={(e) =>
              setFormData({ ...formData, modelIdentifier: e.target.value })
            }
            className="w-full rounded-lg border border-gray-300 px-4 py-2 text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
          >
            <option value="">Select a model</option>
            {availableModels.map((model: any) => (
              <option key={model.id} value={model.id}>
                {model.name} ({model.id})
              </option>
            ))}
          </select>
          {errors.modelIdentifier && (
            <p className="mt-1 text-sm text-red-600">{errors.modelIdentifier}</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-900">Temperature</label>
          <input
            type="number"
            min="0"
            max="1"
            step="0.1"
            value={formData.temperature}
            onChange={(e) =>
              setFormData({ ...formData, temperature: parseFloat(e.target.value) })
            }
            className="w-full rounded-lg border border-gray-300 px-4 py-2 text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
          />
          {errors.temperature && (
            <p className="mt-1 text-sm text-red-600">{errors.temperature}</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-900">
            Max Tokens per Output
          </label>
          <input
            type="number"
            min="1"
            value={formData.maxTokens}
            onChange={(e) =>
              setFormData({ ...formData, maxTokens: parseInt(e.target.value) })
            }
            className="w-full rounded-lg border border-gray-300 px-4 py-2 text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
          />
          {errors.maxTokens && (
            <p className="mt-1 text-sm text-red-600">{errors.maxTokens}</p>
          )}
        </div>

        <div className="flex items-start gap-2 rounded-lg bg-gray-50 p-3">
          <p className="text-sm text-gray-700">
            These model settings will be applied across all document types and departments in the system.
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
