# Implementation Plan: In-App Notifications

## Overview

This plan converts the in-app-notifications design into incremental, code-focused steps on top of the existing WREN platform. It touches five areas in dependency order: (1) RDS PostgreSQL schema migrations for `notification_type` and `notification` tables, (2) the Notification Lambda (Node 22 TypeScript) including recipient resolution, deduplication, template rendering, and AppSync publishing, (3) CDK infrastructure additions (SNS topic, SQS queue + DLQ, Lambda, EventBridge rule, AppSync schema extensions), (4) REST API endpoints on the existing API Gateway for inbox operations and catalog management, and (5) React frontend components (NotificationBell, NotificationInbox, NotificationToast, etc.) with AppSync subscription hooks.

Implementation language is TypeScript throughout — Node 22 for backend services and React + TypeScript for the frontend — as specified in the design document.

Property-based tests (one per design property, Properties 1–15) are optional sub-tasks marked `*`, tagged `Feature: in-app-notifications, Property N`, and run ≥100 iterations using fast-check. Unit and integration tests are also optional sub-tasks marked `*`.

## Tasks

- [ ] 1. Database schema and seed data
  - [ ] 1.1 Write migration for `notification_type` table
    - Create `notification_type` table with columns: `id` (UUID PK), `slug` (VARCHAR(100) UNIQUE), `label` (VARCHAR(255)), `display_template` (TEXT), `action_url_template` (TEXT nullable), `target_roles` (JSONB), `dedup_strategy` (JSONB), `created_at` (TIMESTAMPTZ), `updated_at` (TIMESTAMPTZ)
    - Add index `idx_notification_type_slug` on `slug`
    - Register via the existing migration runner's sequential-numbering convention
    - _Requirements: 5.1, 5.4_

  - [ ] 1.2 Write migration for `notification` table
    - Create `notification` table with columns: `id` (UUID PK), `notification_type_id` (UUID FK → notification_type), `recipient_user_id` (UUID FK → app_user), `state` (VARCHAR(20) CHECK IN ('unread','read','dismissed') DEFAULT 'unread'), `rendered_content` (TEXT), `action_url` (TEXT nullable), `dedup_key` (VARCHAR(512) nullable), `context` (JSONB nullable), `created_at` (TIMESTAMPTZ DEFAULT NOW()), `read_at` (TIMESTAMPTZ nullable), `dismissed_at` (TIMESTAMPTZ nullable)
    - Add partial index `idx_notification_inbox` on `(recipient_user_id, created_at DESC) WHERE state != 'dismissed'`
    - Add partial index `idx_notification_unread` on `(recipient_user_id) WHERE state = 'unread'`
    - Add unique partial index `idx_notification_dedup` on `(dedup_key) WHERE dedup_key IS NOT NULL AND state != 'dismissed'`
    - _Requirements: 12.1, 12.2, 16.1, 16.2_

  - [ ] 1.3 Write seed migration for initial notification_type catalog entries
    - Insert all 19 notification types from the design document's seed data table (ai-debrief-ready through model-config-change-confirmation)
    - Each entry includes slug, label, display_template, action_url_template, target_roles, and dedup_strategy
    - _Requirements: 5.1, 5.2, 9.1–9.8, 10.1–10.7, 11.1–11.7_

  - [ ]* 1.4 Write unit tests for migration safety
    - Verify migrations apply cleanly on a fresh database
    - Verify seed data passes no-leak validation for all Student-targeted types
    - Verify dedup index uniqueness constraint works as expected
    - _Requirements: 7.1, 7.2, 16.1_

