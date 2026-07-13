/**
 * Access & Roster Console - Task 6.2
 * Department Admin UI for managing access grants and viewing analytics
 *
 * - Scoped student search (identity fields only)
 * - Create/revoke access grants for document types
 * - Approve/deny access requests
 * - Department-scoped analytics
 */
import React, { useState } from 'react';
import { useAuth, useSearchUsers, useGrantAccessToUser, useRevokeAccessGrant, useGetAnalytics } from '@/hooks';

export interface AccessRosterConsoleProps {
  readonly departmentId: string;
}

export function AccessRosterConsole({ departmentId }: AccessRosterConsoleProps) {
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDocumentTypeId, setSelectedDocumentTypeId] = useState('');

  const searchUsers = useSearchUsers(departmentId, searchQuery);
  const grantAccess = useGrantAccessToUser();
  const revokeAccess = useRevokeAccessGrant();
  const analyticsQuery = useGetAnalytics(departmentId, selectedDocumentTypeId);

  const handleGrantAccess = async (userId: string, documentTypeId: string) => {
    try {
      await grantAccess.mutateAsync({
        userId,
        documentTypeId,
        departmentId,
      });
    } catch (err) {
      console.error('Failed to grant access:', err);
    }
  };

  const handleRevokeAccess = async (grantId: string) => {
    if (!confirm('Revoke access grant?')) return;
    try {
      await revokeAccess.mutateAsync({ grantId, departmentId });
    } catch (err) {
      console.error('Failed to revoke access:', err);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 600, margin: 0 }}>
        Access & Roster Management
      </h2>

      {/* Student Search Section */}
      <div style={{ border: '1px solid #ddd', borderRadius: '4px', padding: '1.5rem' }}>
        <h3 style={{ margin: '0 0 1rem 0', fontWeight: 600 }}>
          Search Students
        </h3>
        <p style={{ color: '#666', fontSize: '0.9em', margin: '0 0 1rem 0' }}>
          Search by name or email. Only identity information is displayed.
        </p>

        <input
          type="text"
          placeholder="Search by first name, last name, or email..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            width: '100%',
            padding: '0.75rem',
            border: '1px solid #ddd',
            borderRadius: '4px',
            marginBottom: '1rem',
          }}
        />

        {searchUsers.isLoading && <p>Loading...</p>}
        {searchUsers.isError && (
          <p style={{ color: 'red' }}>Error searching users</p>
        )}
        {searchUsers.data && searchUsers.data.length === 0 && searchQuery && (
          <p style={{ color: '#999' }}>No students found</p>
        )}

        {searchUsers.data && searchUsers.data.length > 0 && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem',
              maxHeight: '300px',
              overflowY: 'auto',
            }}
          >
            {searchUsers.data.map((student) => (
              <div
                key={student.userId}
                style={{
                  padding: '0.75rem',
                  border: '1px solid #e0e0e0',
                  borderRadius: '4px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <p style={{ margin: 0, fontWeight: 600 }}>
                    {student.firstName} {student.lastName}
                  </p>
                  <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.9em', color: '#666' }}>
                    {student.email}
                  </p>
                </div>
                <button
                  onClick={() =>
                    handleGrantAccess(student.userId, selectedDocumentTypeId)
                  }
                  disabled={!selectedDocumentTypeId || grantAccess.isPending}
                  style={{
                    padding: '0.5rem 1rem',
                    backgroundColor: selectedDocumentTypeId ? '#0066cc' : '#ccc',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: selectedDocumentTypeId ? 'pointer' : 'not-allowed',
                  }}
                >
                  Grant Access
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Analytics Section */}
      <div style={{ border: '1px solid #ddd', borderRadius: '4px', padding: '1.5rem' }}>
        <h3 style={{ margin: '0 0 1rem 0', fontWeight: 600 }}>
          Department Analytics
        </h3>

        {analyticsQuery.isLoading && <p>Loading analytics...</p>}
        {analyticsQuery.isError && (
          <p style={{ color: 'red' }}>Error loading analytics</p>
        )}
        {analyticsQuery.data && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', gap: '2rem' }}>
              <div>
                <p style={{ margin: 0, color: '#666', fontSize: '0.9em' }}>
                  Total Documents
                </p>
                <p style={{ margin: '0.25rem 0 0 0', fontSize: '1.5em', fontWeight: 600 }}>
                  {analyticsQuery.data.totalDocuments}
                </p>
              </div>
              <div>
                <p style={{ margin: 0, color: '#666', fontSize: '0.9em' }}>
                  Submitted
                </p>
                <p style={{ margin: '0.25rem 0 0 0', fontSize: '1.5em', fontWeight: 600 }}>
                  {analyticsQuery.data.submitted}
                </p>
              </div>
              <div>
                <p style={{ margin: 0, color: '#666', fontSize: '0.9em' }}>
                  In Progress
                </p>
                <p style={{ margin: '0.25rem 0 0 0', fontSize: '1.5em', fontWeight: 600 }}>
                  {analyticsQuery.data.inProgress}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
