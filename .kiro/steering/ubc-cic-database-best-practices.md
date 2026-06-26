---
title: Database Best Practices
inclusion: fileMatch
fileMatchPattern: ["*.sql", "**/models/**", "**/migrations/**", "**/schema/**", "*.prisma"]
---

# Database Best Practices

## Schema Design (Relational / PostgreSQL / Aurora)
- Use singular table names (e.g. `user`, `order`)
- Primary keys should be UUIDs or auto-incrementing bigint
- Always add `created_at` and `updated_at` timestamp columns
- Use explicit foreign key constraints with ON DELETE/UPDATE actions
- Normalize to at least 3NF; denormalize intentionally with documentation
- Index columns used in WHERE, JOIN, and ORDER BY clauses
- Use check constraints for domain validation at the database level

## Migrations
- One migration per logical change (never combine unrelated schema changes)
- Migrations must be idempotent and reversible
- Name migrations descriptively: `001_create_user_table.sql`
- Never modify a migration that has been applied to a shared environment
- Use a migration tool (Alembic, Flyway, Prisma Migrate, Knex)

## DynamoDB / NoSQL Patterns
- Design access patterns first, schema second (single table design when appropriate)
- Use composite sort keys for hierarchical data (e.g. `ORG#123#PROJ#456`)
- Keep item sizes small (< 400 KB limit)
- Use GSIs sparingly and with projected attributes
- Prefer query over scan operations
- Use TTL for ephemeral data (sessions, caches)
- Implement optimistic locking via version attributes

## ORM / Data Access Layer
- Use an ORM or query builder (SQLAlchemy, Drizzle, Prisma, TypeORM)
- Define models in a dedicated `models/` directory
- Never construct raw SQL from user input (always parameterize)
- Wrap multi-step operations in transactions
- Use connection pooling in production

## Testing
- Use a separate test database or in-memory SQLite for unit tests
- Seed deterministic test data via fixtures
- Test migrations forward and backward
- Validate constraints and indexes with integration tests

## Security
- Apply least privilege database roles per service
- Encrypt data at rest (RDS encryption, DynamoDB encryption)
- Never store secrets in migration files or seed scripts
- Use AWS Secrets Manager or SSM Parameter Store for credentials
- Enable audit logging for production databases