- [ ] 2. Notification Lambda — core logic
  - [ ] 2.1 Create Notification Lambda project structure and interfaces
    - Create `backend/notification/` directory with `package.json`, `tsconfig.json`, and `src/` layout
    - Define TypeScript interfaces: `NotificationEvent`, `NotificationService`, `InboxOptions`, `PaginatedInbox`, `NotificationView`, `ProcessResult`
    - Set up `postgres` client module for RDS Proxy connection (TLS required)
    - _Requirements: 12.1, 12.5_

  - [ ] 2.2 Implement recipient resolution logic
    - Query `role_assignment` and `department` tables to resolve recipients based on Notification_Type's `target_roles` and event context (`departmentId`, `documentTypeId`, `recipientUserId`)
    - For Department Admin types: resolve all admins whose scope includes the relevant department
    - For Technical Admin types: resolve all users with TechnicalAdmin role
    - For single-recipient types (Student): use explicit `recipientUserId` from event
    - Never resolve from IdP claims or client state
    - _Requirements: 6.1, 6.2, 6.4, 6.5, 12.5_

  - [ ]* 2.3 Write property test for recipient resolution
    - **Property 6: Recipient resolution correctness**
    - **Validates: Requirements 5.3, 6.1, 6.3, 6.4, 6.5, 12.5**

  - [ ] 2.4 Implement lifecycle state machine
    - Implement `transitionState(notificationId, userId, newState)` with valid transitions: `unread→read`, `unread→dismissed`, `read→dismissed`
    - Reject invalid transitions with 409 Conflict
    - Make transitions idempotent — repeating an already-applied transition returns success
    - Set `read_at` timestamp on `unread→read`, `dismissed_at` on `→dismissed`
    - Never modify `created_at`
    - _Requirements: 12.2, 12.3, 12.4, 14.3, 4.4, 4.5_

  - [ ]* 2.5 Write property test for lifecycle state machine
    - **Property 5: Lifecycle state machine validity**
    - **Validates: Requirements 12.2, 12.3, 12.4, 14.3, 4.4, 4.5**

  - [ ] 2.6 Implement deduplication logic
    - Implement `buildDedupKey(typeSlug, recipientUserId, entityId, dedupStrategy)` per design
    - Use `INSERT ... ON CONFLICT DO NOTHING` on the `dedup_key` partial unique index
    - Return success silently on dedup collision (expected behavior, not error)
    - _Requirements: 16.1, 16.2, 16.3_

  - [ ]* 2.7 Write property test for deduplication
    - **Property 10: Deduplication enforcement**
    - **Validates: Requirements 16.1, 16.2, 15.3**

  - [ ] 2.8 Implement template rendering and content sanitization
    - Interpolate event context into Notification_Type's `display_template` (mustache-style `{{placeholder}}`)
    - Sanitize all dynamic values via HTML entity encoding to prevent XSS
    - On missing placeholder value: render with placeholder name visible, log warning, still persist
    - Store `rendered_content` at creation time — never re-resolve at display time
    - _Requirements: 18.1, 18.3_

  - [ ]* 2.9 Write property test for content sanitization
    - **Property 15: Content sanitization**
    - **Validates: Requirements 19.1, 19.2**

  - [ ]* 2.10 Write property test for stored content resilience
    - **Property 14: Stored content resilience**
    - **Validates: Requirements 18.1, 18.3**

