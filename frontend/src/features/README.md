# Features

Feature-based organization (frontend steering §5). Each product surface lives in
its own folder with a `components/` subdirectory, e.g.:

```
features/
  auth/                    # LoginForm, SignupForm, AuthService (task 17.3)
    authService.ts         #   real signIn/signUp contract (Cognito-agnostic)
    mockAuthService.ts     #   in-memory implementation used until convergence
    cognitoAuthService.ts  #   Cognito-backed implementation (config-driven, SDK TBD)
    authSchemas.ts         #   RHF + Zod schemas for the forms below
    components/            #   LoginForm.tsx, SignupForm.tsx
  dashboard/components/    # WritingEnvironmentCard, filters   (task 19.x)
  editor/                  # Tiptap-based .docx editor (MIT-only stack; task 18.1)
    docxContentMapper.ts   #   officeparser AST <-> Tiptap JSONContent <-> docx export
    components/            #   DocumentEditor, EditorSidebar    (task 18.x)
  debrief/components/      # AiDebriefModal, FeedbackDimension  (task 18.x)
  documents/               # New-document creation, re-upload, citations (task 18.6)
    documentMetadataConfig.ts #  configurable required-field gating (generic over N fields)
    documentSchemas.ts     #   RHF + Zod schemas (new-document form, re-upload)
    draftService.ts / mockDraftService.ts # re-upload -> new Draft (never mutates)
    useReUploadDraft.ts     #   hook wrapping DraftService for the re-upload flow
    components/            #   NewDocumentForm, DocumentTypeSelect, MetadataFieldsInput,
                           #   ReferenceFileUpload, ReUploadControl, Citation
  ask-wren/                # Ask WREN chat panel (task 18.6)
    askWrenTypes.ts        #   WrenChatMessage/-Session (no replacementProse, ever)
    askWrenService.ts / mockAskWrenService.ts # Socratic-only replies
    components/            #   WrenChatPanel (draft-anchored, AiDisclaimerNotice)
```

Shared primitives (buttons, dialogs, badges) go in `src/components/ui`; shared
domain types come from `@wren/types`; the API client from `src/services`; hooks
from `src/hooks`.
