/**
 * Reference Material Manager - Task 5.1
 * Department Admin UI for managing two-tier reference materials
 *
 * Tier 1: Department-wide materials (visible across all document types)
 * Tier 2: Document-Type-scoped materials (visible only for that type)
 */
import React, { useState } from 'react';
import { Trash2, Upload } from 'lucide-react';
import {
  useListDepartmentReferenceMaterial,
  useCreateDepartmentReferenceMaterial,
  useDeleteDepartmentReferenceMaterial,
  useListDocumentTypeReferenceMaterial,
  useCreateDocumentTypeReferenceMaterial,
  useDeleteDocumentTypeReferenceMaterial,
} from '@/hooks';
import type { ReferenceMaterial, CreateReferenceMaterialInput } from '@wren/types';

export interface ReferenceMaterialManagerProps {
  readonly departmentId: string;
  readonly documentTypeId?: string;
}

export function ReferenceMaterialManager({
  departmentId,
  documentTypeId,
}: ReferenceMaterialManagerProps) {
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Department-wide materials (tier 1)
  const deptMaterialsQuery = useListDepartmentReferenceMaterial(departmentId);
  const createDeptMaterial = useCreateDepartmentReferenceMaterial(departmentId);
  const deleteDeptMaterial = useDeleteDepartmentReferenceMaterial(departmentId);

  // Document-type-scoped materials (tier 2)
  const typeMaterialsQuery = documentTypeId
    ? useListDocumentTypeReferenceMaterial(departmentId, documentTypeId)
    : null;
  const createTypeMaterial = documentTypeId
    ? useCreateDocumentTypeReferenceMaterial(departmentId, documentTypeId)
    : null;
  const deleteTypeMaterial = documentTypeId
    ? useDeleteDocumentTypeReferenceMaterial(departmentId, documentTypeId)
    : null;

  const handleCreateMaterial = async (input: CreateReferenceMaterialInput) => {
    try {
      setFormError(null);
      if (documentTypeId && createTypeMaterial) {
        await createTypeMaterial.mutateAsync(input);
      } else {
        await createDeptMaterial.mutateAsync(input);
      }
      setShowForm(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create material');
    }
  };

  const handleDeleteMaterial = async (materialId: string) => {
    if (!confirm('Delete this reference material?')) return;
    try {
      if (documentTypeId && deleteTypeMaterial) {
        await deleteTypeMaterial.mutateAsync(materialId);
      } else {
        await deleteDeptMaterial.mutateAsync(materialId);
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to delete material');
    }
  };

  const isLoading = deptMaterialsQuery.isLoading || typeMaterialsQuery?.isLoading;
  const materials = documentTypeId
    ? typeMaterialsQuery?.data ?? []
    : deptMaterialsQuery.data ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>
            Reference Materials
          </h3>
          <p style={{ fontSize: '0.9em', color: '#666', margin: '0.5rem 0 0' }}>
            {documentTypeId
              ? 'Document-type-scoped materials (Tier 2)'
              : 'Department-wide materials (Tier 1)'}
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.5rem 1rem',
            backgroundColor: '#0066cc',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          <Upload size={16} />
          Add Material
        </button>
      </div>

      {/* Upload Form */}
      {showForm && (
        <ReferenceMaterialForm
          onSubmit={handleCreateMaterial}
          onCancel={() => setShowForm(false)}
          isLoading={createDeptMaterial.isPending || createTypeMaterial?.isPending}
          error={formError}
        />
      )}

      {/* Error display */}
      {deptMaterialsQuery.isError && (
        <div style={{ padding: '1rem', backgroundColor: '#ffe0e0', color: '#cc0000', borderRadius: '4px' }}>
          Failed to load materials
        </div>
      )}

      {/* Materials list */}
      {isLoading ? (
        <p>Loading materials...</p>
      ) : materials.length === 0 ? (
        <p style={{ color: '#999' }}>No reference materials yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {materials.map((material) => (
            <MaterialCard
              key={material.id}
              material={material}
              onDelete={() => handleDeleteMaterial(material.id)}
              isDeleting={
                deleteDeptMaterial.isPending || deleteTypeMaterial?.isPending
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Material Card Component */
/* -------------------------------------------------------------------------- */

interface MaterialCardProps {
  readonly material: ReferenceMaterial;
  readonly onDelete: () => void;
  readonly isDeleting: boolean;
}

function MaterialCard({ material, onDelete, isDeleting }: MaterialCardProps) {
  return (
    <div
      style={{
        padding: '1rem',
        border: '1px solid #ddd',
        borderRadius: '4px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
      }}
    >
      <div style={{ flex: 1 }}>
        <h4 style={{ margin: '0 0 0.5rem 0', fontWeight: 600 }}>
          {material.title}
        </h4>
        {material.section && (
          <p style={{ margin: '0 0 0.5rem 0', color: '#666', fontSize: '0.9em' }}>
            Section: {material.section}
          </p>
        )}
        <div style={{ display: 'flex', gap: '1rem', fontSize: '0.85em', color: '#999' }}>
          <span>
            {material.contentKind === 'file' ? '📄 File' : '📝 Text'}
          </span>
          {material.embeddingId && <span>✓ Indexed</span>}
        </div>
      </div>
      <button
        onClick={onDelete}
        disabled={isDeleting}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '0.5rem',
          backgroundColor: '#ff4444',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
          opacity: isDeleting ? 0.6 : 1,
        }}
      >
        <Trash2 size={16} />
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Upload Form Component */
/* -------------------------------------------------------------------------- */

interface ReferenceMaterialFormProps {
  readonly onSubmit: (input: CreateReferenceMaterialInput) => Promise<void>;
  readonly onCancel: () => void;
  readonly isLoading: boolean;
  readonly error: string | null;
}

function ReferenceMaterialForm({
  onSubmit,
  onCancel,
  isLoading,
  error,
}: ReferenceMaterialFormProps) {
  const [title, setTitle] = useState('');
  const [section, setSection] = useState('');
  const [contentKind, setContentKind] = useState<'file' | 'text' | 'html'>('text');
  const [s3Key, setS3Key] = useState('');
  const [inlineContent, setInlineContent] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    // Validation
    if (!title.trim()) {
      setValidationError('Title is required');
      return;
    }

    if (contentKind === 'file') {
      if (!s3Key.trim()) {
        setValidationError('S3 key is required for file uploads');
        return;
      }
    } else {
      if (!inlineContent.trim()) {
        setValidationError('Content is required');
        return;
      }
    }

    try {
      await onSubmit({
        tier: 'department',
        departmentId: '', // Will be set by API
        title: title.trim(),
        section: section.trim() || null,
        contentKind,
        s3Key: contentKind === 'file' ? s3Key.trim() : null,
        inlineContent: contentKind !== 'file' ? inlineContent.trim() : null,
      });

      setTitle('');
      setSection('');
      setContentKind('text');
      setS3Key('');
      setInlineContent('');
    } catch (err) {
      // Error handled by parent
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        padding: '1.5rem',
        border: '1px solid #ddd',
        borderRadius: '4px',
        backgroundColor: '#f9f9f9',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {/* Title */}
        <div>
          <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.5rem' }}>
            Title *
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g., MLA Handbook 2024"
            style={{
              width: '100%',
              padding: '0.5rem',
              border: '1px solid #ddd',
              borderRadius: '4px',
            }}
          />
        </div>

        {/* Section */}
        <div>
          <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.5rem' }}>
            Section (optional)
          </label>
          <input
            type="text"
            value={section}
            onChange={(e) => setSection(e.target.value)}
            placeholder="e.g., Chapter 3: In-Text Citations"
            style={{
              width: '100%',
              padding: '0.5rem',
              border: '1px solid #ddd',
              borderRadius: '4px',
            }}
          />
        </div>

        {/* Content Kind */}
        <div>
          <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.5rem' }}>
            Content Type *
          </label>
          <select
            value={contentKind}
            onChange={(e) => setContentKind(e.target.value as any)}
            style={{
              width: '100%',
              padding: '0.5rem',
              border: '1px solid #ddd',
              borderRadius: '4px',
            }}
          >
            <option value="text">Plain Text</option>
            <option value="html">Rich HTML</option>
            <option value="file">S3 File</option>
          </select>
        </div>

        {/* Content input */}
        {contentKind === 'file' ? (
          <div>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.5rem' }}>
              S3 Key *
            </label>
            <input
              type="text"
              value={s3Key}
              onChange={(e) => setS3Key(e.target.value)}
              placeholder="s3://bucket/path/to/file.pdf"
              style={{
                width: '100%',
                padding: '0.5rem',
                border: '1px solid #ddd',
                borderRadius: '4px',
              }}
            />
          </div>
        ) : (
          <div>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.5rem' }}>
              Content *
            </label>
            <textarea
              value={inlineContent}
              onChange={(e) => setInlineContent(e.target.value)}
              placeholder="Paste your reference material here..."
              rows={6}
              style={{
                width: '100%',
                padding: '0.5rem',
                border: '1px solid #ddd',
                borderRadius: '4px',
                fontFamily: 'monospace',
                fontSize: '0.9em',
              }}
            />
          </div>
        )}

        {/* Errors */}
        {validationError && (
          <div style={{ padding: '0.5rem', backgroundColor: '#ffe0e0', color: '#cc0000', borderRadius: '4px' }}>
            {validationError}
          </div>
        )}
        {error && (
          <div style={{ padding: '0.5rem', backgroundColor: '#ffe0e0', color: '#cc0000', borderRadius: '4px' }}>
            {error}
          </div>
        )}

        {/* Buttons */}
        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: '#e0e0e0',
              color: '#333',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isLoading}
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: '#0066cc',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              opacity: isLoading ? 0.6 : 1,
            }}
          >
            {isLoading ? 'Uploading...' : 'Add Material'}
          </button>
        </div>
      </div>
    </form>
  );
}
