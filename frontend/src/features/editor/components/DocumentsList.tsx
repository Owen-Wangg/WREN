/**
 * Documents List - Task 3.3
 * Shows document cards with status, draft history, re-upload control
 */
import React from 'react';
import { useListDocuments } from '@/hooks';
import { format } from 'date-fns';

export interface DocumentsListProps {
  readonly onOpenDocument?: (documentId: string) => void;
  readonly onReupload?: (documentId: string) => void;
}

export function DocumentsList({ onOpenDocument, onReupload }: DocumentsListProps) {
  const { data: result, isLoading, isError } = useListDocuments();

  if (isLoading) return <div>Loading documents...</div>;
  if (isError) return <div>Error loading documents</div>;

  const documents = result?.items || [];

  if (documents.length === 0) {
    return <div style={{ padding: '2rem', textAlign: 'center' }}>No documents yet. Create one to get started.</div>;
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
      {documents.map((doc) => (
        <div
          key={doc.id}
          style={{
            border: '1px solid #ddd',
            borderRadius: '8px',
            padding: '1rem',
            cursor: 'pointer',
          }}
        >
          {/* Header */}
          <h3 style={{ margin: '0 0 0.5rem 0' }}>{doc.name}</h3>
          
          {/* Status badge */}
          <div
            style={{
              display: 'inline-block',
              padding: '0.25rem 0.75rem',
              borderRadius: '4px',
              fontSize: '0.85em',
              fontWeight: 'bold',
              backgroundColor: doc.status === 'Still Drafting' ? '#fff3cd' : '#d1ecf1',
              color: doc.status === 'Still Drafting' ? '#856404' : '#0c5460',
              marginBottom: '1rem',
            }}
          >
            {doc.status}
          </div>

          {/* Document type */}
          <p style={{ margin: '0.5rem 0', fontSize: '0.9em', color: '#666' }}>
            Type: {doc.documentTypeId}
          </p>

          {/* Metadata */}
          {Object.keys(doc.metadata).length > 0 && (
            <div style={{ margin: '0.5rem 0', fontSize: '0.85em' }}>
              {Object.entries(doc.metadata).map(([key, value]) => (
                <p key={key} style={{ margin: '0.25rem 0' }}>
                  <strong>{key}:</strong> {value}
                </p>
              ))}
            </div>
          )}

          {/* Draft history */}
          {/* Would show draft dropdown here - Task 3.3 */}

          {/* Actions */}
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
            <button
              onClick={() => onOpenDocument?.(doc.id)}
              style={{ flex: 1, padding: '0.5rem' }}
            >
              Edit
            </button>
            <button
              onClick={() => onReupload?.(doc.id)}
              style={{ flex: 1, padding: '0.5rem', backgroundColor: '#f0f0f0' }}
            >
              Re-upload
            </button>
          </div>

          {/* Timestamps */}
          <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.8em', color: '#999' }}>
            Created: {format(new Date(doc.createdAt), 'MMM d, yyyy h:mm a')}
          </p>
        </div>
      ))}
    </div>
  );
}
