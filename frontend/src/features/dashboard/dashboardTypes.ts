/**
 * Dashboard-scoped validation schemas and types (task 19.1).
 *
 * The writer dashboard needs two data shapes that are not (yet) modelled in the
 * shared `@wren/types` contract:
 *
 *  1. An Organization's effective access state — needed to resolve a Writing
 *     Type whose `accessState` is `INHERIT` (Requirement 4.1). We only need the
 *     `{ id, name, accessState }` projection here, so a minimal dashboard-local
 *     schema is declared rather than pulling in an Organization entity that
 *     other B3 consoles will own.
 *  2. The access-request submission for a LOCKED Writing Type (Requirement 4.6):
 *     the writer requests access rather than being silently blocked.
 *
 * Everything else (Documents, Writing Types, Access Grants) reuses the shared
 * schemas from `@wren/types` — this module never redefines those shapes.
 */
import { z } from 'zod';

import { accessStateSchema, idSchema } from '@wren/types';

/**
 * The minimal Organization projection the dashboard consumes: its id, a display
 * name, and its effective access state (`OPEN`/`LOCKED`). A Writing Type set to
 * `INHERIT` resolves its effective access against the matching organization.
 */
export const organizationAccessSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1),
    accessState: accessStateSchema,
  })
  .strict();
export type OrganizationAccess = z.infer<typeof organizationAccessSchema>;

/* -------------------------------------------------------------------------- */
/* Content Type (document category within a Writing Type / Writing Domain)    */
/* -------------------------------------------------------------------------- */

export const contentTypeSchema = z
  .object({
    id: idSchema,
    organizationId: idSchema,
    writingTypeId: idSchema,
    name: z.string().min(1),
  })
  .strict();
export type ContentType = z.infer<typeof contentTypeSchema>;

/** The body sent when a writer requests access to a LOCKED Writing Type. */
export const accessRequestInputSchema = z
  .object({
    writingTypeId: idSchema,
  })
  .strict();
export type AccessRequestInput = z.infer<typeof accessRequestInputSchema>;

/** Acknowledgement returned by the access-request endpoint. */
export const accessRequestAckSchema = z
  .object({
    requested: z.boolean(),
  })
  .strict();
export type AccessRequestAck = z.infer<typeof accessRequestAckSchema>;
