# Requirements Document

## Introduction

This feature adds an in-app notification system to WREN for all three platform roles — Student, Department Admin, and Technical Admin. When an event a user needs to act on or acknowledge occurs (for example, feedback generation finishing, an access request needing review, or a usage cap being reached), the platform creates a Notification for the relevant user(s). Notifications first appear as a brief transient preview near the dashboard's notification icon, then are filed into a persistent inbox that a user can revisit until they explicitly dismiss each entry.

Notifications are delivered exclusively within the application; this feature does not send email or SMS/text messages for any Notification_Type. Real-time delivery follows the same push-based precedent already established in this codebase for feedback streaming (AppSync/GraphQL subscriptions or WebSocket), rather than client-side polling, though this document states that requirement as a delivery constraint and leaves the specific mechanism to `design.md`.

Notification_Type is modeled as configurable, extensible data rather than a hardcoded enumeration, consistent with this project's existing "configurable everything" precedent (see `sample-taxonomy.md` and REQ-TAXONOMY-01 in the WREN Writing Coach spec). The set of Notification_Types enumerated in this document is the first-pass scope; additional types are expected to be added later without a structural rewrite of the Notification data model.

This feature carries forward WREN's no-surveillance / no-ghostwriting compliance posture: Student-facing Notifications never include a numeric score, a count of feedback items, or any other per-Student quantitative indicator. Numeric indicators remain admin-facing, all-users-aggregate-only, per the existing REQ-AUDIT-OPSTATE-01 principle.

Notifications are a distinct concern from the existing Audit_Service activity log and aggregate analytics: Notifications are user-facing and actionable, and are dismissed once acted upon or acknowledged; the activity log is a retained, append-only system-of-record used for aggregate analytics. Some events (for example, a guardrail violation) produce both a Notification and an activity-log entry from the same triggering event.

## Glossary

- **Notification_Service**: The subsystem responsible for creating, delivering, storing, and managing the lifecycle of Notifications across all three roles.
- **Notification**: A single, user-facing record representing an event a specific user needs to see or act on. Belongs to exactly one Notification_Type, targets one recipient, and carries a lifecycle state (`unread`, `read`, or `dismissed`).
- **Notification_Type**: A configurable catalog entry defining a category of Notification (for example, "AI Debrief ready"), the role(s) it targets, and its display content template. Modeled as data, not as a hardcoded enumeration, so new types can be added without a structural change to the Notification data model.
- **Notification_Inbox**: The persistent, per-user list of that user's Notifications, accessed from the notification icon on the dashboard, retaining each Notification until the user explicitly dismisses it.
- **Notification_Toast**: A transient, auto-dismissing visual preview of a newly arrived Notification, displayed beneath the dashboard's notification icon.
- **Dashboard**: The existing top-level landing view for each role (Student, Department Admin, Technical Admin), each of which carries its own notification icon per this feature.
- **Student**, **Department Admin**, **Technical Admin**: The three platform roles, as defined in the WREN Writing Coach requirements (`wren-writing-coach/requirements.md`). Department Admin is scoped to the Department(s) they administer; Technical Admin is platform-wide; Student is global.
- **Document Type**, **Department**, **Access Grant**, **Draft**, **AI Debrief**, **Reference Material**, **Override**, **Guardrail**: Existing platform concepts, defined in `wren-writing-coach/requirements.md`, unchanged by this feature.
- **Usage limit**: An existing platform / Document-Type-scoped consumption cap enforced by the Usage_Service (`wren-writing-coach/requirements.md`, REQ-USAGE-LIMITS-01, REQ-TOKEN-LIMIT-01).
- **DLQ (dead-letter queue)**: The existing SQS dead-letter queue that receives feedback-generation jobs that fail after retry, per the platform's async job architecture.
- **Audit_Service**: The existing subsystem that records the Actor–Verb–Object activity log and computes all-users aggregate analytics (`wren-writing-coach/requirements.md`, REQ-ACTIVITY-LOG-01, REQ-AUDIT-OPSTATE-01). Distinct from the Notification_Service.
- **Auth_Service**: The existing subsystem that resolves role and scope from the application database as the sole source of authorization truth (`wren-writing-coach/requirements.md`, REQ-SEC-AUTHDECOUPLE-01).

