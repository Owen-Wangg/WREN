# LEON User Guide

This guide covers everything you need to get started with LEON — from creating your account to using LEON as a **Student**, **Department Admin**, or **System Admin**. Start with [Part 1: Getting Started](#part-1-getting-started-all-users), then jump to the part that matches your role.

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
  - [3.3 Setting Up Evaluation Settings](#33-setting-up-evaluation-settings)
  - [3.4 Reviewing Analytics](#34-reviewing-analytics)
  - [Quick Reference — Department Admin](#quick-reference--department-admin)
  - [Tips for Department Admins](#tips-for-department-admins)
- [Part 4: System Admin Guide](#part-4-system-admin-guide)
  - [4.1 How the System Admin Screens Are Organized](#41-how-the-system-admin-screens-are-organized)
  - [4.2 Model Configuration](#42-model-configuration)
  - [4.3 Setting Usage Limits](#43-setting-usage-limits)
  - [4.4 Creating New Departments](#44-creating-new-departments)
  - [4.5 Managing Departments](#45-managing-departments)
  - [4.6 Department-Level Prompt Management](#46-department-level-prompt-management)
  - [4.7 Reviewing Platform Analytics](#47-reviewing-platform-analytics)
  - [Quick Reference — System Admin](#quick-reference--system-admin)
  - [Tips for System Admins](#tips-for-system-admins)

---

## Part 1: Getting Started (All Users)

### 1.1 Log In

> **First time here?** You need to create an account before you can log in — see [1.2 Create an Account](#12-create-an-account-first-time-users-only) first, then return here.

1. Navigate to your LEON application URL (provided by your administrator or found in the AWS Amplify console).
2. Enter the email address and password you used when creating your account.
3. Click **Login**.
4. Once logged in, you will land on your dashboard.

### 1.2 Create an Account (First-Time Users Only)

**Note:** Only follow these steps if you have never created an account before. If you already have an account, skip to [1.1 Log In](#11-log-in).

1. Click **Sign Up**.
2. You will be taken to a new page where you will enter:
   - UBC email address
   - A new password for LEON

   Make sure your password follows the password rules listed on this page (for example, it may need a certain number of letters, numbers, or symbols).

3. After submitting your email and password, LEON will send a **verification code** to the email address you provided.

   **Important:** Do not close the LEON sign-up page while you check your email. Keep it open in the background.

4. Log in to your email account and find this verification code. Write it down or keep the email open.
5. Return to the LEON sign-up page and enter the verification code you were emailed.
6. Once submitted, your account has been created and is ready to use. Continue to [1.1 Log In](#11-log-in).

_Tip: If you don't receive your verification code email within a few minutes, check your spam or junk folder before requesting a new one._

### 1.3 Choosing Your Account View

Open your profile and select your account view. This determines which dashboard you land on:

- Choose **Student** to access assignments, submit documents, and receive AI-generated debriefs — see [Part 2: Student Guide](#part-2-student-guide).
- Choose **Department Admin** to configure document types, define evaluation criteria, and view analytics — see [Part 3: Department Admin Guide](#part-3-department-admin-guide).
- Choose **System Admin** to configure the AI model, set platform-wide usage limits, create and manage departments, and view platform-wide analytics — see [Part 4: System Admin Guide](#part-4-system-admin-guide).

You can switch between views at any time from your profile.

---

## Part 2: Student Guide

As a **Student**, once you've logged in and are on your **Student Dashboard**, you will see:

- Any drafts you have previously uploaded
- If no drafts exist yet, you will need to create a new one (see below)

<img width="957" height="395" alt="image" src="https://github.com/user-attachments/assets/a0050ec6-575d-48fe-bc46-d5aecbdb2107" />

### 2.1 Creating a New Document Draft

1. From the Student Dashboard, find **New Document** in the top-right corner of the screen (next to **All Documents**, which is the page you are currently on).
<img width="1914" height="790" alt="Screenshot 2026-08-24 164814" src="https://github.com/user-attachments/assets/2ad36a0a-4d9b-4baf-83a6-f7772f10c440" />

2. Click **New Document**.

3. Select your department.

4. Choose your document type — for example, **Legal Memorandum**.

5. Give your draft a name.

6. Click **Choose File** and select the DOCX file from your computer that you want to upload.

<img width="956" height="368" alt="image" src="https://github.com/user-attachments/assets/5c284420-bbfa-4e77-b675-14e2dc247690" />

8. After uploading, you will automatically be returned to the **My Documents** page, where you will now see your newly uploaded draft listed.
9. After uploading, you will be taken to the following page:
<img width="956" height="415" alt="image" src="https://github.com/user-attachments/assets/c652ca27-01f6-4aa9-9314-985318bcb573" />

### 2.2 Opening and Reviewing Your Document
1. On the side of the screen, you'll see a panel with more information about two tools:
   - **AI Debrief**
   - **LEON**
<img width="1912" height="829" alt="Screenshot 2026-08-25 095652" src="https://github.com/user-attachments/assets/2bc18352-af6a-48dd-a61a-5db705046320" />

2. Click the **LEON and AI Debrief** symbols to activate these tools.

**Other options available in this view:**

- **Upload a new draft** — use this if changes were made to your document in another editor and you need LEON to review the updated version.
<img width="960" height="412" alt="image" src="https://github.com/user-attachments/assets/484861de-deb2-4fcf-b58e-216dee59eb97" />
- **Export** — use this to download your document after changes have been made.
<img width="959" height="412" alt="image" src="https://github.com/user-attachments/assets/d31b8995-9545-4531-8c9e-04411dbd8c70" />
- **Adjust the panel** — click on the grey bar on the right side of the AI debrief to expand or minimize the panel.
<img width="959" height="412" alt="image" src="https://github.com/user-attachments/assets/544ace4d-b433-437f-8472-14376b80b177" />

### 2.3 Using AI Debrief

1. Click **Regenerate** to generate a new AI Debrief report on your document.
<img width="956" height="413" alt="image" src="https://github.com/user-attachments/assets/3f598ac5-b9fc-4077-b0b8-a6b41b98f6a8" />
2. To view a previously generated report, click the **drop-down arrow** and select an earlier draft's report from the list.
<img width="959" height="416" alt="image" src="https://github.com/user-attachments/assets/3ce5e503-c9b9-498c-bbae-457a354d57d9" />

### 2.4 Using Ask LEON

1. Click the **LEON** tab to switch views.
2. Here you can chat directly with LEON to:
   - Ask detailed questions about your document
   - Track your progress and see how much work has been completed as you make changes
<img width="958" height="412" alt="image" src="https://github.com/user-attachments/assets/0b5d2ba7-27b3-4c33-a726-e6882021007e" />

### Quick Recap — Student

| Task | Where to Go |
| --- | --- |
| Create an account | Sign Up → enter email/password → verify via email code |
| Log in | Login → enter email/password |
| Start a new draft | Student Dashboard → New Document → select department → document type → upload DOCX |
| Review AI feedback | Open document → Open LEON and AI Debrief → AI Debrief tab |
| Ask questions about your document | Open document → Ask LEON tab |
| Update a draft | Editor screen → Upload a new draft |
| Save a copy | Editor screen → Download |

---

## Part 3: Department Admin Guide

As a **Department Admin**, you configure document types, define evaluation criteria, and view analytics. Follow the steps below in order the first time through; after that, use this part as a quick reference.

Once you've selected **Department Admin** as your account view (see [1.3 Choosing Your Account View](#13-choosing-your-account-view)), you'll land on your Department Admin dashboard.

### 3.1 How the Department Admin Screens Are Organized

Before diving into the steps, here's where things live on the platform:

- **Profile** — click your profile to switch your account view between Student and Department Admin.
  
<img width="1870" height="813" alt="image" src="https://github.com/user-attachments/assets/529f9101-fb8e-4dd8-9e32-9d36953b4ce4" />

- **Dashboard** — the main screen after choosing Department Admin. Your existing document types are listed here, with the **Create New Document Type** button on the right side of the screen.
  
<img width="943" height="412" alt="image" src="https://github.com/user-attachments/assets/4beb78da-7c6a-462c-ba6f-94749121db63" />

- **Document Controls** — opens when you select or create a document type. It's organized as two tabs: **Evaluation** and **Analytics**.
  
<img width="950" height="413" alt="image" src="https://github.com/user-attachments/assets/3c9ac6ea-feee-4d36-9d63-9f507a28a9e9" />

- **Inside Evaluation Settings** — **General Information** sits at the top, followed by your list of **Categories**. Clicking a category opens its configuration form.

<img width="935" height="409" alt="image" src="https://github.com/user-attachments/assets/361ff81e-4ba7-4dd5-ad90-c683bb13a939" />

- **Inside Analytics** — **Student Improvement Trends** appears first, followed by **Ai Debrief Helpfulness** and **Feedback Section Applicability**

<img width="950" height="407" alt="image" src="https://github.com/user-attachments/assets/1b1427c0-02f6-4dd2-9f74-ff7e1c45ed16" />

### 3.2 Setting Up Evaluation Settings

**Entering document type information**

1. Go to the **document context** section.
2. Enter a description of the document's purpose and expected content.
3. Add any other reference information relevant to the document type.

**Select or create evaluation criteria**

1. Select an existing category to open its configuration form, or
2. Click **add custom criterion** to add a new one.

**Configure each category**

1. Click into a category (e.g., "Clarity").
2. Fill in the form with the requirements the AI should evaluate against for this document type — for example, what does clarity look like for an appellate factum?
3. Your changes save automatically as you go, so you can leave and return without losing progress.

### 3.3 Reviewing Analytics

**Check student improvement**

View whether students addressed the feedback flagged their previous drafts.

**Check AI Debrief quality**

1. Review the Helpfulness Breakdown - which provides a visual to see what percentage of feedback was both helpful and not helpful
2. Review Feedback Section Applicability — applicable/not applicable indicators tied to each evaluation category you configured in [3.3 Setting Up Evaluation Settings](#33-setting-up-evaluation-settings) (e.g., "Was the tone feedback useful? Yes/No").

### Quick Reference — Department Admin

| Action | What Happens |
| --- | --- |
| Select account view | Choose Student or Department Admin from your profile |
| Land on dashboard | Department Admin dashboard opens |
| Open document type | Select an existing one, or click Create New Document Type |
| Choose a tab | Click Evaluation Settings or Analytics |
| Set up evaluation | Enter general info, select/create categories, then fill in each category's form (autosaves) |
| Check analytics | Review usage, student improvement, debrief helpfulness, and category yes/no results |

### Tips for Department Admins

- You can define different evaluation categories for each document type — nothing is hard-coded.
- Student-facing AI debriefs are generated against whatever criteria you set up in Evaluation Settings.
- Analytics reflects activity for the document type but doesn't change your evaluation setup.
- Since Evaluation Settings saves as you go, feel free to step away mid-setup and pick back up later.

---

## Part 4: System Admin Guide

As a **System Admin**, you sit above the department level: you control which AI model powers LEON, set usage limits, create and manage departments, promote users to Department Admin, and review platform-wide analytics. Follow the steps below in order the first time through; after that, use this part as a quick reference.

Once you've selected **System Admin** as your account view (see [1.3 Choosing Your Account View](#13-choosing-your-account-view)), you'll land on your System Admin dashboard.

### 4.1 How the System Admin Screens Are Organized

Before diving into the steps, here's where things live on the platform:

- **Profile** — click your profile to switch your account view between Student, Department Admin, and System Admin.
- **Dashboard** — the main screen after choosing System Admin. Your list of departments is shown here, alongside **System Settings**.
- **System Settings** — contains **Model Configuration** and **Usage Limits**, which apply platform-wide unless overridden at the department level.
- **Department Controls** — opens when you select or create a department. It's organized into three areas: **Users**, **Prompt Settings**, and **Analytics**.
- **Inside Users** — the list of active users in the department, where you can promote roles or lock the department from student access.
- **Inside Prompt Settings** — **Department Context** sits at the top, followed by **Writing Standards**, then **Restricted Topics**.
- **Inside Analytics** — **Active Users** appears first, followed by **Documents Generated**, then **Debriefs Generated**.

### 4.2 Model Configuration

1. Go to **System Admin Dashboard → System Settings → Model Configuration**.
2. Review the list of available AI models.
3. Select the model you want to set as the platform default.
4. Click **Save Changes**.

**Notes:**

- Model changes apply platform-wide unless your instance supports per-department overrides.
- Consider testing a new model with a small pilot group before rolling it out broadly, since output style and quality can shift between models.
- Changing models does not affect historical debriefs or documents already generated.

### 4.3 Setting Usage Limits

1. Go to **System Admin Dashboard → System Settings → Usage Limits**.
2. Set limits for:
   - **AI Debriefs allowed** — the maximum number of debriefs a user or department can generate in a given period.
   - **Documents allowed** — the maximum number of documents a user or department can create or process in a given period.
3. Choose whether limits apply platform-wide or per department.
4. Click **Save Changes**.

**Notes:**

- Limits help control cost and prevent misuse.
- Consider setting conservative defaults for new departments and increasing them as usage patterns become clear.

### 4.4 Creating New Departments

1. Go to **System Admin Dashboard → Departments → Create New Department**.
2. Enter the department name and a short description.
3. Assign an initial Department Admin (optional — can be done later from Users, see [4.5 Managing Departments](#45-managing-departments)).
4. Set initial usage limits, or leave them at the platform default (see [4.3 Setting Usage Limits](#43-setting-usage-limits)).
5. Click **Create Department**.

**Notes:**

- Once created, a department appears in the department list and can be opened as described in [4.5 Managing Departments](#45-managing-departments).
- Departments generally can't be merged after creation, so plan your structure before creating many of them.

### 4.5 Managing Departments

1. Go to **System Admin Dashboard → Departments** and select the department you want to manage.
2. Click **Users** to:
   - View the list of currently active users in the department.
   - Select a user to promote or change their role — for example, promoting a Student to **Department Admin**.
   - Deactivate or remove a user if needed.
3. Click **Lock Department Access** to prevent students from logging in or using platform features while keeping admin/staff access intact. Use this for maintenance, review periods, or restructuring.
4. Click **Save Changes** after any update.

**Notes:**

- Role promotions typically take effect immediately.
- Locking a department does not delete data — it only restricts student-level access until unlocked.

### 4.6 Department-Level Prompt Management

1. Go to **System Admin Dashboard → Departments → [Department Name] → Prompt Settings**.
2. Configure the following:
   - **Department Context** — background information the AI should always consider for this department (e.g., subject area, program level, institutional norms).
   - **Writing Standards** — style, tone, formatting, and citation requirements the AI should follow when generating documents or debriefs for this department.
   - **Restricted Topics** — a list of topics, terms, or content areas the AI should avoid or flag when interacting with this department's users.
3. Save changes.
4. Optionally, test the configuration by generating a sample document or debrief before rolling it out.

**Notes:**

- These settings apply only to the selected department; other departments are unaffected.
- Restricted topics should be reviewed periodically to reflect current policy or curriculum needs.

### 4.7 Reviewing Platform Analytics

1. Go to **System Admin Dashboard → Departments → [Department Name] → Analytics** (or a platform-wide analytics view, if available).
2. Review key metrics, including:
   - **Active Users** — number of users who have logged in or used the platform within a selected time range.
   - **Documents Generated** — total document creation volume over time.
   - **Debriefs Generated** — total AI debrief volume over time.
3. Use date-range filters to compare activity across weeks, months, or terms.
4. Export data if you need to share it outside the platform.

**Notes:**

- Analytics are useful for identifying underused departments (candidates for training/support) or heavily used ones (candidates for higher usage limits).
- Reviewing analytics alongside Usage Limits (see [4.3 Setting Usage Limits](#43-setting-usage-limits)) helps keep costs predictable.

### Quick Reference — System Admin

| Action | Where to Go |
| --- | --- |
| Choose AI model | System Settings → Model Configuration |
| Set debrief/document limits | System Settings → Usage Limits |
| Create a department | Departments → Create New Department |
| Promote or manage users | Departments → [Department] → Users |
| Lock student access | Departments → [Department] → Lock Department Access |
| Set department context, writing standards, restricted topics | Departments → [Department] → Prompt Settings |
| Review platform analytics | Departments → [Department] → Analytics |

### Tips for System Admins

- Model and usage limit changes made in System Settings apply platform-wide unless a department has its own override.
- Give each department its own Prompt Settings so evaluation and debrief behavior reflects that department's actual standards.
- Use Lock Department Access instead of deleting a department when you just need to pause student activity temporarily.
- Check Analytics regularly alongside Usage Limits to catch departments approaching their document or debrief caps before users are blocked.
