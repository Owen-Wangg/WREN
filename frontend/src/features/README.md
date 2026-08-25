# Features

Feature-based organization. Product surfaces live under `features/<name>/`
with API helpers, hooks, and `components/` as needed.

```
features/
  auth/              # Cognito sign-in/sign-up, session, protected routes
  dashboard/         # Student document list and new-document API
  editor/            # TipTap document editor, export, anchors, footnotes
  debrief/           # AI Debrief list, helpfulness prompt
  ask-wren/          # Ask {app name} chat (Socratic, draft-anchored)
  progress/          # Writer progress summary
  department-admin/  # Document types, error categories, type config
  system-admin/      # Departments, model, usage limits, users
  notifications/     # Bell, inbox, AppSync hooks
```

Shared primitives go in `src/components/ui`. Domain types come from
`@wren/types`. HTTP goes through `src/services`. Route screens live in
`src/pages`.