## Non-Goals / Explicitly Out of Scope

- **Draft resubmission / resolution-update notifications are cut from this pass.** Any notification tied to draft resubmission or Feedback Item resolution status/counts is out of scope for this feature, because a purely qualitative version was not agreed to a specific design and a quantitative version would violate the no-surveillance principle (REQ-NOTIF-NOLEAK-01). This document does not define such a Notification_Type.
- **Email and SMS/text delivery are out of scope.** No Notification_Type defined by this feature is delivered by any channel other than in-app (REQ-NOTIF-CHANNEL-01).
- **Prompt/config save rejection is not a Notification.** Rejecting an invalid prompt or configuration save is inline form-validation feedback at the point of submission, not a Notification_Service concern, and is excluded from this feature's scope.

## Requirements

### Section 1 — Delivery Mechanism and Presentation

#### Requirement 1 (REQ-NOTIF-CHANNEL-01): In-app-only delivery

**User Story:** As a platform operator, I want Notifications delivered only within the application, so that the platform does not take on email/SMS delivery infrastructure or its associated compliance surface.

**Acceptance Criteria**
1. THE Notification_Service SHALL deliver every Notification through the in-app Notification_Toast and Notification_Inbox only.
2. THE Notification_Service SHALL NOT send a Notification via email.
3. THE Notification_Service SHALL NOT send a Notification via SMS or any other text-message channel.
4. FOR ALL Notification_Types defined in this document, THE Notification_Service SHALL record no external delivery address (email address, phone number) as part of Notification delivery.

---

#### Requirement 2 (REQ-NOTIF-UI-ENTRY-01): Dashboard notification entry point

**User Story:** As a user of any role, I want a consistent way to access my notifications from my dashboard, so that I always know where to check for updates.

**Acceptance Criteria**
1. THE Notification_Service SHALL provide a notification icon control positioned in the top area of the Dashboard for each of the three roles (Student, Department Admin, Technical Admin).
2. WHEN a user selects the notification icon, THE Notification_Service SHALL display that user's Notification_Inbox.
3. THE Notification_Inbox SHALL list that user's Notifications ordered by creation time, most recent first.
4. WHERE a user has zero Notifications, THE Notification_Inbox SHALL display an empty state.
5. WHERE a user has one or more unread Notifications, THE notification icon SHALL display the count of unread Notifications.

---

#### Requirement 3 (REQ-NOTIF-REALTIME-01): Real-time delivery and transient preview

**User Story:** As a user of any role, I want to see new notifications appear immediately without refreshing the page, so that I notice time-sensitive updates as they happen.

**Acceptance Criteria**
1. WHEN a Notification is created for a user who has an active session, THE Notification_Service SHALL deliver that Notification to the user's active session without requiring a manual page refresh.
2. THE Notification_Service SHALL use a push-based real-time delivery mechanism for criterion 1 rather than client-side polling as the primary delivery path, consistent with the existing push-based precedent used in this codebase for feedback streaming (AppSync/GraphQL subscriptions or WebSocket); the specific mechanism is a design decision, not mandated by this requirement.
3. WHEN a new Notification is delivered to a user's active session, THE Notification_Service SHALL display a Notification_Toast beneath that user's notification icon.
4. THE Notification_Service SHALL automatically dismiss a displayed Notification_Toast after a configurable display duration (default 5000 milliseconds) without requiring user interaction.
5. WHEN a Notification_Toast is dismissed, whether automatically or by the user, THE Notification_Service SHALL leave the underlying Notification present and unaffected in the Notification_Inbox.
6. IF a user has no active session when a Notification is created, THEN THE Notification_Service SHALL still persist the Notification for delivery to the Notification_Inbox on the user's next session.

---

#### Requirement 4 (REQ-NOTIF-PERSIST-01): Persistent inbox with explicit dismissal

**User Story:** As a user of any role, I want notifications to stay in my inbox until I choose to remove them, so that I don't lose track of something I haven't dealt with yet.

