/**
 * Shared primitive schemas used across WREN domain entities.
 *
 * Identifiers are modelled as non-empty strings (the persistence layer assigns
 * the concrete format — UUID, ULID, etc.); timestamps are ISO-8601 strings so
 * they serialise cleanly across the REST/JSON API boundary.
 */
import { z } from 'zod';

/** A non-empty entity identifier. */
export const idSchema = z.string().min(1);
export type Id = z.infer<typeof idSchema>;

/** An ISO-8601 date-time string (e.g. `2024-01-01T00:00:00.000Z`). */
export const isoDateTimeSchema = z.string().datetime({ offset: true });
export type IsoDateTime = z.infer<typeof isoDateTimeSchema>;
