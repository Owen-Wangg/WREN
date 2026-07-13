import { useState } from 'react';
import { X, Edit2, Trash2, Plus } from 'lucide-react';

export interface FeedbackCategory {
  id: string;
  title: string;
  description: string;
}

interface ManageFeedbackCategoriesModalProps {
  isOpen: boolean;
  onClose: () => void;
  categories: FeedbackCategory[];
  onAddCategory: (category: Omit<FeedbackCategory, 'id'>) => void;
  onUpdateCategory: (id: string, category: Omit<FeedbackCategory, 'id'>) => void;
  onDeleteCategory: (id: string) => void;
}

export function ManageFeedbackCategoriesModal({
  isOpen,
  onClose,
  categories,
  onAddCategory,
  onUpdateCategory,
  onDeleteCategory,
}: ManageFeedbackCategoriesModalProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [editingDescription, setEditingDescription] = useState('');
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');

  if (!isOpen) return null;

  const handleStartEdit = (category: FeedbackCategory) => {
    setEditingId(category.id);
    setEditingTitle(category.title);
    setEditingDescription(category.description);
  };

  const handleSaveEdit = () => {
    if (editingId && editingTitle.trim()) {
      onUpdateCategory(editingId, {
        title: editingTitle.trim(),
        description: editingDescription.trim(),
      });
      setEditingId(null);
    }
  };

  const handleAddNew = () => {
    if (newTitle.trim()) {
      onAddCategory({
        title: newTitle.trim(),
        description: newDescription.trim(),
      });
      setNewTitle('');
      setNewDescription('');
      setIsAddingNew(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-20">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-lg bg-white p-8">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-2xl font-semibold text-gray-900">Manage Feedback Categories</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <X size={24} />
          </button>
        </div>

        {/* Existing Categories */}
        <div className="mb-8 space-y-4">
          {categories.map((category) => (
            <div
              key={category.id}
              className="rounded-lg border border-gray-200 bg-gray-50 p-4"
            >
              {editingId === category.id ? (
                <div className="space-y-4">
                  <input
                    type="text"
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 font-semibold text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                    placeholder="Category title"
                  />
                  <textarea
                    value={editingDescription}
                    onChange={(e) => setEditingDescription(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                    placeholder="Category description"
                    rows={3}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleSaveEdit}
                      className="rounded-lg bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-800"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-100"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-gray-900">{category.title}</h3>
                    <p className="mt-1 text-sm text-gray-600">{category.description}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleStartEdit(category)}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      <Edit2 size={18} />
                    </button>
                    <button
                      onClick={() => onDeleteCategory(category.id)}
                      className="text-gray-400 hover:text-red-500"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Add New Category */}
        {isAddingNew ? (
          <div className="rounded-lg border border-gray-300 bg-white p-4">
            <div className="space-y-4">
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 font-semibold text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                placeholder="Category title"
              />
              <textarea
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                placeholder="Category description"
                rows={3}
              />
              <div className="flex gap-2">
                <button
                  onClick={handleAddNew}
                  className="rounded-lg bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-800"
                >
                  Add Category
                </button>
                <button
                  onClick={() => {
                    setIsAddingNew(false);
                    setNewTitle('');
                    setNewDescription('');
                  }}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-100"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setIsAddingNew(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 font-semibold text-gray-900 hover:bg-gray-100"
          >
            <Plus size={18} />
            Add New Category
          </button>
        )}

        <div className="mt-8 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2 font-semibold text-gray-900 hover:bg-gray-100"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