**Acceptance Criteria**
1. WHEN a Notification is created, THE Notification_Service SHALL persist it in the recipient's Notification_Inbox with an `unread` state.
2. THE Notification_Service SHALL retain each Notification in the Notification_Inbox until the recipient explicitly dismisses it.
3. THE Notification_Service SHALL NOT automatically remove a Notification from the Notification_Inbox based on elapsed time.
4. WHEN a user opens a Notification in the Notification_Inbox, THE Notification_Service SHALL transition that Notification's state from `unread` to `read`.
5. WHEN a user dismisses a Notification, THE Notification_Service SHALL transition that Notification's state to `dismissed` and remove it from that user's visible Notification_Inbox.
6. THE Notification_Inbox SHALL visually distinguish `unread` Notifications from `read` Notifications.

---

### Section 2 — Notification Type Model and Authorization

#### Requirement 5 (REQ-NOTIF-TYPE-CONFIG-01): Notification type as extensible configurable data

**User Story:** As a maintainer, I want notification categories defined as configurable data rather than hardcoded, so that new notification types can be added later without a structural rewrite.

**Acceptance Criteria**
1. THE Notification_Service SHALL store each Notification_Type as a catalog record with an identifier, a target role scope, and a display content template, rather than as a hardcoded enumeration in application code.
2. WHEN a new Notification_Type is added to the catalog, THE Notification_Service SHALL support creating and displaying Notifications of that type without a structural change to the Notification data model.
3. THE Notification_Service SHALL restrict each Notification_Type to the role(s) named in its target role scope (Student, Department Admin, Technical Admin, or a combination).
4. FOR ALL Notification records, THE Notification_Service SHALL ensure the Notification's `type` attribute references an existing Notification_Type catalog entry.
5. IF a Notification is requested for a Notification_Type that does not exist in the catalog, THEN THE Notification_Service SHALL reject creation of that Notification.

---

#### Requirement 6 (REQ-NOTIF-AUTHZ-01): Server-side role and scope authorization

**User Story:** As a security owner, I want notification visibility resolved the same way as every other authorization decision in this platform, so that notifications cannot leak across roles or Departments.

**Acceptance Criteria**
1. THE Notification_Service SHALL resolve each Notification's recipient(s) from the role and scope stored in the application database (role assignment, administered Departments), consistent with REQ-SEC-AUTHDECOUPLE-01.
2. THE Notification_Service SHALL NOT resolve a Notification's recipient(s) or visibility from IdP claims, tokens, or client-side/UI state.
3. WHEN a Department Admin's administered Department scope changes, THE Notification_Service SHALL apply the updated scope to Notifications created after the change.
4. IF a user requests their Notification_Inbox, THEN THE Notification_Service SHALL return only Notifications for which that user is the resolved recipient.
5. WHERE a Notification_Type targets Department Admins scoped to a Document Type's Department, THE Notification_Service SHALL create one Notification per Department Admin who currently administers that Department.

---

### Section 3 — Compliance: No Quantitative Leakage to Students

#### Requirement 7 (REQ-NOTIF-NOLEAK-01): No numeric or per-Student quantitative indicators in Student-facing notifications

**User Story:** As a platform maintainer, I want to guarantee that notifications cannot become a surveillance or scoring channel, so that the no-ghostwriting/no-surveillance principle holds across every part of the product, including notifications.

**Acceptance Criteria**
1. THE Notification_Service SHALL NOT include a numeric score, a count of Feedback Items, or any other per-Student quantitative indicator in the content of a Notification whose target role scope includes Student.
2. THE Notification_Service SHALL express the content of every Student-targeted Notification_Type qualitatively (status-based, for example "your feedback is ready"), consistent with REQ-AUDIT-OPSTATE-01 and REQ-PROGRESS-ACK-01.
3. THE Notification_Service SHALL NOT define a Notification_Type for draft resubmission or Feedback Item resolution-status/count updates.
4. IF a submitted Notification_Type definition targets Student and its display content template contains a numeric placeholder bound to a score, count, or other per-Student quantitative field, THEN THE Notification_Service SHALL reject that Notification_Type definition and identify the offending field.

---

### Section 4 — Relationship to the Activity Log

