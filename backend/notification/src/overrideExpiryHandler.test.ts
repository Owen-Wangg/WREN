import { checkOverrideExpiry } from './overrideExpiryHandler.js';
import type { NotificationServiceDeps } from './notificationService.js';

describe('checkOverrideExpiry', () => {
  it('queries the V4 override / document_type tables, not pre-V4 usage_override / writing_type', async () => {
    const captured: string[] = [];
    const db: NotificationServiceDeps = {
      query: async <Row>(text: string): Promise<Row[]> => {
        captured.push(text);
        return [];
      },
      execute: async () => 0,
    };

    await checkOverrideExpiry(db);

    expect(captured).toHaveLength(2);
    for (const sql of captured) {
      expect(sql).toMatch(/\bFROM override o\b/);
      expect(sql).toMatch(/\bJOIN document_type dt\b/);
      expect(sql).toMatch(/\bo\.document_type_id\b/);
      expect(sql).not.toMatch(/usage_override/);
      expect(sql).not.toMatch(/writing_type/);
      expect(sql).not.toMatch(/revoked_at/);
    }
  });

  it('emits override-expiring and override-expired events from matching rows', async () => {
    const db: NotificationServiceDeps = {
      query: async <Row>(text: string): Promise<Row[]> => {
        if (text.includes("o.expires_at > NOW()") && text.includes("INTERVAL '1 hour'")) {
          return [
            {
              id: 'ovr-1',
              granted_by: 'admin-1',
              document_type_id: 'dt-1',
              user_id: 'stu-1',
              expires_at: '2026-09-10T00:00:00.000Z',
              document_type_name: 'Memo',
              student_name: 'Ada Lovelace',
            },
          ] as Row[];
        }
        return [
          {
            id: 'ovr-2',
            granted_by: 'admin-2',
            document_type_id: 'dt-2',
            user_id: 'stu-2',
            expires_at: '2026-09-09T20:00:00.000Z',
            document_type_name: 'Factum',
            student_name: 'Alan Turing',
          },
        ] as Row[];
      },
      execute: async () => 0,
    };

    const events = await checkOverrideExpiry(db);
    expect(events).toEqual([
      {
        typeSlug: 'override-expiring',
        entityId: 'ovr-1',
        recipientUserId: 'admin-1',
        context: {
          overrideId: 'ovr-1',
          studentName: 'Ada Lovelace',
          documentTypeName: 'Memo',
        },
      },
      {
        typeSlug: 'override-expired',
        entityId: 'ovr-2',
        recipientUserId: 'admin-2',
        context: {
          overrideId: 'ovr-2',
          studentName: 'Alan Turing',
          documentTypeName: 'Factum',
        },
      },
    ]);
  });
});
