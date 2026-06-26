---
title: Documentation Best Practices
inclusion: fileMatch
fileMatchPattern: 'README*,**/README*,docs/**,**/docs/**,CHANGELOG*,CONTRIBUTING*'
---

# UBC CIC Documentation Best Practices

Standards for documenting UBC Cloud Innovation Centre projects on GitHub. Every CIC
project keeps a **single comprehensive README** at the repository root that orients a
newcomer, then links out to focused documents under `docs/` for the detail. Keep
documentation close to the code, update it in the same PR as the change, and never let
docs drift from the implementation.

## Required README Structure

The root `README.md` MUST contain the following sections, in this order:

1. **Project title and description** — A paragraph describing what the project is, who
   it's for, and the problem it solves. Lead with context, not implementation detail.
2. **Architecture Diagram** — An architecture diagram of the system (see "Architecture
   Diagram" below). Embed the exported image near the top of the README and link to the
   editable source in `docs/`.
3. **Table of Contents** — Links to the focused documents under `docs/` (see below).
4. **Directory Structure** — An annotated tree of the repository explaining the purpose
   of each top-level directory.
5. **Credits** — Who contributed to the project (people, teams, partners).
6. **License** — The project license (MIT) with links to any other licenses used by
   bundled code or dependencies.

### Table of Contents

Link each section to its own document under `docs/`:

```markdown
## Table of Contents

- [Deployment Guide](docs/deployment-guide.md) — End-to-end deployment instructions, prerequisites, and troubleshooting.
- [Architecture Deep Dive](docs/architecture-deep-dive.md) — System architecture, component breakdown, data flows, and database schema.
- [User Guide](docs/user-guide.md) — How to use the platform as a student, instructor, or admin.
- [Modification Guide](docs/modification-guide.md) — Customizing colors, extending the API, configuring LLMs, and local dev setup.
- [Database Migrations](docs/database-migrations.md) — Migration system usage, patterns, and safety guidelines.
- [Dependency Management](docs/dependency-management.md) — Dependency locking and update procedures for Python and Node.js.
- [API Documentation](docs/api-documentation.md) — REST API endpoints, request/response formats.
- [Contributing to Docs](docs/contributing-to-docs.md) — Guidelines for writing and maintaining documentation.
- [Changelog](docs/changelog.md) — Version history and release notes.
```

### Architecture Diagram

The README MUST include an architecture diagram of the system, and the **editable source
must be committed** so future contributors can update it.

- **Author the diagram in [draw.io](https://www.drawio.com/)** (diagrams.net) and save the
  source as a `.drawio` (XML) file in the `docs/` directory, e.g.
  `docs/architecture.drawio`.
- **Export a rendered image** (`docs/architecture.png` or `.svg`) from the same source and
  embed it in the README. Keep the export in sync with the source whenever the diagram
  changes.
- **Use the official AWS Architecture Icons.** Do not substitute generic shapes or
  third-party clip art for AWS services. In draw.io these are available via the built-in
  AWS shape libraries (AWS17 / AWS19+):
  - Open the shape panel: *More Shapes… → Networking → AWS 19* (and related AWS libraries),
    then enable them.
  - The official icon set and guidelines are published by AWS at
    [AWS Architecture Icons](https://aws.amazon.com/architecture/icons/).
- Show service boundaries (VPC, subnets, accounts/regions) and the primary data/request
  flows between components. Keep it readable — group related resources and label edges.
- Reference the diagram from the **Architecture Deep Dive** doc as well, so the detailed
  write-up and the visual stay together.

Embed it in the README like so:

```markdown
## Architecture

![Architecture Diagram](docs/architecture.png)

> Editable source: [`docs/architecture.drawio`](docs/architecture.drawio) — open with
> [draw.io](https://www.drawio.com/) using the official AWS icon libraries.
```

### Directory Structure

Include an annotated tree so contributors can navigate the repo quickly. Example:

```markdown
## Directory Structure

```text
.
├── cdk/                # Infrastructure as code (CDK v2) + backend services
│   ├── bin/            # CDK app entry points
│   ├── lib/            # Stacks
│   ├── lambda/         # Lambda function source
│   └── layers/         # Shared Lambda layers
├── frontend/           # React + Vite application
│   ├── src/
│   │   ├── pages/
│   │   ├── components/
│   │   ├── services/
│   │   └── hooks/
├── docs/               # Project documentation (linked from this README)
│   ├── architecture.drawio   # Editable architecture diagram (draw.io source)
│   └── architecture.png      # Exported diagram embedded in the README
└── README.md           # You are here
```
```

Keep the tree current — update it whenever top-level directories are added or removed.

### Credits

Acknowledge contributors and partners. Example:

```markdown
## Credits

This project was developed by the UBC Cloud Innovation Centre in partnership with
[Partner Organization]. Thanks to [contributors / teams] for their work.

Powered by AWS.
```

### License

State the project license and link out to any third-party licenses:

```markdown
## License

This project is distributed under the [MIT License](./LICENSE).

This project uses third-party libraries under their own licenses. See
[THIRD_PARTY_LICENSES](./THIRD_PARTY_LICENSES.md) for details.
```

- The default project license is **MIT** — include the full `LICENSE` file at the repo root.
- When the project bundles or depends on code under other licenses, link to each license
  and note any attribution or redistribution requirements.

## The `docs/` Documents

Each linked document is a focused, standalone guide. Recommended contents:

- **Deployment Guide** (`docs/deployment-guide.md`) — Prerequisites (accounts, CLI tools,
  credentials), step-by-step deployment (CDK bootstrap/deploy, environment configuration,
  context values), post-deploy verification, teardown, and a troubleshooting section for
  common failures.
- **Architecture Deep Dive** (`docs/architecture-deep-dive.md`) — High-level architecture
  diagram, component-by-component breakdown, request/data flows, the database schema
  (tables, relationships, key indexes), and major design decisions. Embed the same draw.io
  diagram used in the README and keep its `.drawio` source (`docs/architecture.drawio`) up
  to date.
- **User Guide** (`docs/user-guide.md`) — Task-oriented walkthroughs for each role
  (student, instructor, admin), with screenshots where helpful.
- **Modification Guide** (`docs/modification-guide.md`) — How to customize theming/colors,
  extend the API, configure LLMs/models, and set up a local development environment.
- **Database Migrations** (`docs/database-migrations.md`) — How the migration system works,
  naming/versioning patterns, how to write and apply a migration, and safety guidelines
  (backups, reversibility, running against production).
- **Dependency Management** (`docs/dependency-management.md`) — Dependency locking and
  update procedures for Python (**uv**: `pyproject.toml` → `uv.lock`, with
  `uv pip compile` to generate a pinned `requirements.txt` for Lambda/container builds)
  and Node.js (`package-lock.json`), plus how to review and roll out updates.
- **API Documentation** (`docs/api-documentation.md`) — REST endpoints with request/
  response formats and examples. Prefer generating this from the OpenAPI spec so it stays
  in sync with the implementation.
- **Contributing to Docs** (`docs/contributing-to-docs.md`) — Style, tone, structure, and
  review expectations for documentation; how to add a new doc and link it from the README.
- **Changelog** (`docs/changelog.md`) — Version history and release notes; follow
  [Keep a Changelog](https://keepachangelog.com/) and Semantic Versioning.

## Writing Standards

- Write for a newcomer — define acronyms on first use and link to prerequisites.
- Keep one source of truth — do not duplicate content across docs; link instead.
- Use relative links between docs so they work on GitHub and in clones.
- Include runnable, copy-pasteable commands; show expected output where it aids verification.
- Use placeholders for secrets and account-specific values — never commit real credentials,
  ARNs, or endpoints.
- Use the **draw.io architecture diagram with official AWS icons** for the system
  architecture (see "Architecture Diagram"). For other diagrams (flows, sequences, ER
  diagrams), prefer Mermaid where possible so they render on GitHub and stay versionable.
- Update documentation in the **same pull request** as the code change it describes.
- Keep the changelog current with every release.
