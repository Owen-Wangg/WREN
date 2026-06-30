# **WREN Frontend Steering**

Context for AI-assisted frontend development on WREN (Writing Refinement, Expression & Navigation), the AI-powered legal writing coach built with Allard School of Law / UBC CIC. Open-source under MIT.

---

## **1\. Tech Stack**

Fill in / confirm exact versions before treating this as binding.

* Framework: React \+ TypeScript (strict mode)  
* Hosting/build: AWS Amplify  
* Backend contracts: API Gateway (REST \+ WebSocket), Cognito auth  
* State/data fetching: TBD — recommend React Query/SWR for server state if not already chosen  
* Styling: Tailwind CSS \+ shadcn/ui (see Section 9\) — confirm before scaffolding components if not already locked in  
* UI primitives: shadcn/ui (Radix-based), lucide-react icons  
* Forms: React Hook Form \+ Zod

  ## **2\. Personas & Surfaces**

The frontend serves at least three distinct personas with different permissions and views. Do not build student-only assumptions into shared components.

* **Student** — primary drafting/feedback flow (see Section 4\)  
* **Field Expert** — review/permission role, not yet mocked; assume a separate dashboard surface  
* **Org Admin / Instructor** — multi-tenant org structure, audit visibility

Every component that touches document content or feedback should ask: "does this need a role check?" before assuming student context.

## **3\. Core Compliance Constraints (non-negotiable)**

These come directly from WREN's spec decisions and must shape component design, not just copy:

* **No-ghostwriting enforcement**: the UI must visually distinguish student-authored text from AI-suggested/AI-generated text wherever both exist in the same view. Do not build an editor component that can render AI content indistinguishably from student content.  
* **Draft anchoring**: feedback and AI debrief content must be anchored to specific draft versions/spans. Components displaying feedback need a stable reference to the draft state it was generated against — don't let feedback silently drift out of sync with edited text.  
* **Audit trail visibility**: actions that matter for academic integrity (AI debrief requests, regenerations, edits accepted/rejected) should be designed so they *can* be logged from the UI layer (emit events), even if the audit view itself is admin-facing.  
* **AI-disclaimer persistence**: the "AI-generated feedback is for support only..." notice (seen on the dashboard empty state) should be a reusable `<AiDisclaimerNotice>` component, not copy-pasted text, so it can be surfaced consistently (dashboard, debrief modal, chat panel).  
* **Two-tier reference material model**: the document creation flow (Document Type, Content/practice area, optional reference upload) must reflect which tier a reference belongs to — don't flatten this into a single generic "upload" field.

  ## **4\. Known Screens (Student Flow — confirmed via mockup)**

Use these as the canonical reference for student-facing component scope:

