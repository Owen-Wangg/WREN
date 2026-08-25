# LEON User Guide

This guide covers how to get started with **LEON** — from creating your account to using it as a **Student**, **Department Admin**, or **System Admin**. Start with [Part 1: Getting Started](#part-1-getting-started-all-users), then jump to the part that matches your role.

**Names you will see:** **LEON** is the product name in the app. In the repository and AWS, the project prefix is **WREN**. The System Admin screens correspond to the `TechnicalAdmin` role in the API and database.

## Table of Contents

- [Part 1: Getting Started (All Users)](#part-1-getting-started-all-users)
  - [1.1 Log In](#11-log-in)
  - [1.2 Create an Account (First-Time Users Only)](#12-create-an-account-first-time-users-only)
  - [1.3 Choosing Your Account View](#13-choosing-your-account-view)
- [Part 2: Student Guide](#part-2-student-guide)
  - [2.1 Creating a New Document Draft](#21-creating-a-new-document-draft)
  - [2.2 Opening and Reviewing Your Document](#22-opening-and-reviewing-your-document)
  - [2.3 Using AI Debrief](#23-using-ai-debrief)
  - [2.4 Using Ask LEON](#24-using-ask-leon)
  - [Quick Recap — Student](#quick-recap--student)
- [Part 3: Department Admin Guide](#part-3-department-admin-guide)
  - [3.1 How the Department Admin Screens Are Organized](#31-how-the-department-admin-screens-are-organized)
  - [3.2 Opening a Document Type](#32-opening-a-document-type)
  - [3.3 Setting Up the Evaluation Rubric](#33-setting-up-the-evaluation-rubric)
  - [3.4 Reviewing Analytics](#34-reviewing-analytics)
  - [Quick Reference — Department Admin](#quick-reference--department-admin)
- [Part 4: System Admin Guide](#part-4-system-admin-guide)
  - [4.1 How the System Admin Screens Are Organized](#41-how-the-system-admin-screens-are-organized)
  - [4.2 Model Configuration](#42-model-configuration)
  - [4.3 Setting Usage Limits](#43-setting-usage-limits)
  - [4.4 Creating New Departments](#44-creating-new-departments)
  - [4.5 Managing Departments](#45-managing-departments)
  - [4.6 Department Prompt](#46-department-prompt)
  - [4.7 Reviewing Department Analytics](#47-reviewing-department-analytics)
  - [Quick Reference — System Admin](#quick-reference--system-admin)

---

## Part 1: Getting Started (All Users)

### 1.1 Log In

> **First time here?** Create an account first — see [1.2 Create an Account](#12-create-an-account-first-time-users-only), then return here.

1. Open the LEON URL your administrator gave you (or the AWS Amplify URL).
2. Enter the email address and password you used when creating your account.
3. Click **Login**.
4. You land on the dashboard for your current account view.

### 1.2 Create an Account (First-Time Users Only)

**Note:** Skip this section if you already have an account and go to [1.1 Log In](#11-log-in).

1. Click **Sign Up**.
2. Enter:
   - Your institutional email address
   - A new password for LEON

   Follow the password rules listed on the page (length, letters, numbers, or symbols as shown).

3. After you submit, LEON sends a **verification code** to that email.

   **Important:** Keep the sign-up page open while you check email.

4. Find the code in your inbox (check spam if it does not arrive within a few minutes).
5. Return to the sign-up page and enter the code.
6. Your account is ready. Continue to [1.1 Log In](#11-log-in).

### 1.3 Choosing Your Account View

Open your profile and select your account view. That choice sets which dashboard you see:

- **Student** — drafts, AI Debrief, and Ask LEON. See [Part 2](#part-2-student-guide).
- **Department Admin** — document types, evaluation rubrics, and type-level analytics. See [Part 3](#part-3-department-admin-guide).
- **System Admin** — model, usage limits, departments, users, department prompts, and department analytics. See [Part 4](#part-4-system-admin-guide).

You can switch views from your profile at any time if your account holds more than one role.

---

## Part 2: Student Guide

On the **Student Dashboard** you will see your existing drafts, or an empty state if you have not created one yet.

<img width="957" height="395" alt="Student dashboard" src="https://github.com/user-attachments/assets/a0050ec6-575d-48fe-bc46-d5aecbdb2107" />

### 2.1 Creating a New Document Draft

1. From the Student Dashboard, click **New Document** (top right, next to **All Documents**).
<img width="1914" height="790" alt="New Document on the student dashboard" src="https://github.com/user-attachments/assets/2ad36a0a-4d9b-4baf-83a6-f7772f10c440" />
2. Select your department.
3. Choose your document type (for example, Legal Memorandum).
4. Give the document a name.
5. Choose a file from your computer. Prefer a **.docx** Word file so fonts, headings, lists, tables, and images come through more accurately. **PDF** is supported, including many scanned files, but layout is best-effort.
<img width="956" height="368" alt="File upload on new document" src="https://github.com/user-attachments/assets/5c284420-bbfa-4e77-b675-14e2dc247690" />
6. Click **Activate Editor**. You open in the editor with that draft loaded. The same document also appears under **All Documents**.

### 2.2 Opening and Reviewing Your Document

1. From **All Documents**, click the draft you want to open. The editor shows a continuous document on the right and a side panel on the left.
2. The document is not split into pages on screen. Headers and footers sit at the top and bottom of the draft. The **Contents** panel shows the draft version, word count, and an estimated printed page count (US Letter). Heading 1–3 styles build an outline; click a heading to jump to it.
3. Hover or drag the scrollbar to see an estimated printed page, for example **Page 2 of 17**. That is how the document is expected to paginate on preview or export, not a live page break in the editor.
4. The left icon rail switches the panel between **Contents**, **Ask LEON**, and **AI Debrief**.

**Other options in this view:**

- **Upload New Draft** — use this if you edited the file in another program and need LEON to review the updated version.
- **Export** — download as DOCX or PDF. You can optionally include the AI Debrief on PDF, or open a US Letter **Preview** first.
- **Close** the side panel (or drag the divider) if you want more space for the document.

### 2.3 Using AI Debrief

1. Click **AI Debrief** on the left rail. The panel shows your latest report.
2. Click **Regenerate** to save any inline edits and generate a new debrief.
3. To open an earlier report, use the drop-down and pick a previous draft’s debrief.
4. Click a quoted passage in the debrief to highlight it in the document.

LEON coaches with questions. It does not rewrite your essay.

### 2.4 Using Ask LEON

1. Click **Ask LEON** (the LEON icon) on the left rail.
2. Ask questions about the debrief, your draft, or writing craft (clarity, organization, tone, and similar).
3. Click a quoted phrase in a reply to jump to that passage.

Ask LEON will not write or rewrite your sentences, fact-check legal or technical claims, or answer questions unrelated to this draft.

### Quick Recap — Student

| Task | Where to go |
| --- | --- |
| Create an account | Sign Up → email/password → verify the email code |
| Log in | Login → email/password |
| Start a new draft | Student Dashboard → New Document → department → document type → upload .docx or .pdf → Activate Editor |
| Review AI feedback | Open document → AI Debrief |
| Ask questions about your draft | Open document → Ask LEON |
| Update a draft | Editor → Upload New Draft |
| Save a copy | Editor → Export (DOCX or PDF) |

---

## Part 3: Department Admin Guide

As a **Department Admin**, you configure document types and evaluation criteria for the department(s) you administer, and you review aggregate analytics. Student-facing debriefs are generated against the rubric you save.

After you choose **Department Admin** as your account view (see [1.3](#13-choosing-your-account-view)), you land on the Department Admin dashboard.

### 3.1 How the Department Admin Screens Are Organized

- **Profile** — switch account view (Student / Department Admin / System Admin, depending on your roles).
- **Dashboard** — document types for the department you are managing. If you administer more than one department, a selector on the banner switches which department you are editing. **Create New Document Type** is on the right.
- **Document type** — opens when you select a type. Two areas: **Evaluation Rubric** and **Analytics**.
- **Evaluation Rubric** — **Document Context** (purpose, common mistakes, additional background, citation guide) and **Evaluation Criteria** (categories the AI should use). Click **Save Rubric** when you are done; this screen does not autosave.
- **Analytics** — student improvement trends, AI Debrief helpfulness (aggregate yes/no ratings), and section applicability. Figures are aggregates, not per-student scores.

Student access for a department (open vs locked) is controlled by a System Admin, not from this dashboard.

### 3.2 Opening a Document Type

1. Confirm the banner shows the department you want to manage.
2. To work with an existing type, click it in the list.
3. To add one, click **Create New Document Type**, enter a name, and click **Create**.
4. You can delete a type only when no documents still use it.

Either create or select takes you into that type. Then choose **Evaluation Rubric** or **Analytics**.

### 3.3 Setting Up the Evaluation Rubric

**Document Context**

1. Expand **Document Context**.
2. Fill in **Purpose**, **Common mistakes to avoid**, and **Additional background**.
3. Optionally choose a **Citation guide** (for example McGill Guide) so the AI evaluates references consistently.

**Evaluation Criteria**

1. Default categories (Tone, Organisation, Citations, and similar) are created for a new type. Select the ones this type should use.
2. Expand a selected criterion to define what it means for this document type. Organisation criteria can use a framework such as IRAC, CREAC, point-first, or a custom description.
3. Add a custom criterion if you need one that is not in the defaults.
4. Click **Save Rubric**.

### 3.4 Reviewing Analytics

Open **Analytics** for the document type.

- **Student improvement** — how debrief-related signals change over time (date-range presets or custom range).
- **AI Debrief helpfulness** — aggregate student ratings (helpful / not helpful) and optional comments.
- **Section applicability** — whether feedback sections applied to the draft, in aggregate.

These views do not change your rubric. Use them to see whether criteria and prompts are working as intended.

### Quick Reference — Department Admin

| Action | What happens |
| --- | --- |
| Switch department | Use the department selector on the dashboard banner (if you administer more than one) |
| Create a document type | Create New Document Type → name → Create |
| Open a type | Click it in the list |
| Set coaching rules | Evaluation Rubric → Document Context + criteria → Save Rubric |
| Check results | Analytics for that document type |

---

## Part 4: System Admin Guide

As a **System Admin**, you sit above the department level: you choose the Bedrock model, set platform usage limits, create departments, manage users and access, edit department-level prompts, and review department analytics.

After you choose **System Admin** as your account view (see [1.3](#13-choosing-your-account-view)), you land on **System Configuration** and the department list.

### 4.1 How the System Admin Screens Are Organized

- **Profile** — switch account view.
- **Dashboard** — **Model Configuration** and **Usage Limits** at the top, then the list of departments.
- **Department** — opens when you select a department: **Lock / Open** student access, **Manage Users**, **Manage Department Prompt**, and **View Analytics**.

### 4.2 Model Configuration

1. On the System Admin dashboard, expand **Model Configuration**.
2. Choose the active Bedrock model from the allowed list.
3. Click **Save**.

Model changes apply immediately to new AI Debrief and Ask LEON calls. Existing debriefs are unchanged. Different models can differ in quality, cost, and latency.

### 4.3 Setting Usage Limits

1. Expand **Usage Limits**.
2. Set lifetime maxima for:
   - Ask LEON messages per document
   - AI Debrief generations per document
   - Document uploads
   - Drafts per document
3. Click **Save Changes**.

These limits apply to all users in all departments. They are not per-calendar-period quotas.

### 4.4 Creating New Departments

1. On the dashboard, click **Create New Department** (or the equivalent create control on the department list).
2. Enter a department name.
3. Create the department, then open it to appoint Department Admins and set the prompt (see [4.5](#45-managing-departments) and [4.6](#46-department-prompt)).

### 4.5 Managing Departments

1. Select a department from the list.
2. Use **Lock** / **Open** to control whether students can self-serve document types in that department. Locked departments typically require an access grant. Locking does not delete data.
3. Open **Manage Users** to search users, edit roles (**Student**, **DepartmentAdmin**, **TechnicalAdmin**), and appoint a Department Admin for this department.
4. Role changes take effect on the next authorized request.

### 4.6 Department Prompt

1. Open the department → **Manage Department Prompt**.
2. Fill in:
   - **Department Context** — who the writers are and what the program is
   - **Writing Standards** — citation style, register, formatting
   - **Restricted Topics** — subjects the coach should avoid or flag
3. Click **Save Prompt**.

These instructions apply across document types in that department. Per-type detail still lives in the Department Admin Evaluation Rubric.

### 4.7 Reviewing Department Analytics

1. Open the department → **View Analytics**.
2. Review totals for documents, drafts, and active users, plus breakdown by document type and usage over time.

Figures are aggregates. They do not include per-student scores.

### Quick Reference — System Admin

| Action | Where to go |
| --- | --- |
| Choose AI model | Dashboard → Model Configuration |
| Set usage limits | Dashboard → Usage Limits |
| Create a department | Dashboard → create department |
| Promote or manage users | Department → Manage Users |
| Lock or open student access | Department → Lock / Open |
| Set department context and standards | Department → Manage Department Prompt |
| Review department analytics | Department → View Analytics |