#### Requirement 8 (REQ-NOTIF-AUDIT-DISTINCT-01): Notifications distinct from, but may co-occur with, the activity log

**User Story:** As a maintainer, I want notifications and the audit/activity log to remain independent systems, so that dismissing a notification never erases the retained record of what happened.

**Acceptance Criteria**
1. THE Notification_Service SHALL operate independently of the Audit_Service: a Notification's creation, read state, and dismissal SHALL have no effect on activity-log entries or aggregate analytics computed by the Audit_Service.
2. WHERE a triggering event both requires user notice and warrants an audit trail (for example, a guardrail violation), THE platform SHALL create a Notification via the Notification_Service and an activity-log entry via the Audit_Service from that single triggering event.
3. WHEN a Notification is dismissed, THE Notification_Service SHALL NOT delete or modify any Audit_Service activity-log entry created from the same triggering event.
4. THE Audit_Service SHALL NOT depend on retained Notification records to compute aggregate analytics (REQ-ACTIVITY-LOG-01).

---

### Section 5 — Student-Facing Notification Types

#### Requirement 9 (REQ-NOTIF-STUDENT-01): Student notification types

**User Story:** As a Student, I want to be notified about my feedback status, access requests, and usage, so that I know when I need to take action without having to check manually.

**Acceptance Criteria**
1. WHEN AI Debrief generation completes successfully for a Draft, THE Notification_Service SHALL create a Notification of type "AI Debrief ready" for that Draft's owning Student.
2. IF AI Debrief generation for a Draft fails (guardrail rejection, model timeout, or queue backpressure), THEN THE Notification_Service SHALL create a Notification of type "AI Debrief failed" for that Draft's owning Student, indicating that a retry is available.
3. WHEN a Department Admin approves a Student's Access Grant request for a LOCKED Document Type, THE Notification_Service SHALL create a Notification of type "Access grant approved" for the requesting Student.
4. WHEN a Department Admin denies a Student's Access Grant request for a LOCKED Document Type, THE Notification_Service SHALL create a Notification of type "Access grant denied" for the requesting Student.
5. WHEN a Student's usage reaches a configured warning threshold below an applicable Document-Type or platform usage limit, THE Notification_Service SHALL create a Notification of type "Usage limit warning" for that Student.
6. WHEN a Student's usage reaches an applicable Document-Type or platform usage limit, THE Notification_Service SHALL create a Notification of type "Usage limit reached" for that Student.
7. WHEN a Department Admin or Technical Admin grants a Student a temporary scoped usage Override, THE Notification_Service SHALL create a Notification of type "Temporary override granted" for that Student.
8. THE Notification_Service SHALL apply REQ-NOTIF-NOLEAK-01 to every Notification_Type in this requirement.

---

### Section 6 — Department Admin-Facing Notification Types

#### Requirement 10 (REQ-NOTIF-DEPTADMIN-01): Department Admin notification types

**User Story:** As a Department Admin, I want to be notified about access requests, usage limits, guardrail violations, appointments, reference-material failures, and expiring overrides within the Department(s) I administer, so that I can respond without constantly checking each console.

**Acceptance Criteria**
1. WHEN a Student requests access to a LOCKED Document Type, THE Notification_Service SHALL create a Notification of type "Access request pending" for each Department Admin who administers that Document Type's Department.
2. WHEN a Document Type reaches its usage limit, THE Notification_Service SHALL create a Notification of type "Usage limit reached (Document Type)" for each Department Admin who administers that Document Type's Department.
3. WHEN the no-ghostwriting output guardrail rejects or transforms generated content for a Document Type, THE Notification_Service SHALL create a Notification of type "Guardrail violation flagged" for each Department Admin who administers that Document Type's Department.
4. WHEN a Technical Admin appoints a Department Admin to administer a Department, THE Notification_Service SHALL create a Notification of type "New Department appointment" for the appointed Department Admin.
5. IF uploaded Reference Material for a Document Type fails to parse or index, THEN THE Notification_Service SHALL create a Notification of type "Reference material processing failed" for each Department Admin who administers that Document Type's Department.
6. WHILE a temporary Override granted by a Department Admin is within a configured expiration warning window, THE Notification_Service SHALL create a Notification of type "Override expiring" for the Department Admin who granted it.
7. WHEN a temporary Override granted by a Department Admin lapses, THE Notification_Service SHALL create a Notification of type "Override expired" for the Department Admin who granted it.