- [ ] 3. Checkpoint — Core Notification Lambda logic
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Notification Lambda — event processing and publishing
  - [ ] 4.1 Implement `processEvent` handler (SQS message processing)
    - Parse SQS message body as `NotificationEvent`
    - Validate `typeSlug` exists in `notification_type` catalog (reject with error if not)
    - Resolve recipients, render template, compute dedup key
    - Insert notification rows (one per recipient) with `unread` state
    - Publish to AppSync `publishNotification` mutation (IAM auth) for each recipient
    - Handle AppSync publish failure gracefully (log, don't retry — persistence is the guarantee)
    - _Requirements: 3.1, 3.6, 4.1, 5.4, 5.5, 12.1_

  - [ ]* 4.2 Write property test for type catalog referential integrity
    - **Property 7: Type catalog referential integrity**
    - **Validates: Requirements 5.4, 5.5**

  - [ ]* 4.3 Write property test for persistent creation with unread state
    - **Property 4: Persistent creation with unread state**
    - **Validates: Requirements 3.6, 4.1**

  - [ ]* 4.4 Write property test for in-app-only delivery invariant
    - **Property 1: In-app-only delivery invariant**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4**

  - [ ] 4.5 Implement inbox query with pagination and filtering
    - Implement `getInbox(userId, options)` with keyset pagination (cursor-based, default limit 20, max 100)
    - Support `stateFilter` for filtering by `unread` or `read`
    - Order by `created_at DESC` (most recent first)
    - Return `nextCursor` when more results exist
    - Include `unreadCount` in response
    - Query only notifications where `recipient_user_id = userId` (server-side scoping)
    - _Requirements: 2.3, 13.1, 13.4, 6.4_

  - [ ]* 4.6 Write property test for pagination and filtering
    - **Property 11: Pagination and filtering correctness**
    - **Validates: Requirements 13.1, 13.4**

  - [ ]* 4.7 Write property test for inbox ordering
    - **Property 2: Inbox ordering**
    - **Validates: Requirements 2.3**

  - [ ] 4.8 Implement bulk operations (mark all read, dismiss all)
    - Implement `bulkTransition(userId, 'markAllRead')`: transition all `unread` → `read`
    - Implement `bulkTransition(userId, 'dismissAll')`: transition all `unread` and `read` → `dismissed`
    - Respect lifecycle state machine rules (no transition out of `dismissed`)
    - Return count of affected notifications
    - _Requirements: 13.2, 13.3_

  - [ ]* 4.9 Write property test for bulk operation completeness
    - **Property 12: Bulk operation completeness**
    - **Validates: Requirements 13.2, 13.3**

  - [ ] 4.10 Implement unread count endpoint
    - Implement `getUnreadCount(userId)` querying `idx_notification_unread` partial index
    - Return integer count of notifications with `state = 'unread'` for the user
    - _Requirements: 2.5_

  - [ ]* 4.11 Write property test for unread count accuracy
    - **Property 3: Unread count accuracy**
    - **Validates: Requirements 2.5**

- [ ] 5. Notification_Type catalog service
  - [ ] 5.1 Implement catalog CRUD in Admin Lambda
    - Add `NotificationTypeCatalogService` to the existing admin service
    - Implement `create`, `update`, `list` operations
    - Restrict create/update to Technical Admin via existing capability guard
    - On create/update: run no-leak validation when `targetRoles` includes `Student`
    - Log catalog changes via Audit_Service (activity-log entry)
    - _Requirements: 5.1, 5.2, 17.1, 17.2, 17.3_

  - [ ] 5.2 Implement no-leak validation logic
    - Validate `displayTemplate` against numeric placeholder patterns (score, count, total, number, quantity, etc.)
    - Reject with 422 identifying offending placeholder(s) when Student-targeted type contains numeric patterns
    - Apply on both create and update operations
    - _Requirements: 7.1, 7.4, 17.2_

  - [ ]* 5.3 Write property test for no-leak validation
    - **Property 8: No-leak validation for Student-targeted types**
    - **Validates: Requirements 7.1, 7.4**

  - [ ]* 5.4 Write property test for catalog authorization
    - **Property 13: Catalog authorization**
    - **Validates: Requirements 17.1**

  - [ ]* 5.5 Write property test for audit independence
    - **Property 9: Audit independence**
    - **Validates: Requirements 8.1, 8.3**

- [ ] 6. Checkpoint — Backend services complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. CDK infrastructure additions
  - [ ] 7.1 Add SNS topic and SQS queue with DLQ to Compute stack
    - Create `${StackPrefix}-notification-events` SNS topic
    - Create `${StackPrefix}-notification-queue` SQS queue subscribed to the SNS topic
    - Create DLQ with 14-day retention
    - Set max receive count to 3 before DLQ routing
    - Set visibility timeout to 30 seconds
    - _Requirements: 3.1_

  - [ ] 7.2 Add Notification Lambda to Compute stack
    - Create Node 22 Lambda function for notification processing
    - Wire SQS queue as event source
    - Grant IAM permissions: RDS Proxy connect, AppSync mutation invoke, SSM parameter read
    - Configure environment variables: RDS Proxy endpoint, AppSync API URL, SSM parameter paths
    - _Requirements: 3.1, 6.1_

  - [ ] 7.3 Add EventBridge scheduled rule for override expiry checks
    - Create EventBridge rule running every 15 minutes
    - Target: Notification Lambda with a distinct event type for override-expiry scanning
    - Query for overrides within configured expiration warning window
    - _Requirements: 10.6, 10.7_

  - [ ] 7.4 Extend AppSync schema with notification mutations and subscriptions
    - Add `NotificationPayload` and `NotificationStateChange` types
    - Add `publishNotification` mutation (IAM auth)
    - Add `publishNotificationStateChange` mutation (IAM auth)
    - Add `onNotification(recipientUserId)` subscription (Lambda auth)
    - Add `onNotificationStateChange(recipientUserId)` subscription (Lambda auth)
    - _Requirements: 3.1, 3.2, 14.1, 14.2_

  - [ ] 7.5 Broaden AppSync Lambda authorizer for notification subscriptions
    - Extend `appSyncAuthorizer.ts` to handle `onNotification` and `onNotificationStateChange` subscription types
    - Authorize any authenticated role (Student, DepartmentAdmin, TechnicalAdmin)
    - Enforce `recipientUserId === context.userId` — user can only subscribe to their own stream
    - _Requirements: 6.2, 6.4_

  - [ ] 7.6 Add REST API routes for notification endpoints
    - Add routes to existing API Gateway: `GET /notifications`, `GET /notifications/unread-count`, `PATCH /notifications/{id}`, `POST /notifications/bulk`, `GET /admin/notification-types`, `POST /admin/notification-types`, `PUT /admin/notification-types/{id}`
    - Wire to appropriate Lambda handlers with Cognito authorizer
    - _Requirements: 2.2, 4.4, 4.5, 13.1, 13.2, 13.3, 17.1_

  - [ ] 7.7 Add SSM parameters for configurable thresholds
    - Create SSM parameters: toast-duration-ms (5000), toast-max-visible (3), delivery-target-ms (2000), default-dedup-window-min (60), usage-warning-threshold-pct (80), dlq-threshold (5), override-expiry-warning-hours (24)
    - _Requirements: 3.4, 10.6, 11.2, 11.3, 16.2_

  - [ ]* 7.8 Write CDK snapshot tests for new infrastructure
    - Verify SNS topic, SQS queue + DLQ, Notification Lambda, EventBridge rule, AppSync schema extensions all synthesize correctly
    - Verify IAM permissions follow least-privilege principle
    - _Requirements: 1.1, 3.1_

- [ ] 8. Checkpoint — Infrastructure complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Frontend — notification components and hooks
  - [ ] 9.1 Create notification feature directory structure and types
    - Create `frontend/src/features/notifications/` with `components/`, `hooks/`, `services/`, `types/` subdirectories
    - Define shared TypeScript types: `NotificationPayload`, `NotificationStateChange`, `NotificationView`, `InboxOptions`, `PaginatedInbox`
    - _Requirements: 12.1_

  - [ ] 9.2 Implement notification API service
    - Create `notificationApi.ts` with methods: `getInbox(options)`, `getUnreadCount()`, `transitionState(id, newState)`, `bulkAction(action)`
    - Use the shared API client wrapper with Cognito auth headers
    - _Requirements: 2.2, 4.4, 4.5, 13.1, 13.2, 13.3_

  - [ ] 9.3 Implement AppSync subscription hook (`useNotificationSubscription`)
    - Subscribe to `onNotification(recipientUserId)` and `onNotificationStateChange(recipientUserId)`
    - On disconnect: trigger REST refetch of inbox on reconnect
    - Deduplicate: notifications already in local state (by `id`) are not re-added
    - No duplicate toast display for notifications received via reconnection refetch
    - _Requirements: 3.1, 3.2, 14.1, 14.2, 15.1, 15.2, 15.3_

  - [ ] 9.4 Implement `useNotificationInbox` React Query hook
    - Paginated inbox fetching with cursor-based pagination
    - Support state filtering (unread, read)
    - Cache invalidation on state transitions and new notifications
    - Include unread count in cached data
    - _Requirements: 2.2, 2.3, 13.1, 13.4_

  - [ ] 9.5 Implement `useNotificationActions` hook
    - Mutations for: mark as read, dismiss, mark all as read, dismiss all
    - Optimistic updates for immediate UI feedback
    - Publish state change via AppSync `publishNotificationStateChange` for multi-session sync
    - _Requirements: 4.4, 4.5, 13.2, 13.3, 14.2_

  - [ ] 9.6 Implement `NotificationBell` component
    - Icon control positioned in dashboard header (all three role dashboards)
    - Display unread count badge when count > 0
    - On click: toggle NotificationInbox popover/panel
    - _Requirements: 2.1, 2.2, 2.5_

  - [ ] 9.7 Implement `NotificationInbox` component
    - Paginated list of notifications ordered by creation time (most recent first)
    - Visual distinction between `unread` and `read` notifications
    - Empty state when user has zero notifications
    - Filter controls for lifecycle state (unread, read)
    - "Mark all as read" and "Dismiss all" bulk action buttons
    - Infinite scroll / load-more for pagination
    - _Requirements: 2.2, 2.3, 2.4, 4.6, 13.1, 13.2, 13.3, 13.4_

  - [ ] 9.8 Implement `NotificationItem` component
    - Single notification row with type label, rendered content, timestamp, and optional action URL
    - Visual styling: bold/highlighted for unread, normal weight for read
    - Click handler: transition to `read` state, navigate to `actionUrl` if present
    - Dismiss button: transition to `dismissed` state
    - _Requirements: 4.4, 4.5, 4.6_

  - [ ] 9.9 Implement `NotificationToast` and `NotificationToastStack` components
    - `NotificationToast`: transient display with auto-dismiss after configurable duration (default 5000ms)
    - `NotificationToastStack`: max 3 visible simultaneously, "+N more" consolidation for overflow
    - FIFO ordering by creation time
    - Toast dismissal (auto or manual) does not affect inbox notification state
    - Use `aria-live` for accessibility announcements
    - _Requirements: 3.3, 3.4, 3.5_

  - [ ]* 9.10 Write frontend unit tests
    - NotificationBell: renders badge with unread count, hides badge when count is 0
    - NotificationInbox: renders empty state, renders populated list, pagination loads more
    - NotificationToastStack: max 3 visible, auto-dismiss timing, "+N more" consolidation
    - NotificationItem: visual distinction between unread/read, click triggers state transition
    - Accessibility: toast uses aria-live, inbox is keyboard-navigable
    - _Requirements: 2.1, 2.4, 2.5, 3.3, 3.4, 4.6_

- [ ] 10. Frontend — integration with dashboard and wiring
  - [ ] 10.1 Integrate NotificationBell into all three role dashboards
    - Add NotificationBell to Student dashboard header
    - Add NotificationBell to Department Admin dashboard header
    - Add NotificationBell to Technical Admin dashboard header
    - Wire subscription hook with authenticated user's ID
    - _Requirements: 2.1_

  - [ ] 10.2 Wire event producers to publish notification events
    - Feedback Engine: publish `ai-debrief-ready` and `ai-debrief-failed` events to SNS topic on debrief completion/failure
    - Admin Service: publish access-grant, appointment, config-change events to SNS topic
    - Usage Service: publish usage-limit-warning and usage-limit-reached events to SNS topic
    - Each producer publishes a structured `NotificationEvent` with typeSlug, entityId, context, and scoping fields
    - _Requirements: 9.1–9.7, 10.1–10.7, 11.1–11.5_

  - [ ] 10.3 Implement override-expiry EventBridge handler
    - Query overrides within the configured expiration warning window (default 24 hours)
    - Create `override-expiring` notification for the granting Department Admin
    - Query expired overrides and create `override-expired` notifications
    - Deduplicate to avoid repeated notifications for the same override
    - _Requirements: 10.6, 10.7_

  - [ ]* 10.4 Write integration tests for end-to-end notification flow
    - Test: SNS publish → SQS delivery → Notification Lambda processes → DB persisted → AppSync mutation fired
    - Test: state change in one session propagates to other sessions via subscription
    - Test: reconnection reconciliation delivers missed notifications without duplicates
    - Test: guardrail violation creates both notification and activity_event from same trigger
    - _Requirements: 3.1, 8.2, 14.1, 14.2, 15.1, 15.3_

- [ ] 11. Final checkpoint — Full feature integration
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation at logical boundaries
- Property tests validate universal correctness properties from the design document (Properties 1–15)
- Unit tests validate specific scenarios, UI rendering, and edge cases
- The Notification Lambda and all backend logic use TypeScript (Node 22) with the `postgres` client for RDS access
- Frontend components follow the existing feature-based directory organization (`/features/notifications/`)
- AppSync subscription reuse avoids a second WebSocket stack while preserving the proven auth model
- SSM parameters externalize all configurable thresholds for runtime tuning without redeployment

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "2.1"] },
    { "id": 1, "tasks": ["1.3", "1.4", "2.2"] },
    { "id": 2, "tasks": ["2.4", "2.6", "2.8"] },
    { "id": 3, "tasks": ["2.3", "2.5", "2.7", "2.9", "2.10"] },
    { "id": 4, "tasks": ["4.1", "4.5", "4.8", "4.10", "5.1"] },
    { "id": 5, "tasks": ["4.2", "4.3", "4.4", "4.6", "4.7", "4.9", "4.11", "5.2"] },
    { "id": 6, "tasks": ["5.3", "5.4", "5.5"] },
    { "id": 7, "tasks": ["7.1", "7.7", "9.1"] },
    { "id": 8, "tasks": ["7.2", "7.3", "7.4", "7.6", "9.2"] },
    { "id": 9, "tasks": ["7.5", "7.8", "9.3", "9.4", "9.5"] },
    { "id": 10, "tasks": ["9.6", "9.7", "9.8", "9.9"] },
    { "id": 11, "tasks": ["9.10", "10.1", "10.2", "10.3"] },
    { "id": 12, "tasks": ["10.4"] }
  ]
}
```
