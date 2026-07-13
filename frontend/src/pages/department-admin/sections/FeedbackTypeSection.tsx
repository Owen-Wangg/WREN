import { useState } from 'react';

export interface FeedbackCategory {
  id: string;
  title: string;
  description: string;
}

interface FeedbackTypeSectionProps {
  feedbackCategories: FeedbackCategory[];
}

export function FeedbackTypeSection({
  feedbackCategories,
}: FeedbackTypeSectionProps) {
  // Mock: selected categories for this document type
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(
    new Set(['1', '2', '3', '4', '5', '6', '7'])
  );

  const toggleCategory = (categoryId: string) => {
    const newSelected = new Set(selectedCategories);
    if (newSelected.has(categoryId)) {
      newSelected.delete(categoryId);
    } else {
      newSelected.add(categoryId);
    }
    setSelectedCategories(newSelected);
  };

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Feedback Types</h1>
        <p className="mt-2 text-gray-600">
          Select which feedback categories are applicable for this document type. Students will receive feedback only in the selected categories.
        </p>
      </div>

      <div className="space-y-3">
        {feedbackCategories.map((category) => (
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
                <p className="font-semibold text-gray-900">{category.title}</p>
                <p className="mt-1 text-sm text-gray-600">{category.description}</p>
              </div>
            </label>
          </div>
        ))}
      </div>

      <div className="mt-8 flex gap-3">
        <button className="rounded-lg bg-gray-900 px-4 py-2 font-semibold text-white hover:bg-gray-800">
          Save Changes
        </button>
      </div>
    </div>
  );
}