---

### Section 7 — Technical Admin-Facing Notification Types

#### Requirement 11 (REQ-NOTIF-TECHADMIN-01): Technical Admin notification types

**User Story:** As a Technical Admin, I want to be notified about platform-wide usage, job failures, guardrail anomalies, my own administrative actions, and configuration changes, so that I have in-app visibility into platform/infrastructure health and my own recent actions, without being exposed to educational content.

**Acceptance Criteria**
1. WHEN the platform-wide usage limit is reached, THE Notification_Service SHALL create a Notification of type "Usage limit reached (platform)" for every Technical Admin.
2. WHEN the count of feedback-generation jobs in the DLQ exceeds a configured threshold, THE Notification_Service SHALL create a Notification of type "Feedback job failures" for every Technical Admin.
3. WHEN the rate of no-ghostwriting guardrail rejections exceeds a configured anomaly threshold platform-wide, THE Notification_Service SHALL create a Notification of type "Guardrail violation spike" for every Technical Admin, consistent with REQ-SEC-PROMPTINJECT-01.
4. WHEN a Technical Admin completes a role-assignment or Department-appointment action, THE Notification_Service SHALL create a Notification of type "Role assignment confirmation" for the Technical Admin who performed that action.
5. WHEN a Technical Admin applies a change to the configured Bedrock model identifier or the system-scaffolding prompt, THE Notification_Service SHALL create a Notification of type "Model/config change confirmation" for the Technical Admin who applied that change.
6. FOR ALL Notification_Types in this requirement, THE Notification_Service SHALL restrict their display content to platform/infrastructure/technical scope and SHALL NOT include educational content, a Document Type's taxonomy or prompt content, or any Student- or Draft-identifying information.
7. THE Notification_Service SHALL NOT define any additional Notification_Type targeting Technical Admin beyond those listed in this requirement without that new type also satisfying criterion 6.

---

### Section 8 — Notification Data Model and Lifecycle

#### Requirement 12 (REQ-NOTIF-DATA-01): Notification record structure and lifecycle invariants

**User Story:** As a maintainer, I want every notification to follow the same lifecycle regardless of type or role, so that the inbox, toast, and dismissal behavior are predictable and testable.

**Acceptance Criteria**
1. THE Notification_Service SHALL persist each Notification with, at minimum: a unique identifier, a Notification_Type reference, a recipient identifier, a creation timestamp, a lifecycle state (`unread`, `read`, or `dismissed`), and type-specific display content.
2. FOR ALL Notifications, THE Notification_Service SHALL ensure exactly one of `unread`, `read`, or `dismissed` is the current lifecycle state at any point in time.
3. THE Notification_Service SHALL only permit lifecycle-state transitions `unread` → `read`, `unread` → `dismissed`, and `read` → `dismissed`; THE Notification_Service SHALL NOT permit a transition out of `dismissed`.
4. WHEN a Notification is created, THE Notification_Service SHALL set its creation timestamp to the time of creation and SHALL NOT allow that timestamp to change thereafter.
5. THE Notification_Service SHALL scope every Notification to exactly one recipient; WHERE a Notification_Type targets multiple users of a role (for example, all Department Admins of a Department), THE Notification_Service SHALL create one independent Notification record per recipient, each with its own lifecycle state.

# Requirements Document — Additions

The following requirements supplement `requirements.md` (Notification_Service). They close gaps identified in review of the original document and follow the same EARS-style acceptance-criteria format, glossary, and REQ-ID conventions. Numbering continues from Requirement 12.

---

### Section 9 — Inbox Scale and Bulk Actions

#### Requirement 13 (REQ-NOTIF-INBOX-SCALE-01): Inbox pagination and bulk dismissal

**User Story:** As a user of any role, I want to manage a large number of notifications efficiently, so that an inbox that has grown over time remains usable.

