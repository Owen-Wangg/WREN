# WREN User Guide

**Welcome to the WREN User Guide!**

**WREN** (Write, Revise, Edit Notes) is an AI-assisted writing and feedback platform that helps users improve their writing through structured AI-generated feedback, guided revision, and conversational support. Writers can upload drafts, receive document-specific feedback through AI Debrief, and use Ask LEON to better understand feedback and identify opportunities for improvement.

This guide covers how to get started with **WREN** — from creating your account to using its features as a **Writer**, **Department Admin**, or **System Admin**. Start with [Part 1: Getting Started](#part-1-getting-started-all-users), then jump to the part that matches your role.

## Before you Begin
_Why do some screenshots say LEON?_

**WREN** is the name used throughout this guide to refer to the prototype solution. During development, the design was centered around the legal context and named in tribute to Leon Getz (https://www.lawsociety.bc.ca/news-and-engagement/news/in-memoriam-leon-getz,-kc) who was considered by many to be one of the best legal writers in BC. As a result, some screenshots and interface elements may still display the name LEON (Legal Expression Organization & Navigation). Throughout the guide, WREN refers to the current platform and LEON refers to naming conventions used during system development within the same solution. Both names refer to the same platform functionality. Given that LEON was originally developed within a legal education context, many of the screenshots in the User Guide use legal document types such as legal memoranda or case briefs as examples.

_Are there other instances of interchangeable naming?_

Yes. The term **'System Admin'** is used throughout the user guide to describe a role, but this role is referred to as the 'Technical Admin' role in the API and database.

## How to use this Guide
WREN is an AI-assisted writing and feedback platform that helps users draft, review, and improve written work using document-specific criteria, AI-generated feedback, and guided writing support. 

This guide explains how to use WREN from the perspective of three primary user roles:
- **Writers** create and revise documents, review AI Debrief feedback, and interact with Ask LEON (Ask WREN in some deployments).
- **Department Admins** configure document types, evaluation criteria, and analytics for the departments they manage.
- **System Admins** manage platform-wide settings, user access, departments, AI-models, and usage controls.

## How this Guide is Organized
The guide is organized into four parts.
- **Part 1: Getting Started (All Users)**
Learn how to create an account and log in.
- **Part 2: Writer Guide**
Learn how to create a document, navigate the editor, generate AI Debriefs, use Ask LEON, and manage document revisions. 
- **Part 3: Department Admin Guide**
Learn how to create and manage document types, configure evaluation rubrics, customize AI-generated feedback, and review document analytics. 
- **Part 4: System Admin Guide**
Learn how to configure AI models, manage departments and user access, set usage limits, configure department-wide prompts, and review platform analytics.

## Table of Contents

- [WREN User Guide](#wren-user-guide)
  - [Table of Contents](#table-of-contents)
  - [Part 1: Getting Started (All Users)](#part-1-getting-started-all-users)
    - [1.1 Log In](#11-log-in)
    - [1.2 Create an Account (First-Time Users Only)](#12-create-an-account-first-time-users-only)
    - [1.3 Choosing Your Account View](#13-choosing-your-account-view)
  - [Part 2: Writer Guide](#part-2-writer-guide)
    - [2.1 Creating a New Document Draft](#21-creating-a-new-document-draft)
    - [2.2 Understanding the Document Workspace](#22-opening-and-reviewing-your-document)
    - [2.3 Using AI Debrief](#23-using-ai-debrief)
    - [2.4 Using Ask LEON](#24-using-ask-leon)
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
    - [4.7 Ask LEON Prompt](#47-manage-ask-wren-prompt)
    - [4.8 Reviewing Department Analytics](#48-reviewing-department-analytics)
    - [Quick Reference — System Admin](#quick-reference--system-admin)

---

## Part 1: Getting Started (All Users)

In this section, you will learn how to create an account and log into WREN. **Complete this section before moving to the role-specific guides.**

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

Some deployments only accept email addresses from a list of domains (for example `@ubc.ca`). If sign-up is rejected, use the address your administrator specified.

3. After you submit, WREN sends a **verification code** to that email.

**Important:** Keep the sign-up page open while you check email.

4. Find the code in your inbox (check spam if it does not arrive within a few minutes).
5. Return to the sign-up page and enter the code.
6. Your account is ready. Continue to [1.1 Log In](#11-log-in).

---

## Part 2: Writer Guide

This section explains how writers use WREN throughout the document development process. A typical workflow involves uploading a document, generating an AI Debrief, reviewing feedback, revising the document, and using Ask LEON to clarify or explore feedback in greater detail.

After logging in, writers will be taken to the **Writer Dashboard,** where they will see any existing drafts. Each draft shows its title, document type, and current status. Draft statuses indicate where a document is within the writing process. For example, "still drafting" indicates a work in progress, while "polishing" generally indicates the document is being refined before completion.

<img width="957" height="395" alt="User dashboard" src="https://github.com/user-attachments/assets/a0050ec6-575d-48fe-bc46-d5aecbdb2107" />

### 2.1 Creating a New Draft

When a writer wants to receive AI-assisted feedback on a new document, they must first create a draft within WREN. By creating a draft, the document gets associated with a department and document type, preparing it for AI Debrief analysis. 

1. From the dashboard, find **New Document** in the top-right corner of the screen (next to **All Documents**, which is the page you are currently on).
<img width="1914" height="790" alt="Screenshot 2026-08-24 164814" src="https://github.com/user-attachments/assets/2ad36a0a-4d9b-4baf-83a6-f7772f10c440" />

2. Click **New Document**.

3. Select your department.

4. Choose your document type — for example, **Legal Memorandum**.

5. Give your draft a name.

6. Click **Choose File** and select the PDF or DOCX file from your computer that you want to upload. Uploading a DOCX file will provide formatting that is more accurate to the original document.

<img width="1913" height="823" alt="Screenshot 2026-09-14 133151" src="https://github.com/user-attachments/assets/3c925764-f5fa-4a85-8781-14048e112e98" />

7. After uploading your draft, you will be taken to the following page:
<img width="956" height="415" alt="image" src="https://github.com/user-attachments/assets/c652ca27-01f6-4aa9-9314-985318bcb573" />

Once your document has been uploaded and the editor is activated, you can begin reviewing and editing your work within the document workspace.

### 2.2 Understanding the Document Workspace 

After creating a draft, you will enter the document workspace. This is where writers review feedback, revise documents, generate new AI Debriefs, and interact with Ask LEON throughout the drafting process. 

The document workspace contains two primary areas. The editor occupies the right side of the screen, while feedback and navigation tools are located in the left sidebar.

If you would like to edit the document, you can do so directly on the right panel, using the document features in the menu bar such as the bold feature, font selection, size selection, highlighting, and more. If you wish to edit your draft on a separate document and get feedback following your revisions, use the 'upload a new draft' button and hit the 'regenerate' button again. 

<img width="960" height="412" alt="image" src="https://github.com/user-attachments/assets/484861de-deb2-4fcf-b58e-216dee59eb97" />

The left panel displays the various tools you may use to revise your draft. In the image below, AI Debrief is selected and opened. However, the sidebar also provides options to view the table of contents under the 'contents' icon, and Ask LEON using the 'LEON' icon. 

<img width="1912" height="829" alt="Editor with Ask LEON and AI Debrief" src="https://github.com/user-attachments/assets/2bc18352-af6a-48dd-a61a-5db705046320" />

When you are ready to continue working on your document outside of WREN, you can export the current draft. Exporting allows you to save either the document alone or the document together with AI Debrief feedback for offline review and editing. Select **export** and choose whether to download the file as a PDF or DOCX.

<img width="959" height="412" alt="image" src="https://github.com/user-attachments/assets/d31b8995-9545-4531-8c9e-04411dbd8c70" />

Finally, to adjust the size of the panels, click and drag the grey bar on the right side of the left panel.

<img width="959" height="412" alt="image" src="https://github.com/user-attachments/assets/544ace4d-b433-437f-8472-14376b80b177" />

After reviewing your draft and familiarizing yourself with the workspace, you can generate an AI Debrief to receive feedback and identify areas for revision.

### 2.3 Using AI Debrief

AI Debrief is the primary feedback feature in WREN. It evaluates the uploaded document against the criteria configured for its document type and provides guidance on strengths and opportunities for improvements.

If you would like to view categorized feedback for your draft, click the 'regenerate' button. 

<img width="956" height="413" alt="image" src="https://github.com/user-attachments/assets/3f598ac5-b9fc-4077-b0b8-a6b41b98f6a8" />

Once the button has been clicked, wait for the feedback to be generated. As you go through various iterations of your work, you can click the regenerate button to see if you have made any improvements in your writing. When the new AI Debrief appears, click the **drop-down arrow** to view earlier drafts. 

<img width="959" height="416" alt="image" src="https://github.com/user-attachments/assets/3ce5e503-c9b9-498c-bbae-457a354d57d9" />

If you wish to see what's done well and what could be improved in your writing, you are able to use the AI Debrief function. Using the scroll function on the right side panel, you can view the feedback across the different categories for the document you uploaded. Clicking on the "where you did this well" or "one example - check your whole draft for this" highlights the referenced part of your document, allowing you to quickly navigate and make edits in your document.

<img width="1913" height="820" alt="Screenshot 2026-09-14 133522" src="https://github.com/user-attachments/assets/35bc0ac1-9583-4d73-8d3b-0e44fe0e3457" />
<img width="1915" height="824" alt="Screenshot 2026-09-14 133713" src="https://github.com/user-attachments/assets/be0f7dc7-5aae-44a2-b6b2-5223e175b692" />

### 2.4 Using Ask LEON
Ask LEON is meant to help navigate the AI Debrief and provide further assistance in improving writing. Clicking on the 'LEON' icon opens the Ask LEON screen, opening up a chat screen. The user can ask questions about the feedback the AI Debrief generated, or questions about specific aspects of their draft, such as clarity, organization, tone, etc. 

When Ask LEON is asked a question, it responds by guiding the user through a series of reflective questions rather than providing direct answers. This approach is based on the Socratic method, which encourages writers to think critically about their work and identify areas for improvement.

Think of AI Debrief as the assessment tool and Ask LEON as the conversational coaching tool. Writers typically review their AI Debrief first, then use Ask LEON to better understand and act on that feedback. 

**Ask LEON will not write or rewrite your sentences, fact-check legal or technical claims, or answer questions unrelated to this draft.**

<img width="957" height="412" alt="image" src="https://github.com/user-attachments/assets/7b929713-8f6f-40e1-94cc-baad77dc8f09" />

After using Ask LEON to better understand your feedback, you can revise your document and generate a new AI Debrief to evaluate your progress.

### Quick Recap — User

| Task | Where to go |
| --- | --- |
| Create an account | Sign Up → email/password → verify the email code |
| Log in | Login → email/password |
| Start a new draft | All documents → new document → department → document type → upload .docx or .pdf → regenerate |
| Review AI feedback | Open document → AI Debrief |
| Ask questions about your draft | Open document → Ask LEON |
| Update a draft | Left sidebar → Upload New Draft |
| Save a copy | Left sidebar → Export (DOCX or PDF) |

---

## Part 3: Department Admin Guide

In this section, you will learn how Department Admin screens are organized, how to configure evaluation rubrics, and how to interpret document-type analytics. 

### 3.1 How the Department Admin Screens Are Organized

The primary responsibility of a Department Admin is to configure how WREN evaluates documents within your department. This typically involves creating document types, defining evaluation criteria, reviewing AI-generated feedback quality, and monitoring how writers interact with the feedback they receive.

Most Department Admin tasks follow a simple workflow:
1. Create or open a document type
2. Configure its evaluation rubric
3. Review analytics to determine whether the rubric is producing useful feedback
4. Refine rubric criteria over time as needed

When you open the Department Admin experience, you will interact with two areas:
1. The dashboard
2. The document type page, which has tabs for the Evaluation Rubric and viewing Analytics.

**Dashboard** — The dashboard contains the document types for the department(s) you are managing. **Create new Document Type** allows you to create a new evaluation criteria and Ask LEON prompts, so you can tailor document assessments to your specific requirements. 
<img width="943" height="412" alt="Department Admin dashboard" src="https://github.com/user-attachments/assets/4beb78da-7c6a-462c-ba6f-94749121db63" />

**Document type** — The document type dashboard appears when you create a new document type or open an existing document type using the **manage document type** button. On the left sidebar, there are two pages the department admin can access:
1. The Evaluation Rubric, shown in the image below, and;
2. Analytics
<img width="950" height="413" alt="Document type Evaluation Rubric and Analytics" src="https://github.com/user-attachments/assets/3c9ac6ea-feee-4d36-9d63-9f507a28a9e9" />

### 3.2 Configuring the Evaluation Rubric

The Evaluation Rubric is the foundation of the AI Debrief experience. The criteria you configure here determines the standards against which writer submissions are evaluated. Well-defined criteria generally produce more useful and targeted feedback, while vague criteria can result in generic or inconsistent feedback. 

**Evaluation Rubric** — On this page, you can provide document context and general guidance that serves as the foundation for all AI-generated feedback. You can select which criteria you want to show up in the AI Debrief by clicking the checkmarks next to each evaluation criteria. From there, you can click the drop-down menu next to 'edit' and fill in the prompts for what the evaluation criteria looks like for a document type, and the standard for the criterion. 
**Once rubric modifications are complete, save your changes. The rubric is not automatically saved, so unsaved edits will not be preserved if you leave the page.**
<img width="935" height="409" alt="Evaluation Rubric categories" src="https://github.com/user-attachments/assets/361ff81e-4ba7-4dd5-ad90-c683bb13a939" />

If your document type requires evaluation in an area not covered by the default criteria, you can create custom criteria that reflect the unique requirements of your department. 

<img width="859" height="401" alt="image" src="https://github.com/user-attachments/assets/47d93e8b-8b9d-404f-acac-57c5fd833046" />

**Analytics** — The analytics screen provides a look at student improvement trends, AI Debrief helpfulness, and feedback section applicability.

<img width="950" height="407" alt="Document type analytics" src="https://github.com/user-attachments/assets/1b1427c0-02f6-4dd2-9f74-ff7e1c45ed16" />

Analytics lets you see how well the rubric is working for a document type. It answers three questions and provides aggregate data: 
1. Are users improving over time?
2. Do they find the AI Debrief helpful?
3. Are the feedback sections you configured actually applying to real submissions.

If most users rate a category's feedback "not helpful," the wording in your Evaluation Rubric is probably too vague or off-target. That is a signal to go back to 3.2 and sharpen it.

If a feedback section rarely marks as applicable, it may not fit the document type, and you can simplify the rubric by removing or rewording it.

### 3.3 Reviewing Analytics

There are three parts to the analytics: 

- **Student improvement** — Student improvement data helps determine whether writers are successfully acting on the feedback they receive. Consistent improvement across drafts may indicate that the rubric is producing actionable recommendations.
<img width="706" height="399" alt="image" src="https://github.com/user-attachments/assets/d7558de7-dc06-495a-bd37-558cf0a87078" />
<img width="544" height="122" alt="image" src="https://github.com/user-attachments/assets/8712c5ea-ffa1-4817-853f-fae22da2fe25" />

- **AI Debrief helpfulness** — Helpfulness ratings help validate the quality of the AI Debrief feedback. Low helpfulness scores may indicate that rubric instructions are unclear, overly broad, or not aligned with writer needs.
<img width="1447" height="685" alt="Helpfulness and applicability breakdown" src="https://github.com/user-attachments/assets/d70c2cf6-a983-4eb5-8d1f-c5f29e50a9a4" />

- **Section applicability** — Assesses whether feedback categories were applicable to the draft, in aggregate. Categories with consistently low applicability may not be relevant for the document type and should be reviewed for removal or refinement.
<img width="781" height="211" alt="image" src="https://github.com/user-attachments/assets/fc57bc47-5656-481b-8c9d-2674fc27bc55" />

### Quick Reference — Department Admin

| Action | What happens |
| --- | --- |
| Create a document type | Create new Document Type → Name → Create |
| Set AI Debrief criteria | Evaluation Rubric → Document Context + Criteria → Save Rubric |
| Check results | Analytics for that document type |

---

## Part 4: System Admin Guide

In this section, you will learn how to manage platform-wide settings, configure AI models, create and manage departments, control access, and monitor usage analytics. 

The **System Admin** has the ability to setup and configure the system, manage users, and ensure the system operates according to organizational requirements. 

The System Admin can choose the Bedrock model, set platform usage limits, create departments, manage users and access, edit department-level prompts, and review department analytics.

### 4.1 System Admin Dashboard
The System Admin Dashboard serves as the central management area for the WREN platform. From this dashboard, administrators configure AI behavior, manage departments, control user access, establish usage limits, and review platform-wide analytics.

<img width="944" height="297" alt="image" src="https://github.com/user-attachments/assets/04c3dd29-6923-433b-9e4d-211c27c67975" />
<img width="917" height="310" alt="image" src="https://github.com/user-attachments/assets/fa25a40d-91a0-4b9f-a1b6-16faaab5cf35" />

Let's begin with model configuration. 

### 4.2 Model Configuration
In WREN, the model used to generate AI Debriefs can be configured. Changing the model has an impact on the response quality, performance, and cost requirements. Therefore, it should be selected with careful review and consideration.

To change the AI model used, follow the instructions below:

1. From the System Admin dashboard, click the drop-down arrow next to Model Configuration.
<img width="910" height="385" alt="image" src="https://github.com/user-attachments/assets/b9ec4bef-0b50-4b22-9c22-aaab06e8ee62" />

2. Using the Active model drop-down menu, you can see all the models available to use.
<img width="943" height="407" alt="image" src="https://github.com/user-attachments/assets/9748ca8d-c179-4080-a597-eceab6933922" />

3. Select the model you want to set as the platform default.

4. Click **Save**.
<img width="905" height="414" alt="image" src="https://github.com/user-attachments/assets/5b765a1e-e23c-40bb-8a63-e21e36afb1f2" />

**Note:**

Model changes apply immediately to new AI Debrief and Ask LEON calls. Existing debriefs are unchanged. Different models can differ in quality, cost, and latency.

Most organizations will rarely need to change the selected AI model. However, a model change may be appropriate when:
- Testing a newly available model
- Balancing response quality and operating cost
- Reducing response latency
- Evaluating model performance for a specific writing context

After saving a model configuration, future AI Debrief and Ask LEON requests will use the newly selected model. The next administrative task is often configuring usage limits to ensure AI resources are managed appropriately. 

### 4.3 Setting Usage Limits
Usage limits help administrators balance platform availability with AI operating costs. They are particularly useful during pilot projects, classroom deployments, or situations where AI usage budgets must be monitored carefully.

Usage limits may be especially helpful when encouraging thoughtful revision rather than excessive regeneration.

Usage Limits restrict how many AI Debriefs and Ask LEON messages can be generated per document. Each debrief and Ask LEON interaction sends a request to a paid AI model and therefore **incurs usage costs.**

You can apply limits platform-wide or per department. **We recommend a prudent estimate of monthly AI costs; you can always raise a limit if users legitimately hit it.**

To set usuage limits:
1. Go to **System Admin Dashboard → System Configuration → Usage Limits**.
2. You can set limits for:
   - Ask LEON messages (LEON message limit in the image below)
   - How many times the AI Debrief can be regenerated (Max AI Debrief)
   - The maximum number of document uploads
   - The maximum number of drafts
3. Choose whether limits apply platform-wide or per department.
4. Click **Save Changes**.
<img width="931" height="413" alt="image" src="https://github.com/user-attachments/assets/4e046f13-c2c6-4150-8bcc-68c60f85a331" />

**Note:**

These limits apply to all users in all departments. They are not per-calendar-period quotas.

Once usage limits have been configured, the next step is typically to organize the platform into departments. Departments allow you to separate users, document types, prompts, and analytics into distinct administrative areas.

### 4.4 Creating New Departments
Departments provide separate areas of management within WREN. Each department can maintain its own document types, evaluation rubrics, prompts, analytics, and administrative staff. Consequently, departments can tailor the writing experience, feedback criteria, and administrative controls to meet their specific organizational needs.

A department typically represents a distinct academic unit, program, faculty, or organization that has its own writing standards and evaluation requirements. For example, the Law Department shown throughout this guide uses legal document types and specialized evaluation criteria designed to assess legal writing. Other departments might configure WREN for disciplines such as business, engineering, healthcare, or communications, each with their own document types, rubrics, and AI guidance. By organizing content into departments, WREN can provide feedback that is more relevant to the expectations and standards of a particular field.

To create new departments as a System Admin:

1. Go to **System Admin Dashboard → Departments → Create New Department**.

<img width="936" height="381" alt="image" src="https://github.com/user-attachments/assets/14cff36a-00bc-4265-8c91-4074eb697c56" />

2. Enter the department name.

<img width="892" height="375" alt="image" src="https://github.com/user-attachments/assets/cd9e8bfd-554e-484d-9754-affc81143f29" />

Once a department has been created, the next step is typically to assign Department Admins and configure document types so writers can begin submitting work.

3. Assign an initial Department Admin by clicking the pen symbol to the right of a user's name and selecting **Department Admin** (optional — can be done later from Manage Users, see [4.5 Managing Departments](#45-managing-departments)).

<img width="789" height="322" alt="image" src="https://github.com/user-attachments/assets/ccc917be-b151-4ec3-b627-82d8cbcc821f" />

**Notes:**

- Once created, a department appears in the department list and can be opened as described in [4.5 Managing Departments](#45-managing-departments).
- Departments generally can't be merged after creation, so plan your structure before creating many of them.
- Set initial usage limits, or leave them at the platform default (see [4.3 Setting Usage Limits](#43-setting-usage-limits)).

Creating a department establishes the organizational structure, but departments must still be managed and configured. The next section explains how to assign roles, control visibility, and manage access within a department.

### 4.5 Managing Departments

Once a department has been created, System Admins can manage membership, permissions, and visibility settings. Department management allows administrators to configure user access and control who can discover and submit documents within a department.

Department management involves two distinct concepts:
1) **Roles** determine what users can administer.
2) **Visibility** determines whether users can discover a department.
Understanding the difference between these controls is important because each serves a different purpose.

Let's begin with managing roles:
1. Go to **System Admin Dashboard → Departments** and select the department you want to manage.
<img width="1789" height="679" alt="image" src="https://github.com/user-attachments/assets/13772124-bc8a-4d57-99fe-ec5ff1a69742" />

2. Under **Manage Users**, you can search participants and assign or revoke roles.
<img width="1765" height="820" alt="image" src="https://github.com/user-attachments/assets/65b17290-e7e3-4d23-bd7d-d68bcf904d39" />

3. Submission access controls who can submit documents for a document type. A document type can be configured in one of two access states:
- **Open access**: Any user with access to WREN can submit documents for this document type. No additional approval is required. 
- **Locked Access**: Only users who have been explicitly granted access can submit documents for this document type. Users must have an approved Access Grant before they can upload or submit documents for evaluation.
Administrators can switch between these states using the **Student Access** control:
   - If the document type is currently Open, the button displays Lock. Selecting it changes the document type to Locked Access.
   - If the document type is currently Locked, the button displays Open. Selecting it changes the document type to Open Access.
  
When a document type is locked, administrators can manage access by reviewing and approving Access Grant requests from users.
<img width="1765" height="820" alt="image" src="https://github.com/user-attachments/assets/3aa639f4-909c-434f-9a2f-f47195cf074e" />

After configuring roles and submission access, configure **Department Visibility** to determine who can discover the department in the WREN application.

**Department Visibility** can be configured in one of two states:
- **Visible to All Users:** The department appears in the catalog for all users who have access to WREN.
- **Restricted Visibility:** The department appears only to users who have been explicitly granted access, as well as System Admins and Department Admins assigned to the department.

Administrators can switch between these states using the visibility control:
- If the department is currently **Visible to All Users**, the button displays **Limit Visibility**. Selecting it changes the department to Restricted Visibility.
- If the department currently has **Restricted Visibility**, the button displays **Make Visible**. Selecting it makes the department visible to all users.
<img width="1765" height="820" alt="image" src="https://github.com/user-attachments/assets/59cf4cd2-59df-41a4-b946-28a7648fa2ce" />
<img width="122" height="176" alt="image" src="https://github.com/user-attachments/assets/89c31f2b-d4f6-4d58-a2bc-9252cbc57af1" />

**Important:** A visibility permission controls discovery only. It does not grant submission to a Locked document type; **that requires a document-type Access Grant.**

**Security limitation:** Department visibility is a UI-only discovery filter, not an authorization or confidentiality boundary. The API returns active department rows with a `viewerCanDiscover` decision and the client filters catalog and New Document views. A user calling APIs directly may still learn department metadata and, when submission access is Open, may submit if they know the relevant IDs. Do not use **Permitted users only** to protect confidential department names or data. Use **Locked** plus document-type Access Grants to enforce submission eligibility; archive a department when it must stop accepting new submissions.

Once department membership and access controls have been configured, the next step is often to customize how the AI behaves for that department. This is accomplished through department-level prompts.

### 4.6 Department-Level Prompt Management
Department-level prompts define guidance that applies across all document types within a department. These prompts provide context that the AI uses whenever it generates an AI Debrief or responds through Ask LEON. As a result, the information configured here influences how feedback is framed, what standards are emphasized, and what topics or considerations the AI should account for when interacting with users.

Department prompts should be used for guidance that applies broadly across a department, such as the background of the writers, departmental writing expectations, or topics that should be avoided. More specific evaluation requirements can be configured within a document type's Evaluation Rubric (see [3.2](#32-configuring-the-evaluation-rubric)). 

On the screen, you will see configurable fields for Department Context, Writing Standards, and Restricted Topics that together influence AI behavior across the department. 

The Department Prompt contains three configurable settings:
1. Department Context: Provides background information about the department, its users, and the types of documents being reviewed. This helps the AI better understand the environment in which the writing is being produced.
2. Writing Standards: Defines department-wide expectations for style, tone, structure, formatting, citations, or other writing conventions that should be reflected in AI-generated feedback.
3. Restricted Topics: Identifies topics, concepts, or content areas that the AI should avoid discussing or should handle with additional caution.
Together, these settings help ensure that AI-generated feedback aligns with the standards and expectations of the department.

To access the Department Prompt:
1. Go to System Admin Dashboard → Departments → [Department Name] → Manage Department Prompt.
2. Configure the following:
- Department Context
- Writing Standards
- Restricted Topics
3.. Click Save Prompt.
Optionally, test the configuration by generating a sample document or AI Debrief before rolling it out.
<img width="710" height="412" alt="image" src="https://github.com/user-attachments/assets/d5dbb115-2f24-4ee2-94ea-86d64940729d" />

After configuring department-wide AI guidance, the next step is configuring the behavior of the Ask LEON assistant itself.

## 4.7 Manage Ask LEON Prompt
The Ask LEON prompt controls how the conversational assistant interacts with writers. Unlike AI Debrief prompts, which determine evaluation feedback, Ask LEON prompt influences how the assistant communicates with users.

For example, the Ask LEON Prompt can be used to:
- Encourage a Socratic coaching style
- Reinforce departmental writing expectations
- Promote reflection and critical thinking

When Ask LEON is asked a question, it responds by guiding the user through reflective questioning rather than simply providing answers. This approach is based on the Socratic method, which encourages writers to think more critically about their work, evaluate their reasoning, and identify improvements independently. 

To update the Ask LEON prompt:
1. Navigate to the **Manage Ask LEON Prompt** page
2. Enter or modify the prompt text
3. Click **Save ASK LEON Prompt**
<img width="776" height="404" alt="image" src="https://github.com/user-attachments/assets/4aa0efb9-d517-4765-9d1f-af9cf9f3bee4" />

After configuring department prompts and Ask LEON behavior, administrators can evaluate how users are engaging with the platform through analytics. The analytics dashboard provides visibility into adoption and usage trends across departments.

### 4.8 Reviewing Department Analytics

Analytics provides insight into platform adoption, writing activity, and AI usage across departments. Administrators can use these metrics to understand how WREN is being used, identify trends, and determine whether configuration changes may be needed.

To access analytics:
1. Go to **System Admin Dashboard → Departments → [Department Name] → View Analytics**.
2. Review key metrics, including:
   - **Active Users** — Shows how many users have logged in or used the platform during a selected time period. This metric helps assess user adoption and engagement.
   - **Total documents** — Shows the number of documents that have been created. High document counts generally indicate frequent platform use within a department.
   - **Total drafts** — Shows how many draft iterations users have created. A higher number of drafts may indicate that writers are actively revising their work and engaging with AI-generated feedback.
   - **Breakdown by document type** - Displays which document types are being used most frequently. This can help identify high-demand document types and areas where additional support or rubric refinement may be beneficial. 
   - **Platform total usage over time** -Displays changes in platform activity over time. Growth trends may indicate successful adoption, while declining activity may suggest the need for additional configuration changes.

<img width="911" height="302" alt="Department analytics totals" src="https://github.com/user-attachments/assets/539979ef-8a54-41a8-bfc3-764fc87d4b43" />
<img width="725" height="296" alt="Usage over time" src="https://github.com/user-attachments/assets/3b319c83-71de-4e06-8862-42ef7101baa6" />

Analytics can help answer questions such as:
- Are users actively using WREN?
- Which document types are most popular?
- Are writers engaging in multiple revision cycles?
- Is platform usage increasing or decreasing over time?
- Do certain departments require additional support or training?

Together, model configuration, usage management, department administration, prompt configuration, and analytics provide System Admins with the tools needed to govern and support the WREN platform. The quick reference below summarizes the most common administrative tasks and where to find them.

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
