# WREN User Guide

Welcome to the WREN User Guide! This guide covers how to get started with **WREN** — from creating your account to using its features as a **Student**, **Department Admin**, or **System Admin**. Start with [Part 1: Getting Started](#part-1-getting-started-all-users), then jump to the part that matches your role.

Please note that this document follows different naming conventions. For instance, **WREN** is used to refer to the product in its broader application as a writing tool, while **LEON** refers to the product's origins in a legal context. **Both names refer to the same product.** Similarly, the term '**System Admin**' is used throughout the user guide to describe a role, but this role is referred to as the 'Technical Admin' role in the API and database.

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

---

## Part 2: Writer Guide

Once you have logged in, you will be taken to the **Student Dashboard,** where you will see any existing drafts.

<img width="957" height="395" alt="User dashboard" src="https://github.com/user-attachments/assets/a0050ec6-575d-48fe-bc46-d5aecbdb2107" />

### 2.1 Creating a New Draft

1. From the User Dashboard, find **New Document** in the top-right corner of the screen (next to **All Documents**, which is the page you are currently on).
<img width="1914" height="790" alt="Screenshot 2026-08-24 164814" src="https://github.com/user-attachments/assets/2ad36a0a-4d9b-4baf-83a6-f7772f10c440" />

2. Click **New Document**.

3. Select your department.

   **Which departments appear?** A **Visible** department appears for every user. A **Permitted users only** department appears only if a System Admin gave you an explicit visibility permission, or if your account is a Technical Admin or the Department Admin appointed to that department. This affects the **New Document** department list only; it does not remove your existing documents.

   Seeing a department does not necessarily mean you can submit to every document type. **Open** allows self-service submission, while **Locked** requires a separate document-type Access Grant. If an expected department is missing, contact your System Admin.

4. Choose your document type — for example, **Legal Memorandum**.

5. Give your draft a name.

6. Click **Choose File** and select the PDF or DOCX file from your computer that you want to upload. Uploading a DOCX file will provide formatting that is more accurate to the original document.

7. Click **Activate Editor** to finish creating the draft.

7. After uploading, you will be taken to the following page:
<img width="956" height="415" alt="image" src="https://github.com/user-attachments/assets/c652ca27-01f6-4aa9-9314-985318bcb573" />

### 2.2 Opening and Reviewing Your Document

You are now on a dashboard for editing your document. You can edit the document directly on the right panel, using the document features in the menu bar such as the bold feature, font selection, size selection, highlighting, and more. If you wish to edit your draft on a separate document and get feedback following your revisions, you can use the 'upload a new draft' button to do so. 

<img width="960" height="412" alt="image" src="https://github.com/user-attachments/assets/484861de-deb2-4fcf-b58e-216dee59eb97" />

The left panel hosts the various tools you may use to revise your draft. In the image below, AI Debrief is selected and opened. However, the sidebar also provides options to view the table of contents under the 'contents' icon and Ask LEON using the 'LEON' icon. 

<img width="1912" height="829" alt="Editor with Ask WREN and AI Debrief" src="https://github.com/user-attachments/assets/2bc18352-af6a-48dd-a61a-5db705046320" />

If you would like to download your draft, clicking the 'export' button allows download a PDF or DOCX, with or without the AI Debrief feedback.

<img width="959" height="412" alt="image" src="https://github.com/user-attachments/assets/d31b8995-9545-4531-8c9e-04411dbd8c70" />

Finally, to adjust the size of the panels, click the grey bar on the right side of the left panel.

<img width="959" height="412" alt="image" src="https://github.com/user-attachments/assets/544ace4d-b433-437f-8472-14376b80b177" />

### 2.3 Using AI Debrief

The AI Debrief is where feedback is shared. When you upload a document, there won't be any feedback until the 'regenerate' button is clicked. 

<img width="956" height="413" alt="image" src="https://github.com/user-attachments/assets/3f598ac5-b9fc-4077-b0b8-a6b41b98f6a8" />

Once the button has been clicked, wait for the feedback to be generated. As you go through various iterations of your work, you may click the regenerate button to see if you have made any improvements in your writing. When the new AI Debrief appears, click the **drop-down arrow** to view earlier drafts. 

<img width="959" height="416" alt="image" src="https://github.com/user-attachments/assets/3ce5e503-c9b9-498c-bbae-457a354d57d9" />

You might have questions about the feedback the AI Debrief generated, or want some assistance in improving your writing. This is where Ask WREN comes in. Clicking on the 'WREN' icon brings you to the Ask WREN screen, where you can ask questions about the debrief, your draft, or aspects of writing such as clarity, organization, tone, and more. 

<img width="958" height="412" alt="Ask WREN chat" src="https://github.com/user-attachments/assets/0b5d2ba7-27b3-4c33-a726-e6882021007e" />

**Ask WREN will not write or rewrite your sentences, fact-check legal or technical claims, or answer questions unrelated to this draft.**

### Quick Recap — User

| Task | Where to go |
| --- | --- |
| Create an account | Sign Up → email/password → verify the email code |
| Log in | Login → email/password |
| Start a new draft | All documents → new document → department → document type → upload .docx or .pdf → activate editor |
| Review AI feedback | Open document → AI Debrief |
| Ask questions about your draft | Open document → Ask WREN |
| Update a draft | Left sidebar → Upload New Draft |
| Save a copy | Left sidebar → Export (DOCX or PDF) |

---

## Part 3: Department Admin Guide

As a **Department Admin**, you configure document types and evaluation criteria for the department(s) you administer, and you review aggregate analytics. User-facing debriefs are generated against the rubric you save.

### 3.1 How the Department Admin Screens Are Organized

- **Dashboard** — document types for the department(s) you are managing. **Create new Document Type** allows you to create a new evaluation criteria and Ask WREN prompts, so you can tailor document assessments to your specific requirements. 
<img width="943" height="412" alt="Department Admin dashboard" src="https://github.com/user-attachments/assets/4beb78da-7c6a-462c-ba6f-94749121db63" />

- **Document type** — The document type dashboard appears when you create a new document type or open an existing document type using the **manage document type** button. On the left sidebar, there are two pages the department admin can access:
1. The Evaluation Rubric, shown in the image below, and;
2. Analytics
<img width="950" height="413" alt="Document type Evaluation Rubric and Analytics" src="https://github.com/user-attachments/assets/3c9ac6ea-feee-4d36-9d63-9f507a28a9e9" />

- **Evaluation Rubric** — On this page, you can provide document context and general guidance that serves as the foundation for all AI-generated feedback. You can select which criteria you want to show up in the AI Debrief by clicking the checkmarks next to each evaluation criteria. From there, you can click the drop-down menu next to 'edit' and fill in the prompts for what the evaluation criteria looks like for a document type, and the standard for the criterion. 
**Click Save Rubric when you are done; this screen does not autosave.**
<img width="935" height="409" alt="Evaluation Rubric categories" src="https://github.com/user-attachments/assets/361ff81e-4ba7-4dd5-ad90-c683bb13a939" />

If there is a criteria missing, you can click 'add custom criterion' to create a new one.
<img width="859" height="401" alt="image" src="https://github.com/user-attachments/assets/47d93e8b-8b9d-404f-acac-57c5fd833046" />

- **Analytics** — The analytics screen provides a look at student improvement trends, AI Debrief helpfulness, and feedback section applicability.
<img width="950" height="407" alt="Document type analytics" src="https://github.com/user-attachments/assets/1b1427c0-02f6-4dd2-9f74-ff7e1c45ed16" />

Analytics lets you see how well the rubric is working for a document type. It answers three questions and provides aggregate data: 
1. Are users improving over time?
2. Do they find the AI Debrief helpful?
3. Are the feedback sections you configured actually applying to real submissions.

If most users rate a category's feedback "not helpful," the wording in your Evaluation Rubric is probably too vague or off-target. That is a signal to go back to 3.2 and sharpen it.

If a feedback section rarely marks as applicable, it may not fit the document type, and you can simplify the rubric by removing or rewording it.

### 3.3 Reviewing Analytics
There are three parts to the analytics: 

- **Student improvement** — assesses whether or not students have addressed the feedback flagged in their previous draft.
<img width="706" height="399" alt="image" src="https://github.com/user-attachments/assets/d7558de7-dc06-495a-bd37-558cf0a87078" />
<img width="544" height="122" alt="image" src="https://github.com/user-attachments/assets/8712c5ea-ffa1-4817-853f-fae22da2fe25" />

- **AI Debrief helpfulness** — aggregate student ratings (helpful / not helpful) and optional comments.
- **Section applicability** — whether feedback sections applied to the draft, in aggregate.

<img width="1447" height="685" alt="Helpfulness and applicability breakdown" src="https://github.com/user-attachments/assets/d70c2cf6-a983-4eb5-8d1f-c5f29e50a9a4" />

### Quick Reference — Department Admin

| Action | What happens |
| --- | --- |
| Create a document type | Create new Document Type → Name → Create |
| Set AI Debrief criteria | Evaluation Rubric → Document Context + Criteria → Save Rubric |
| Check results | Analytics for that document type |

---

## Part 4: System Admin Guide

The **System Admin** is the primary administrator for the platform who is responsible for setup, configuration, user management, and ensuring the system operates according to organizational requirements. 

The System Admin chooses the Bedrock model, sets platform usage limits, creates departments, manages users and access, edits department-level prompts, and reviews department analytics.

### 4.1 System Admin Dashboard
Once you have logged in as a system admin, you will be taken to the dashboard. On the dashboard, you will see system configuration options, including model configuration and usage limits, alongside your departments.

<img width="944" height="297" alt="image" src="https://github.com/user-attachments/assets/04c3dd29-6923-433b-9e4d-211c27c67975" />
<img width="917" height="310" alt="image" src="https://github.com/user-attachments/assets/fa25a40d-91a0-4b9f-a1b6-16faaab5cf35" />

Let's begin with model configuration. 

### 4.2 Model Configuration

1. From the System Admin dashboard, click the drop-down arrow next to Model Configuration.
[insert image here]
2. Using the Active model drop-down menu, you can see all the models available to use.
<img width="910" height="385" alt="image" src="https://github.com/user-attachments/assets/b9ec4bef-0b50-4b22-9c22-aaab06e8ee62" />
[insert image here]
3. Select the model you want to set as the platform default.
4. Click **Save**.
[insert image here]

**Note:**

Model changes apply immediately to new AI Debrief and Ask WREN calls. Existing debriefs are unchanged. Different models can differ in quality, cost, and latency.

### 4.3 Setting Usage Limits

Usage Limits restrict how many AI Debriefs and Ask WREN messages can be generated per document. Each debrief and Ask WREN interaction sends a request to a paid AI model and therefore **incurs usage costs.**

You can apply limits platform-wide or per department, so a high-volume department can get more headroom than others. We recommend a prudent estimate of monthly AI costs; you can always raise a limit if users legitimately hit it.

To set usuage limits:
1. Go to **System Admin Dashboard → System Configuration → Usage Limits**.
2. You can set limits for:
   - **AI Debriefs allowed** — the maximum number of debriefs a user or department can generate in a given period.
   - **Documents allowed** — the maximum number of documents a user or department can create or process in a given period.
3. Choose whether limits apply platform-wide or per department.
4. Click **Save Changes**.

<img width="931" height="413" alt="image" src="https://github.com/user-attachments/assets/4e046f13-c2c6-4150-8bcc-68c60f85a331" />

**Note:**

These limits apply to all users in all departments. They are not per-calendar-period quotas.

### 4.4 Creating New Departments

To create new departments as a System Admin:

1. Go to **System Admin Dashboard → Departments → Create New Department**.

<img width="936" height="381" alt="image" src="https://github.com/user-attachments/assets/14cff36a-00bc-4265-8c91-4074eb697c56" />

2. Enter the department name.

<img width="892" height="375" alt="image" src="https://github.com/user-attachments/assets/cd9e8bfd-554e-484d-9754-affc81143f29" />

3. Assign an initial Department Admin by clicking the pen symbol to the right of a user's name and selecting **Department Admin** (optional — can be done later from Manage Users, see [4.5 Managing Departments](#45-managing-departments)).

[insert image]

**Notes:**

- Once created, a department appears in the department list and can be opened as described in [4.5 Managing Departments](#45-managing-departments).
- Departments generally can't be merged after creation, so plan your structure before creating many of them.
- Set initial usage limits, or leave them at the platform default (see [4.3 Setting Usage Limits](#43-setting-usage-limits)).

### 4.5 Managing Departments

Department management allows administrators to configure user access and control who can discover and submit documents within a department.

1. Go to **System Admin Dashboard → Departments** and select the department you want to manage.
[insert image]

2. Under **Manage Users**, you can search participants and assign or revoke roles. Assigning **Department Admin** here scopes that role to this department, as previously discussed.

3. Use **User access → Open / Lock** to control who can submit documents for this document type:
   - **Open** — any user with access to the platform can submit documents for this document type. No document-type-specific Access Grant is required.
   - **Locked** — Only users who have been explicitly granted access to this document type can submit documents. Users must have an approved document-type Access Grant before they can upload or submit documents for evaluation.
   - When a document type is locked, administrators can manage access by reviewing and approving Access Grant requests from users.
[insert image]

Department visibility controls whether a department appears in the catalog for all users or only for users who have been explicitly granted access. It can be configured using the following steps:

1. Use **Department visibility → Visible / Permitted users only** to control catalog discovery:
   - **Visible** — the department is visible to all users.
   - **Permitted users only** — the department is shown only to explicitly permitted users, all Technical Admins, and Department Admins appointed to this department.
2. Under **Permitted users**, search the user directory to grant or revoke explicit visibility permission. Permissions are retained while the department is Visible and automatically take effect if it is changed back to Permitted users only. Revoking an explicit permission does not remove a Technical Admin or scoped Department Admin's automatic discovery access.

[insert image]

**Important:** A visibility permission controls discovery only. It does not grant submission to a Locked document type; **that requires a document-type Access Grant.**

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
