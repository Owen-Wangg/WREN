# WREN frontend steering

Context for frontend work on this writing coach. The product display name is
**LEON**; packages, paths, and AWS resources use **WREN**. Open-source under MIT.

Living user-facing copy: `docs/user-guide.md` and the in-app Guide pages.

## 1. Tech stack (current)

- React 19 + TypeScript (strict) + Vite 7
- Hosting: AWS Amplify
- REST: API Gateway; realtime: AppSync GraphQL subscriptions (UI polls REST if AppSync is unset)
- Auth: Amazon Cognito
- Server state: TanStack Query
- Styling: Tailwind CSS 4 + tokens in `frontend/src/styles/tokens/` mirrored in `theme.css`
- UI: shadcn/ui (Radix), lucide-react
- Forms: React Hook Form + Zod
- Editor: TipTap
- Charts: Recharts (department and system admin analytics)

Raw hex colors and raw `px` font sizes are forbidden in component `.tsx` files
(`wren/no-raw-design-values`). Fonts: Inter (UI) and Source Serif 4 (document body).

## 2. Personas and surfaces

Three roles. Do not bake student-only assumptions into shared components.

- **Student** — drafts, editor, AI Debrief, Ask LEON
- **Department Admin** — document types, evaluation rubric, type analytics
- **Technical Admin** (UI: **System Admin**) — model, usage limits, departments, users, department prompts

The UI reads `appConfig.appName` for the product label. Do not hardcode `LEON` or `WREN` in new UI copy.

## 3. Core compliance constraints

- **No ghostwriting:** student text and AI text must stay distinguishable. Never add a `replacementProse` field.
- **Draft anchoring:** debrief and Ask LEON content must stay tied to a draft version/span.
- **Audit:** debrief requests and regenerations should remain loggable as activity events.
- **AI disclaimer:** use `<AiDisclaimerNotice>` only; do not copy-paste the legal paragraph.
- **References:** keep document-type vs upload-tier distinctions; do not flatten into one generic upload with no type.

## 4. Known screens

| Screen | Notes |
| --- | --- |
| Auth | Login, signup, email verification |
| Student dashboard | Document cards, New Document, All Documents |
| New document | Department, document type, name, .docx/.pdf, Activate Editor |
| Editor | Continuous TipTap canvas, Contents / Ask LEON / AI Debrief rail, export |
| AI Debrief | Panel (not a detached unanchored modal), regenerate, prior-draft picker, quote-to-highlight |
| Ask LEON | Side panel, Socratic replies, quote-to-jump |
| Department Admin | Document type list, Evaluation Rubric, Analytics |
| System Admin | Model, usage limits, department users / prompt / analytics |

## 5. Component conventions

- PascalCase components under `features/<feature>/` or `pages/`
- Shared primitives in `components/ui`
- No prop drilling beyond two levels — context or a query hook

## 6. State

- Local UI: `useState` / `useReducer`
- Server: TanStack Query with explicit keys; invalidate debrief queries on regenerate
- Avoid global stores for a single editor session

## 7. Types

No `any`. Shared DTOs live in `/types` (`@wren/types`). Validate API responses with Zod at the client boundary.

## 8. Accessibility

Semantic HTML first. Modals trap focus and restore it. Status and ratings need a text equivalent, not color alone.

## 9. Don'ts

- Do not show AI Debrief without a draft reference
- Do not add a second HTTP client beside `src/services`
- Do not hardcode “the user is always a student”
- Do not treat Field Expert / Org Admin as current roles