**Acceptance Criteria**
1. THE Notification_Inbox SHALL paginate or lazily load Notifications rather than returning a user's entire notification history in a single response.
2. THE Notification_Service SHALL provide a "mark all as read" action that transitions all of a user's `unread` Notifications to `read` in a single operation.
3. THE Notification_Service SHALL provide a "dismiss all" action that transitions all of a user's `read` and `unread` Notifications to `dismissed` in a single operation, subject to the same lifecycle-transition rules as REQ-NOTIF-DATA-01 criterion 3.
4. THE Notification_Inbox SHALL support filtering by lifecycle state (`unread`, `read`) at minimum.

---

### Section 10 — Multi-Session and Delivery Reliability

#### Requirement 14 (REQ-NOTIF-MULTISESSION-01): Behavior across concurrent sessions

**User Story:** As a user logged in on more than one device or browser tab, I want my notification state to stay consistent everywhere, so that reading or dismissing a notification in one place is reflected in the other.

**Acceptance Criteria**
1. WHEN a user has more than one active session, THE Notification_Service SHALL deliver a new Notification's Notification_Toast to all of that user's active sessions.
2. WHEN a Notification's lifecycle state changes (via `read` or `dismissed` transition) in one of a user's active sessions, THE Notification_Service SHALL reflect that state change in the user's Notification_Inbox in that user's other active sessions without requiring a manual refresh.
3. THE Notification_Service SHALL treat lifecycle-state transitions as idempotent across concurrent sessions: a transition already applied in one session SHALL NOT error or duplicate when a matching request arrives from another session.

---

#### Requirement 15 (REQ-NOTIF-RECONNECT-01): Delivery continuity across connection interruptions

**User Story:** As a user whose real-time connection drops temporarily, I want to still receive notifications that arrived while I was disconnected, so that I don't miss anything even without a full session restart.

**Acceptance Criteria**
1. WHEN a user's push-based delivery connection (per REQ-NOTIF-REALTIME-01) is interrupted and later reconnects within the same session, THE Notification_Service SHALL reconcile the client's Notification_Inbox state with the server, delivering any Notifications created during the interruption.
2. THE Notification_Service SHALL NOT rely solely on the Notification_Toast to communicate a Notification created during a connection interruption; such a Notification SHALL still appear in the Notification_Inbox per REQ-NOTIF-PERSIST-01 regardless of connection state at creation time.
3. THE reconciliation in criterion 1 SHALL NOT create duplicate Notification records for a Notification the client already received prior to the interruption.

---

### Section 11 — Idempotency and Deduplication

#### Requirement 16 (REQ-NOTIF-DEDUP-01): Duplicate-trigger handling

**User Story:** As a user, I want to receive one notification per distinct event rather than repeated notifications for the same underlying condition, so that my inbox isn't flooded by noise.

**Acceptance Criteria**
1. WHERE a Notification_Type's triggering condition is threshold-based (for example, "Usage limit warning," "Usage limit reached"), THE Notification_Service SHALL create at most one Notification per recipient per crossing of that threshold, and SHALL NOT create a new Notification while the underlying usage remains at or above a threshold it has already triggered for.
2. WHERE a Notification_Type's triggering condition can plausibly recur for the same underlying entity within a short interval (for example, repeated guardrail rejection on retry of the same content), THE Notification_Service SHALL deduplicate Notifications of that type for that entity within a configured deduplication window.
3. THE Notification_Service SHALL define, per Notification_Type, whether and how deduplication applies, as part of that Notification_Type's catalog definition.

---

### Section 12 — Notification_Type Catalog Governance

#### Requirement 17 (REQ-NOTIF-CATALOG-GOVERN-01): Catalog management authorization

**User Story:** As a security owner, I want control over who can define or modify Notification_Types, so that the catalog cannot be used to bypass compliance constraints such as REQ-NOTIF-NOLEAK-01.

**Acceptance Criteria**
1. THE Notification_Service SHALL restrict creation and modification of Notification_Type catalog entries to Technical Admin.
2. THE Notification_Service SHALL apply REQ-NOTIF-NOLEAK-01 criterion 4 validation to every Notification_Type creation and modification, not only at initial catalog creation.
3. THE Notification_Service SHALL log Notification_Type catalog changes (creation, modification) via the Audit_Service, consistent with REQ-NOTIF-AUDIT-DISTINCT-01.

