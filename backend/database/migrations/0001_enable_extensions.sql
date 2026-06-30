-- Migration 0001 — enable required PostgreSQL extensions.
--
-- LEON Writing Coach runs on RDS PostgreSQL 16. Two capabilities are needed
-- before any application schema is created:
--
--   * pgvector  — vector similarity search over indexed Reference Material
--                 embeddings (design "Data Models": reference embeddings live in
--                 pgvector; ReferenceMaterial.embeddingId points at a vector row).
--                 The vector index/columns themselves are populated by the
--                 reference-grounding work (tasks 10.x); enabling the extension
--                 here keeps later migrations additive.
--   * pgcrypto  — provides gen_random_uuid() on engines/builds where it is not
--                 already in core, so primary keys can default to UUIDs.
--
-- Both statements are idempotent (IF NOT EXISTS), so re-running the migration on
-- an already-initialised database is a no-op.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
