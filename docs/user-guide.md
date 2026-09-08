# WREN User Guide

This guide covers how to get started with **WREN** — from creating your account to using it as a **User**, **Department Admin**, or **System Admin**. Start with [Part 1: Getting Started](#part-1-getting-started-all-users), then jump to the part that matches your role.

**Names you will see:** **WREN** is the product name in the app. In the repository and AWS, the project prefix is **WREN**. The System Admin screens correspond to the `TechnicalAdmin` role in the API and database.

## Table of Contents

- [WREN User Guide](#wren-user-guide)
  - [Table of Contents](#table-of-contents)
  - [Part 1: Getting Started (All Users)](#part-1-getting-started-all-users)
    - [1.1 Log In](#11-log-in)
    - [1.2 Create an Account (First-Time Users Only)](#12-create-an-account-first-time-users-only)
    - [1.3 Choosing Your Account View](#13-choosing-your-account-view)
  - [Part 2: Writer Guide](#part-2-writer-guide)
    - [2.1 Creating a New Document Draft](#21-creating-a-new-document-draft)
    - [2.2 Opening and Reviewing Your Document](#22-opening-and-reviewing-your-document)
    - [2.3 Using AI Debrief](#23-using-ai-debrief)
    - [Quick Recap — User](#quick-recap--user)
  - [Part 3: Department Admin Guide](#part-3-department-admin-guide)
    - [3.1 How the Department Admin Screens Are Organized](#31-how-the-department-admin-screens-are-organized)
    - [3.2 Configuring the Evaluation Rubric](#32-configuring-the-evaluation-rubric)
    - [3.3 Reviewing Analytics](#33-reviewing-analytics)
    - [Quick Reference — Department Admin](#quick-reference--department-admin)
  - [Part 4: System Admin Guide](#part-4-system-admin-guide)
    - [4.1 How the System Admin Screens Are Organized](#41-how-the-system-admin-screens-are-organized)
    - [4.2 Model Configuration](#42-model-configuration)
    - [4.3 Setting Usage Limits](#43-setting-usage-limits)
    - [4.4 Creating New Departments](#44-creating-new-departments)
    - [4.5 Managing Departments](#45-managing-departments)
    - [4.6 Department-Level Prompt Management](#46-department-level-prompt-management)
    - [4.7 Reviewing Department Analytics](#47-reviewing-department-analytics)
    - [Quick Reference — System Admin](#quick-reference--system-admin)

---

## Part 1: Getting Started (All Users)

### 1.1 Log In

> **First time here?** Create an account first — see [1.2 Create an Account](#12-create-an-account-first-time-users-only), then return here.

1. Open the WREN URL your administrator gave you (or the AWS Amplify URL).
2. Enter the email address and password you used when creating your account.
3. Click **Login**.
4. You land on the dashboard for your current account view.

### 1.2 Create an Account (First-Time Users Only)

**Note:** Skip this section if you already have an account and go to [1.1 Log In](#11-log-in).

1. Click **Sign Up**.
2. Enter:
   - Your email address
   - A new password for WREN

   Follow the password rules listed on the page (length, letters, numbers, or symbols as shown).

3. After you submit, WREN sends a **verification code** to that email.

   **Important:** Keep the sign-up page open while you check email.

4. Find the code in your inbox (check spam if it does not arrive within a few minutes).
5. Return to the sign-up page and enter the code.
6. Your account is ready. Continue to [1.1 Log In](#11-log-in).

### 1.3 Choosing Your Account View

Open your profile and select your account view. That choice sets which dashboard you see:

- **User** — drafts, AI Debrief, and Ask WREN. See [Part 2](#part-2-writer-guide).
- **Department Admin** — document types, evaluation rubrics, and type-level analytics. See [Part 3](#part-3-department-admin-guide).
- **System Admin** — model, usage limits, departments, users, department prompts, and department analytics. See [Part 4](#part-4-system-admin-guide).

You can switch views from your profile at any time if your account holds more than one role.

---

## Part 2: Writer Guide

On the **User Dashboard** you will see your existing drafts, or an empty state if you have not created one yet.

<img width="957" height="395" alt="User dashboard" src="https://github.com/user-attachments/assets/a0050ec6-575d-48fe-bc46-d5aecbdb2107" />

### 2.1 Creating a New Document Draft

1. From the User Dashboard, find **New Document** in the top-right corner of the screen (next to **All Documents**, which is the page you are currently on).
<img width="1914" height="790" alt="Screenshot 2026-08-24 164814" src="https://github.com/user-attachments/assets/2ad36a0a-4d9b-4baf-83a6-f7772f10c440" />

2. Click **New Document**.

3. Select your department.

   **Which departments appear?** A **Visible** department appears for every user. A **Permitted users only** department appears only if a System Admin gave you an explicit visibility permission, or if your account is a Technical Admin or the Department Admin appointed to that department. This affects the **New Document** department list only; it does not remove your existing documents.

   Seeing a department does not necessarily mean you can submit to every document type. **Open** allows self-service submission, while **Locked** requires a separate document-type Access Grant. If an expected department is missing, contact your System Admin.

4. Choose your document type — for example, **Legal Memorandum**.

5. Give your draft a name.

6. Click **Choose File** and select the file from your computer that you want to upload. WREN accepts **DOCX** and **PDF** files.

<img width="956" height="368" alt="Choose a DOCX or PDF file to upload" src="https://github.com/user-attachments/assets/5c284420-bbfa-4e77-b675-14e2dc247690" />

7. Click **Activate Editor** to finish creating the draft.

8. You are returned to the **My Documents** page, where your newly uploaded draft is now listed, and you will be taken to the following page:
<img width="956" height="415" alt="Newly created draft in My Documents" src="https://github.com/user-attachments/assets/c652ca27-01f6-4aa9-9314-985318bcb573" />

### 2.2 Opening and Reviewing Your Document

1. From **All Documents**, click the draft you want to open. The editor shows a continuous document on the right and a side panel on the left.
2. The document is not split into pages on screen. Headers and footers sit at the top and bottom of the draft. The **Contents** panel shows the draft version, word count, and an estimated printed page count (US Letter). Heading 1–3 styles build an outline; click a heading to jump to it.
3. Hover or drag the scrollbar to see an estimated printed page, for example **Page 2 of 17**. 
4. The left icon rail switches the panel between **Contents**, **Ask WREN**, and **AI Debrief**.
<img width="1912" height="829" alt="Editor with Ask WREN and AI Debrief" src="https://github.com/user-attachments/assets/2bc18352-af6a-48dd-a61a-5db705046320" />

**Other options in this view:**

- **Upload a new draft** — use this if changes were made to your document in another editor and you need WREN to review the updated version.
  
<img width="960" height="412" alt="image" src="https://github.com/user-attachments/assets/484861de-deb2-4fcf-b58e-216dee59eb97" />

- **Export** — use this to download your document after changes have been made.

<img width="959" height="412" alt="image" src="https://github.com/user-attachments/assets/d31b8995-9545-4531-8c9e-04411dbd8c70" />

- **Adjust the panel** — click on the grey bar on the right side of the AI Debrief panel to expand or minimize it.

<img width="959" height="412" alt="image" src="https://github.com/user-attachments/assets/544ace4d-b433-437f-8472-14376b80b177" />

### 2.3 Using AI Debrief

**Generate or view a debrief**

1. Click **Regenerate** to generate a new AI Debrief report on your document.
<img width="956" height="413" alt="Regenerate AI Debrief" src="https://github.com/user-attachments/assets/3f598ac5-b9fc-4077-b0b8-a6b41b98f6a8" />
2. To view a previously generated report, click the **drop-down arrow** and select an earlier draft's report from the list.
<img width="959" height="416" alt="Select an earlier debrief report" src="https://github.com/user-attachments/assets/3ce5e503-c9b9-498c-bbae-457a354d57d9" />

**Ask WREN about the debrief**

1. Click **Ask WREN** (the WREN icon) on the left rail.
2. Ask questions about the debrief, your draft, or writing craft (clarity, organization, tone, and similar).
3. Click a quoted phrase in a reply to jump to that passage.
<img width="958" height="412" alt="Ask WREN chat" src="https://github.com/user-attachments/assets/0b5d2ba7-27b3-4c33-a726-e6882021007e" />

Ask WREN will not write or rewrite your sentences, fact-check legal or technical claims, or answer questions unrelated to this draft.

### Quick Recap — User

| Task | Where to go |
| --- | --- |
| Create an account | Sign Up → email/password → verify the email code |
| Log in | Login → email/password |
| Start a new draft | User Dashboard → New Document → department → document type → upload .docx or .pdf → Activate Editor |
| Review AI feedback | Open document → AI Debrief |
| Ask questions about your draft | Open document → Ask WREN |
| Update a draft | Editor → Upload New Draft |
| Save a copy | Editor → Export (DOCX or PDF) |

---

## Part 3: Department Admin Guide

As a **Department Admin**, you configure document types and evaluation criteria for the department(s) you administer, and you review aggregate analytics. User-facing debriefs are generated against the rubric you save.

After you choose **Department Admin** as your account view (see [1.3](#13-choosing-your-account-view)), you land on the Department Admin dashboard.

### 3.1 How the Department Admin Screens Are Organized

This section is a map of the Department Admin area. It orients you to what each screen is for so the step-by-step instructions in [3.2](#32-configuring-the-evaluation-rubric) and [3.3](#33-reviewing-analytics) make sense. In short: the **Dashboard** is where you pick or create a document type, the **Evaluation Rubric** is where you tell the AI how to coach on that type, and **Analytics** is where you see how users are responding.

- **Profile** — switch account view (User / Department Admin / System Admin, depending on your roles).

<img width="1870" height="813" alt="image" src="https://github.com/user-attachments/assets/529f9101-fb8e-4dd8-9e32-9d36953b4ce4" />

- **Dashboard** — document types for the department you are managing. If you administer more than one department, a selector on the banner switches which department you are editing. **Create New Document Type** is on the right.

<img width="943" height="412" alt="Department Admin dashboard" src="https://github.com/user-attachments/assets/4beb78da-7c6a-462c-ba6f-94749121db63" />

- **Document type** — opens when you select a type. Two areas: **Evaluation Rubric** and **Analytics**.

<img width="950" height="413" alt="Document type Evaluation Rubric and Analytics" src="https://github.com/user-attachments/assets/3c9ac6ea-feee-4d36-9d63-9f507a28a9e9" />

- **Evaluation Rubric** — **Document Context** (purpose, common mistakes, additional background, citation guide) and **Evaluation Criteria** (categories the AI should use). Click **Save Rubric** when you are done.
  
<img width="935" height="409" alt="Evaluation Rubric categories" src="https://github.com/user-attachments/assets/361ff81e-4ba7-4dd5-ad90-c683bb13a939" />

- **Analytics** — user improvement trends, AI Debrief helpfulness (aggregate yes/no ratings), and section applicability. Figures are aggregates, not per-user scores.

<img width="950" height="407" alt="Document type analytics" src="https://github.com/user-attachments/assets/1b1427c0-02f6-4dd2-9f74-ff7e1c45ed16" />

### 3.2 Configuring the Evaluation Rubric

The Evaluation Rubric is where you define how the AI evaluates a specific document type. It has two parts. **Document Context** tells the AI what the document is and what good looks like — its purpose, common mistakes, background, and citation style. **Evaluation Criteria** are the named categories (clarity, structure, tone, and so on) the AI scores against. Whatever you save here is the standard every user's debrief for this document type is generated against.

**Step 1 — Fill in Document Context**

1. Expand **Document Context**.
2. Fill in **Purpose** (what the document is for and what good looks like), **Common mistakes to avoid**, and **Additional background**.
3. Optionally choose a **Citation guide** (for example, the McGill Guide) so the AI evaluates references consistently.

<img width="1536" height="1024" alt="Document Context fields" src="https://github.com/user-attachments/assets/7ee641f9-4749-404e-b308-146254404519" />

**Step 2 — Set up Evaluation Criteria**

1. Select an existing category to open its configuration form, or click **add custom criterion** to create a new one.
2. Fill in the form with the requirements the AI should evaluate against for this document type — for example, what does clarity look like for an appellate factum?

<img width="859" height="401" alt="Evaluation Criteria form" src="https://github.com/user-attachments/assets/47d93e8b-8b9d-404f-acac-57c5fd833046" />

**Step 3 — Save**

Click **Save Rubric** when you are done. This screen does not autosave, so unsaved changes are lost if you leave without saving.

<img width="1536" height="1024" alt="Evaluation Criteria categories" src="https://github.com/user-attachments/assets/c62f4476-d14e-4155-a50f-2ea6e1d7d27d" />

### 3.3 Reviewing Analytics

Analytics lets you see how well the rubric is working for a document type. It answers three questions: are users improving over time, do they find the AI Debrief helpful, and are the feedback sections you configured actually applying to real submissions. All figures are aggregates across users, not per-user scores.

- If most users rate a category's feedback "not helpful," the wording in your Evaluation Rubric is probably too vague or off-target. That is a signal to go back to [3.2](#32-configuring-the-evaluation-rubric) and sharpen it.
- If a feedback section rarely marks as applicable, it may not fit the document type — you can simplify the rubric by removing or rewording it.
- Improvement trends over a term give you evidence to share with colleagues or leadership that users' drafts are getting stronger.
- Comparing categories tells you which parts of the rubric are doing the most work and which need attention.

Because the data is aggregated, you get this insight without inspecting anyone's individual work.

**What each metric shows:**

- **User improvement** — how debrief-related signals change over time (date-range presets or custom range), including whether users addressed the feedback flagged in their previous drafts.
- **AI Debrief helpfulness** — aggregate user ratings (helpful / not helpful) and optional comments.
- **Section applicability** — whether feedback sections applied to the draft, in aggregate.

<img width="706" height="399" alt="User improvement trends" src="https://github.com/user-attachments/assets/d7558de7-dc06-495a-bd37-558cf0a87078" />
<img width="544" height="122" alt="Improvement summary" src="https://github.com/user-attachments/assets/8712c5ea-ffa1-4817-853f-fae22da2fe25" />

**How to review AI Debrief quality:**

1. Review the **Helpfulness Breakdown** — a visual showing what percentage of feedback users rated helpful versus not helpful.
2. Review **Feedback Section Applicability** — applicable / not applicable indicators tied to each evaluation category you configured in [3.2 Configuring the Evaluation Rubric](#32-configuring-the-evaluation-rubric) (for example, "Was the tone feedback useful? Yes/No").

<img width="1447" height="685" alt="Helpfulness and applicability breakdown" src="https://github.com/user-attachments/assets/d70c2cf6-a983-4eb5-8d1f-c5f29e50a9a4" />

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

Before diving into the steps, here's where things live on the platform:

- **Profile** — click your profile to switch your account view between User, Department Admin, and System Admin.

<img width="1870" height="813" alt="image" src="https://github.com/user-attachments/assets/529f9101-fb8e-4dd8-9e32-9d36953b4ce4" />

- **Dashboard** — the main screen after choosing System Admin. Your list of departments is shown here, alongside **Usage Limits** and **Model Configuration**.

<img width="944" height="297" alt="image" src="https://github.com/user-attachments/assets/04c3dd29-6923-433b-9e4d-211c27c67975" />
<img width="917" height="310" alt="image" src="https://github.com/user-attachments/assets/fa25a40d-91a0-4b9f-a1b6-16faaab5cf35" />

- **Department Controls** — opens when you select or create a department. It's organized into three areas: **Manage Users**, **Manage Department Prompt**, and **View Analytics**.
- **Inside Manage Users** — manage participant roles and explicit department visibility permissions. Only the System Admin (`TechnicalAdmin` in the API and database) can change department visibility or these permissions.

**Two independent controls:**

- **Department visibility — Visible / Permitted users only:** controls whether the department appears in user catalog and New Document views.
- **User access — Open / Locked:** controls submission. Open requires no document-type Access Grant; Locked requires an active document-type Access Grant.

Changing one control does not change the other.

<img width="1867" height="810" alt="image" src="https://github.com/user-attachments/assets/f37e9e4d-f13a-4149-8f11-03550340dc3a" />


- **Inside Manage Department Prompt** — **Department Context** sits at the top, followed by **Writing Standards**, then **Restricted Topics**.


- **Inside Analytics** — **Active Users** appears first, followed by **Documents Generated**, then **Debriefs Generated**.

### 4.2 Model Configuration

1. Go to **System Admin Dashboard → System Configuration → Model Configuration**.
2. Review the list of available AI models.
3. Select the model you want to set as the platform default.
4. Click **Save**.

<img width="910" height="385" alt="image" src="https://github.com/user-attachments/assets/b9ec4bef-0b50-4b22-9c22-aaab06e8ee62" />

**Notes:**

Model changes apply immediately to new AI Debrief and Ask WREN calls. Existing debriefs are unchanged. Different models can differ in quality, cost, and latency.

### 4.3 Setting Usage Limits

Usage Limits cap how many AI Debriefs and documents can be generated in a given period. Each debrief and Ask WREN interaction is a call to a paid AI model.

- **Cost control.** AI usage bills per call. Setting a ceiling keeps spend predictable and protects against a runaway bill from unexpectedly heavy use.
- **Encouraging thoughtful use.** When debriefs are not unlimited, users tend to treat each one as meaningful — revising the draft before regenerating rather than clicking repeatedly. 

You can apply limits platform-wide or per department, so a high-volume department can get more headroom than others. Start conservative; you can always raise a limit if users legitimately hit it.

1. Go to **System Admin Dashboard → System Configuration → Usage Limits**.
2. Set limits for:
   - **AI Debriefs allowed** — the maximum number of debriefs a user or department can generate in a given period.
   - **Documents allowed** — the maximum number of documents a user or department can create or process in a given period.
3. Choose whether limits apply platform-wide or per department.
4. Click **Save Changes**.

<img width="931" height="413" alt="image" src="https://github.com/user-attachments/assets/4e046f13-c2c6-4150-8bcc-68c60f85a331" />

**Notes:**

These limits apply to all users in all departments. They are not per-calendar-period quotas.

### 4.4 Creating New Departments

1. Go to **System Admin Dashboard → Departments → Create New Department**.

<img width="936" height="381" alt="image" src="https://github.com/user-attachments/assets/14cff36a-00bc-4265-8c91-4074eb697c56" />

2. Enter the department name.

<img width="892" height="375" alt="image" src="https://github.com/user-attachments/assets/cd9e8bfd-554e-484d-9754-affc81143f29" />

3. Assign an initial Department Admin by clicking the pen symbol to the right of a user's name and selecting **Department Admin** (optional — can be done later from Manage Users, see [4.5 Managing Departments](#45-managing-departments)).

<img width="628" height="742" alt="image" src="https://github.com/user-attachments/assets/8b8715d7-ea2e-4f61-9a1e-f08e26443295" />

**Notes:**

- Once created, a department appears in the department list and can be opened as described in [4.5 Managing Departments](#45-managing-departments).
- Departments generally can't be merged after creation, so plan your structure before creating many of them.
- Set initial usage limits, or leave them at the platform default (see [4.3 Setting Usage Limits](#43-setting-usage-limits)).

### 4.5 Managing Departments

1. Go to **System Admin Dashboard → Departments** and select the department you want to manage.
<img width="936" height="381" alt="image" src="https://github.com/user-attachments/assets/14cff36a-00bc-4265-8c91-4074eb697c56" />

2. Under **Manage Users**, you can search participants and assign or revoke roles. Assigning **Department Admin** here scopes that role to this department.
3. Use **User access → Open / Lock** to control submission:
   - **Open** — no document-type Access Grant is required.
   - **Locked** — users require an approved document-type Access Grant before submitting.

   Locking does not prevent login, remove existing documents, or hide the department from the catalog.
4. Use **Department visibility → Visible / Permitted users only** to control catalog discovery:
   - **Visible** — shown to all users.
   - **Permitted users only** — shown only to explicitly permitted users, all Technical Admins, and Department Admins appointed to this department.
5. Under **Permitted users**, search the global user directory to grant or revoke explicit visibility permission. Permissions are retained while the department is Visible and automatically take effect if it is changed back to Permitted users only. Revoking an explicit permission does not remove a Technical Admin or scoped Department Admin's automatic discovery access.

<img width="1864" height="805" alt="names_emails_only_blurred" src="https://github.com/user-attachments/assets/09497a94-13f9-4f70-ae40-61b8c14de4ef" />

**Important:** A visibility permission controls discovery only. It does not grant submission to a Locked document type; that requires a document-type Access Grant.

**Security limitation:** Department visibility is a UI-only discovery filter, not an authorization or confidentiality boundary. The API returns active department rows with a `viewerCanDiscover` decision and the client filters catalog and New Document views. A user calling APIs directly may still learn department metadata and, when submission access is Open, may submit if they know the relevant IDs. Do not use **Permitted users only** to protect confidential department names or data. Use **Locked** plus document-type Access Grants to enforce submission eligibility; archive a department when it must stop accepting new submissions.

### 4.6 Department-Level Prompt Management

The department prompt sets instructions the AI applies across every document type in the department. Use it for guidance that should hold department-wide — who the writers are, the standards they follow, and topics the AI should avoid — rather than criteria specific to one document type (those live in the Department Admin Evaluation Rubric, see [3.2](#32-configuring-the-evaluation-rubric)).

1. Go to **System Admin Dashboard → Departments → [Department Name] → Manage Department Prompt**.
2. Configure the following:
   - **Department Context** — background the AI should always consider for this department (e.g., subject area, program level, institutional norms).
   - **Writing Standards** — style, tone, formatting, and citation requirements the AI should follow when generating documents or debriefs for this department.
   - **Restricted Topics** — topics, terms, or content areas the AI should avoid or flag when interacting with this department's users.
3. Click **Save Prompt**.
4. Optionally, test the configuration by generating a sample document or debrief before rolling it out.

<img width="1536" height="1024" alt="Manage Department Prompt fields" src="https://github.com/user-attachments/assets/c739a17c-7454-493e-b3f5-2e526a76cff6" />

### 4.7 Reviewing Department Analytics

Department Analytics gives you a platform- or department-level view of usage and adoption. Use it to see how actively a department is using WREN, track volume over time, and support capacity and cost planning alongside [Usage Limits](#43-setting-usage-limits).

1. Go to **System Admin Dashboard → Departments → [Department Name] → View Analytics** (or a platform-wide analytics view, if available).
2. Review key metrics, including:
   - **Active Users** — number of users who logged in or used the platform within a selected time range.
   - **Documents Generated** — total document creation volume over time.
   - **Debriefs Generated** — total AI Debrief volume over time.

<img width="911" height="302" alt="Department analytics totals" src="https://github.com/user-attachments/assets/539979ef-8a54-41a8-bfc3-764fc87d4b43" />
<img width="725" height="296" alt="Usage over time" src="https://github.com/user-attachments/assets/3b319c83-71de-4e06-8862-42ef7101baa6" />

Figures are aggregates. They do not include per-user scores.

### Quick Reference — System Admin

| Action | Where to go |
| --- | --- |
| Choose AI model | Dashboard → Model Configuration |
| Set usage limits | Dashboard → Usage Limits |
| Create a department | Dashboard → create department |
| Promote or manage users | Department → Manage Users |
| Control catalog discovery | Department → Department visibility → Visible / Permitted users only |
| Manage explicit discovery | Department → Manage Users → Permitted users |
| Control submission | Department → User access → Open / Lock |
| Set department context and standards | Department → Manage Department Prompt |
| Review department analytics | Department → View Analytics |