---

### Section 13 — Referential Integrity and Data Lifecycle

#### Requirement 18 (REQ-NOTIF-ORPHAN-01): Handling of Notifications referencing deleted or revoked entities

**User Story:** As a maintainer, I want notifications to remain safe to display even after the entities they reference change or disappear, so that the inbox never breaks or leaks stale information.

**Acceptance Criteria**
1. IF an entity referenced by a Notification's display content (Draft, Document Type, Department, Access Grant, Override) is deleted after the Notification's creation, THEN THE Notification_Service SHALL continue to display that Notification using its stored display content SHALL NOT attempt to re-resolve the deleted entity at render time.
2. WHEN a Department Admin's administered-Department scope is revoked for a Department, THE Notification_Service SHALL NOT retroactively delete or alter Notifications already created for that Department Admin prior to the revocation.
3. THE Notification_Service SHALL NOT allow a dangling reference in a Notification's display content to cause a rendering error in the Notification_Inbox or Notification_Toast.

---

#### Requirement 19 (REQ-NOTIF-CONTENT-SAFETY-01): Display content sanitization

**User Story:** As a security owner, I want dynamic values inserted into notification content to be safely handled, so that user-influenced strings cannot be used to inject scripts or markup into another user's session.

**Acceptance Criteria**
1. THE Notification_Service SHALL sanitize or escape all dynamic values interpolated into a Notification_Type's display content template before storage or rendering.
2. THE Notification_Service SHALL treat all interpolated values originating from user-supplied input (for example, a Document Type name or Department name) as untrusted for this purpose.

---

### Section 14 — Toast Presentation Under Multiple Arrivals

#### Requirement 20 (REQ-NOTIF-TOAST-STACK-01): Multiple Notification_Toast arrivals

**User Story:** As a user, I want to see each new notification clearly even if several arrive close together, so that I don't miss one because it was overwritten by another.

**Acceptance Criteria**
1. WHEN a new Notification_Toast would be displayed while a previous Notification_Toast for that user is still visible, THE Notification_Service SHALL queue or stack the new toast rather than silently replacing the visible one.
2. THE Notification_Service SHALL display queued or stacked Notification_Toasts in the order their underlying Notifications were created.
3. THE Notification_Service SHALL cap the number of simultaneously visible Notification_Toasts to a configured maximum, consolidating additional arrivals (for example, "+3 more") beyond that maximum.

---

### Section 15 — Non-Functional Requirements

#### Requirement 21 (REQ-NOTIF-NFR-01): Delivery performance and observability

**User Story:** As a platform operator, I want measurable expectations for notification delivery speed and failure visibility, so that the Notification_Service's health can be monitored and regressions caught.

**Acceptance Criteria**
1. THE Notification_Service SHALL deliver a Notification to an active session's Notification_Toast within a configured target latency (default 2000 milliseconds) of the triggering event under normal operating conditions.
2. IF Notification creation or delivery fails, THEN THE Notification_Service SHALL log the failure with sufficient detail (Notification_Type, intended recipient, triggering event, failure reason) to support operational troubleshooting.
3. THE Notification_Service SHALL NOT silently drop a Notification on creation failure; a failed creation SHALL be retried according to a configured retry policy or surfaced to Technical Admin via existing platform failure-monitoring channels.
4. THE Notification_Service SHALL expose or log delivery volume metrics sufficient to detect abnormal spikes or drops in Notification creation rate, consistent with the anomaly-detection precedent in REQ-NOTIF-TECHADMIN-01 criterion 3.

---

## Summary of Open Items for Design Discussion

The following are flagged as design-level decisions rather than requirements, and should be resolved in `design.md`:

- Default values for configurable thresholds introduced above (deduplication window, toast stack cap, delivery latency target) — confirm these align with the platform's existing configuration mechanism.
- Whether "mark all as read" / "dismiss all" (Req 13) apply per-type filters or only to the full inbox.
- Exact retry policy shape for Req 21 criterion 3 (backoff strategy, max attempts) — likely inherited from the existing async job architecture used for feedback generation.