| Screen | Key components |
| ----- | ----- |
| Auth | `LoginForm`, `SignupForm` |
| Dashboard (empty) | `WritingEnvironmentSearch`, `StatusFilter`, `AiDisclaimerNotice` |
| New Document | `DocumentTypeSelect`, `ContentTagInput` (multi-tag, "+"-add), `DocumentNameInput`, `ReferenceFileUpload`, `ActivateEditorButton` |
| Dashboard (populated) | `WritingEnvironmentCard` (env id, title, status badge, content tag, date, overflow menu) |
| Editor | `DocumentEditor`, `EditorSidebar` (View/Regenerate AI Debrief, Ask WREN, Download) |
| AI Debrief | `AiDebriefModal`, `FeedbackDimension` (star rating \+ "What's Done Well" / "Areas for Improvement" bullets), `FeedbackHelpfulnessPrompt` (Yes/No \+ comment) |
| Ask WREN | `LeonChatPanel` (slides in alongside debrief, doesn't replace it) |
| Document review | Read-only rendered draft view (no editor controls) |

Status badges seen: **Still Drafting** (default), **Polishing** (green) — treat status as an enum, not free text, so new states can be added without UI rewrites.

## **5\. Component Conventions**

* File naming: `PascalCase.tsx` for components, colocate `Component.test.tsx` and styles next to the component.  
* Components live under `/features/<feature>/components` (e.g. `/features/editor`, `/features/dashboard`) rather than a single flat `/components` dump — WREN has enough distinct surfaces to warrant feature-based organization.  
* Shared primitives (buttons, modals, badges) go in `/components/ui`.  
* No prop drilling beyond 2 levels — lift to context or a query hook.

  ## **6\. State Management**

* Local UI state: `useState`/`useReducer`.  
* Server state (documents, debrief results, environments list): React Query (or equivalent) with explicit cache keys per environment ID — debrief data must be invalidated/refetched on "Regenerate AI Debrief," not just on mount.  
* Avoid global state for anything scoped to a single document/editor session.

  ## **7\. Type Safety**

* No `any`.  
* Shared types (Document, WritingEnvironment, FeedbackDimension, UserRole) live in `/types` and are the single source of truth — don't redefine shapes inline in components.  
* Validate API responses at the boundary (Zod or similar), especially for AI debrief payloads, since malformed feedback should fail safely, not render broken UI.

  ## **8\. Accessibility Baseline**

* Semantic HTML first; ARIA only where semantic HTML can't express it.  
* Modal (`AiDebriefModal`) must trap focus, be closable via Escape and the `×`, and return focus to the triggering button on close.  
* Status badges and star ratings need a text-equivalent, not color/icon alone.

  ## **9\. Design System & Styling Rules**

**Single source of truth for design tokens.** No hardcoded colors, font sizes, spacing values, or shadows inline in component files — ever. Centralize tokens so a palette/theme change is a one-file edit, not a find-and-replace across the codebase.

* `/styles/tokens/colors.ts` — every color used anywhere in the app is defined here as a named export (e.g. `colors.surfacePrimary`, `colors.statusDrafting`, `colors.statusPolishing`, `colors.borderSubtle`). Components import from this file; they never write a raw hex/`rgb()` value.  
* `/styles/tokens/typography.ts` — font families, the type scale (sizes \+ line-heights), and weights as named tokens (e.g. `type.heading1`, `type.body`, `type.caption`).  
* `/styles/tokens/spacing.ts` — a spacing scale (e.g. 4/8/12/16/24/32px steps) exported as tokens (`spacing.sm`, `spacing.md`...). No arbitrary one-off margin/padding values in component code.  
* `/styles/tokens/radii.ts` and `/styles/tokens/shadows.ts` — same pattern, for border-radius and elevation.  
* If using Tailwind: define these same values in `tailwind.config.ts` `theme.extend` instead of separate token files, and forbid arbitrary value classes (`bg-[#1a1a1a]`) in component code — use the configured scale only.  
* Status enums (e.g. "Still Drafting," "Polishing") map to color tokens through a single lookup (e.g. `statusColorMap`), not inline conditional styling repeated per component.

**Fonts.** Pick one display/heading face and one body face and define both in `typography.ts`/Tailwind config — individual components never reference font names directly. Suggested direction given WREN's audience (law students, professional/credible tone): a clean, legible sans for UI (e.g. Inter or IBM Plex Sans) paired with a slightly more editorial serif (e.g. Source Serif 4 or Lora) reserved specifically for document/draft content — this also visually separates "the app" from "the legal document being written," reinforcing the no-ghostwriting distinction in Section 3\. Confirm the actual choice with whoever owns WREN's visual identity before treating this as final.

**React component libraries — use these, don't reinvent:**

* **shadcn/ui** for base primitives (buttons, dialogs, dropdowns, inputs, tabs) — unstyled-by-default and themes through the same token system, which fits the single-config-file requirement better than a heavier opinionated library (e.g. MUI) would.  
* **Radix UI primitives** (which shadcn/ui is built on) directly when a needed primitive isn't in shadcn/ui yet — for accessible behavior (focus trap, keyboard nav) in things like `AiDebriefModal`, don't hand-roll this.  
* **lucide-react** for icons — one icon set, consistent stroke width, referenced by name (no inline SVGs pasted into components).  
* **React Hook Form** \+ **Zod** for all forms (login, signup, new document creation) — validation schemas live alongside the form, not scattered inline checks.  
* **Recharts** if/when usage analytics or feedback-trend visualizations are needed (e.g. an org admin dashboard) — don't introduce a second charting library.

**Enforcement, not just convention:**

* Add an ESLint rule (or simple custom rule) flagging raw hex codes (`/#[0-9a-fA-F]{3,6}/`) and raw `px` font-size declarations in `.tsx` files outside `/styles/tokens`. Kiro-generated code should fail lint if it hardcodes a color instead of importing a token.  
* Code review / spec checklist item: "Does this PR introduce any new color, font size, or spacing value outside the token files?" If yes, it goes in the token file first.

**Tone of visual design** (per the mockup): clean, low-chrome, mostly monochrome with sparse color reserved for status/state signaling (e.g. green for "Polishing"). Keep the AI disclaimer/notice visually calm — a neutral card, not a warning-yellow banner — unless legal/compliance specifically asks for more visual urgency.

## **10\. Testing Expectations**

* Every component under `/features` gets at least one render test.  
* Components touching the no-ghostwriting distinction (editor, debrief) need tests asserting AI vs. student content is visually/structurally distinguishable — this is a compliance requirement, not just a UI nicety.

  ## **11\. Explicit Don'ts**

* Don't build a single generic `<Modal>` usage for the AI Debrief without anchoring it to a specific draft version reference.  
* Don't introduce new state management libraries without flagging it.  
* Don't bypass a shared API client wrapper for fetch calls (needed for consistent auth/error handling across Cognito-protected routes).  
* Don't hardcode role assumptions (e.g. "current user is always a student") in shared components.  
* Don't flatten the two-tier reference material model into a single upload field.  
* Don't let the AI disclaimer notice be copy-pasted text in multiple places — use the shared component.

  ## **12\. Open Items (resolve before this doc is final)**

* Final font pairing — confirm with whoever owns WREN's visual identity (Section 9 gives a suggested direction, not a locked decision)  
* Document size limit placeholder — affects `ReferenceFileUpload` and `DocumentEditor` validation  
* SSO/LMS integration scope — affects `LoginForm`/`SignupForm` design if in scope  
* Field Expert and Org Admin screens — not yet mocked; this doc only covers the student surface

