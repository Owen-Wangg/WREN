# Sample Error Taxonomy — Legal Writing Reference Implementation

> **Scope:** Sample legal-writing error taxonomy for the Feedback Engine. It is a **reference for one document type**, not the only domain the platform supports. Department Admins define taxonomies per document type.
>
> **Internal use only:** The "correct version" entries in each example are for the AI's internal reference — to understand what it is detecting — and must **never** be shown to the User. The platform surfaces only a Socratic question or error-type flag.

---

## How to Read Each Entry

| Field | Purpose |
|---|---|
| **Error type** | The taxonomy category this example belongs to |
| **User text** | The actual writing submitted, containing the error |
| **What's wrong** | Internal diagnosis — what the error is and why it matters |
| **Correct version** | Internal reference only — never shown to User |
| **Example Socratic question** | The kind of question the platform should generate instead of showing the correction |

---

## Error Categories

### 1. Unclear Writing

**User text:**
> "The majority maintained that a breach occurred due to the Crown's failure to disclose materials that might affect the conduct of the defence, with no requirement for the accused to show actual prejudice until the remedy analysis."

**What's wrong:** The sentence conflates multiple legal concepts and buries the holding. The causal chain is ambiguous.

**Correct version** *(internal reference only — never shown to User):*
> "The majority held that the Crown's failure to disclose materials that might affect the conduct of the defence resulted in a breach of their Stinchcombe disclosure obligations. The accused did not need to demonstrate any actual prejudice resulting from this failed disclosure in order to establish a breach, though prejudice is relevant to the remedy stage of the analysis."

**Example Socratic question:**
> "Your sentence covers several ideas at once — can you identify the main legal holding and state it as a single, complete sentence before adding qualifications?"

---

### 2. Inaccurate Summary

**User text:**
> "Villaroman establishes that the question appellate courts must answer in reviewing circumstantial evidence is whether 'the trier of fact [...] could reasonably be satisfied that the accused's guilt was the only reasonable conclusion available on the totality of the evidence' (para 55)."

**What's wrong:** The User attributes the standard to the wrong legal question — this is the standard for a reasonable verdict, not the appellate review question itself. The court framing and role of the quoted party are also misrepresented.

**Correct version** *(internal reference only — never shown to User):*
> "In Villaroman, the SCC outlined the standard of review required for a verdict where the Crown's case depended entirely on circumstantial evidence. A verdict will be reasonable if 'the trier of fact, acting judicially, could reasonably be satisfied that the accused's guilt was the only reasonable conclusion available on the totality of the evidence' (para 55)."

**Example Socratic question:**
> "Is the quote you've used describing what appellate courts ask, or describing the standard a trier of fact must meet? How might that distinction change how you frame this sentence?"

---

### 3. Grammar Error / Missing Quotation

**User text:**
> "The first stage of the McClure framework directs the trial judge to ask whether there is some evidentiary basis for a claim that solicitor-client communication exists that could raise a reasonable doubt as to the accused's guilt (para 52). Stating that mere speculation will not suffice."

**What's wrong:** "Stating that mere speculation will not suffice" is a sentence fragment. The quoted language from the case is not enclosed in quotation marks. The paragraph citation for the second point is also missing.

**Correct version** *(internal reference only — never shown to User):*
> "The first stage of the McClure framework directs the trial judge to ask whether there is 'some evidentiary basis for a claim that solicitor-client communication exists that could raise a reasonable doubt about the guilt of the accused.' (para 52) Mere speculation will not suffice (para 53)."

**Example Socratic question:**
> "Is 'Stating that mere speculation will not suffice' a complete sentence? And have you checked whether the language you've used from the case needs to be in quotation marks?"

---

### 4. Incorrect Legal Terminology

**User text:**
> "Justice Abella dissented on the order, arguing that the subpoena should be squashed."

**What's wrong:** "Squashed" is not a legal term — the correct term is "quashed." "Arguing" also understates the weight of a dissenting judgment; "held" is preferred.

**Correct version** *(internal reference only — never shown to User):*
> "In her dissenting reasons, Justice Abella held that the subpoena should be quashed."

**Example Socratic question:**
> "Is 'squashed' the correct legal term for what a court does to a subpoena? What term do courts actually use?"

---

### 5. Incorrect Style / Imprecise Language

**User text:**
> "Denis has also been cited in future case law, which both involved sexual assault cases where an accused was seeking information about complainants from journalists."

**What's wrong:** "Future case law" is imprecise — cases decided after Denis are "subsequent cases," not "future" ones. "Which both" is grammatically awkward and implies only two cases exist. "Accused was seeking" should be "accused charged with."

**Correct version** *(internal reference only — never shown to User):*
> "Denis has been cited in two subsequent cases, each of which involved accused charged with sexual assault seeking information about complainants from journalists."

**Example Socratic question:**
> "From the perspective of the Denis decision, are later cases 'future' or 'subsequent'? And does your sentence accurately convey how many cases you're referring to?"

---

### 6. Misattributed or Unfenced Quotation

**User text:**
> "The dissents argued that the majorities had 'nothing, or at most, very little' evidence other than the accused's presence."

**What's wrong:** The quoted language is attributed to the dissenting judges as their own words, but it is a quote from the majority's characterization. The attribution is reversed.

**Correct version** *(internal reference only — never shown to User):*
> "The dissenting judges disagreed with the majority, noting that there was 'nothing, or at most, very little' evidence beyond the accused's mere presence available at trial."

**Example Socratic question:**
> "Who originally used the phrase 'nothing, or at most, very little' — the dissent or the majority? Does your sentence make that clear?"

---

### 7. Tense and Structural Errors

**User text:**
> "Having concluded that the prior sexual text messages are relevant evidence that can be admissible under the hearsay exception, the Reimer court examined whether the evidence exclusionary rule under section 276 applies."

**What's wrong:** Tense is inconsistent — "are" and "can be admissible" should be past tense to match the rest of the sentence describing a completed judicial analysis. "Evidence exclusionary rule" is not the standard phrasing; "section 276" alone suffices.

**Correct version** *(internal reference only — never shown to User):*
> "Having concluded that the prior sexual text messages were relevant evidence admissible under the hearsay exception, the court in Reimer examined whether section 276 could apply to exclude such evidence."

**Example Socratic question:**
> "Is the court's conclusion about admissibility something that happened in the past or something ongoing? How should that affect your verb tense?"

---

### 8. Imprecise Case Reference / Passive Attribution

**User text:**
> "Trial courts such as R v M.A. have applied the same reasoning as Reimer to admit evidence of other sexual activity in the trial proper. In this case, the trial judge admitted FaceTime conversations which were an expression of [the complainant's] sexual fantasies as relevant evidence to the issue of consent."

**What's wrong:** Cases are not "trial courts" — a case and the court deciding it are distinct. "Which were an expression of" is passive and imprecise. The complainant's characterization of the evidence is conflated with the court's finding.

**Correct version** *(internal reference only — never shown to User):*
> "Subsequent cases have applied the reasoning in Reimer to the admissibility of evidence of prior sexual activity between the accused and complainant. In R v MA, the trial judge admitted FaceTime conversations in which the complainant expressed her sexual fantasies, finding this evidence was relevant to the issue of consent."

**Example Socratic question:**
> "Can a case be a 'trial court'? How would you distinguish between the case name and the court that decided it?"

---

### 9. Syntactic Ambiguity

**User text:**
> "The central question before the Supreme Court of Canada was whether the hearsay rule applies only to express assertions, or it also applies to implied assertions."

**What's wrong:** "Or it also applies" is grammatically parallel to "whether the hearsay rule applies" but breaks the parallel structure. The second clause needs "whether" to be properly formed.

**Correct version** *(internal reference only — never shown to User):*
> "The central issue before the Supreme Court of Canada was whether the hearsay rule applies only to express assertions, or whether it could apply to implied assertions as well."

**Example Socratic question:**
> "Read your sentence aloud — does the second half of the 'whether' clause feel complete and parallel to the first? What word might be missing?"

---

### 10. Structural / Sentence-Level Clarity

**User text:**
> "Despite mental health challenges, a jury found Bharwani fit to stand trial, where Bharwani raised the defence of not criminally responsible due to mental disorder ('NCRMD')."

**What's wrong:** "Where" is used as a temporal/logical connector but is incorrect here — "where" signals location. The two events (fitness finding; NCRMD plea) are sequential and should be in separate sentences.

**Correct version** *(internal reference only — never shown to User):*
> "A jury found Bharwani fit to stand trial, despite his mental health challenges. Bharwani then raised the defence of not criminally responsible on account of mental disorder ('NCRMD') at trial."

**Example Socratic question:**
> "Does 'where' connect these two events in a way that's accurate? Are these two separate events that might be clearer as two sentences?"

---

### 11. Errors in Logic / Factual Accuracy in Writing

**User text:**
> "While fresh evidence is only an appellate issue, it still has high stakes, because choosing to admit additional evidence bolsters the arguments of the party bringing it. This allows the court to see all of the matter's facts and thus increases the likelihood for justice to be done. The British Columbia Court of Appeal heard 648 civil and 140 criminal cases in 2024 alone; in 2025, of the 45 total cases heard by the SCC, 29 related to criminal law and 7 to civil law - 80% of the court's total case load. Therefore, fresh evidence motions that arise, and admissibility decisions made on them, have large consequences for individuals."

**What's wrong:** The math is wrong (29 + 7 = 36, not 80% of 45). The statistic about the BCCA conflates total decisions with fresh evidence applications specifically. The logical chain between "bolsters arguments" and "justice is done" is an unsupported leap.

**Correct version** *(internal reference only — never shown to User):*
> "The issue of whether fresh evidence may be admitted arises only on appeal. Where a court allows fresh evidence to be admitted, this decision will likely benefit the party seeking admission, and increase the likelihood their appeal will be successful. In 2024, the BC Court of Appeal rendered 423 decisions, 56 of which involved applications to admit fresh evidence. The stringency with which appellate courts approach the task of admitting fresh evidence has the potential to impact a large number of individuals across the country."

**Example Socratic question:**
> "Does your math add up? And does your statistic about the BCCA reflect total decisions or specifically fresh evidence applications — have you checked the source?"

---

### 12. Currency / Statutory Accuracy

**User text:**
> "As of April 2026, in Canada, distribution AI-generated non-consensual deepfake intimate images are not covered in the Canadian Criminal Code if they depict adults. In late 2025, Bill C-16 was introduced in the Canadian House of Commons to address this gap."

**What's wrong:** The sentence has a grammatical error ("distribution AI-generated"). More importantly, it understates the legal situation — the issue is that the Criminal Code's definition of "intimate images" doesn't encompass AI-generated images, which is a more precise and important framing. The description of Bill C-16 omits its full title and who introduced it.

**Correct version** *(internal reference only — never shown to User):*
> "Currently, AI-generated non-consensual deepfake intimate images are not encompassed in the Criminal Code's definition of 'intimate images', and therefore their non-consensual distribution is not criminally prohibited. In late 2025, the Federal Minister of Justice introduced Bill C-16, An Act to amend certain Acts in relation to criminal and correctional matters (child protection, gender-based violence, delays and other measures), which includes a provision intended to address this gap."

**Example Socratic question:**
> "Is the gap in the law about distribution specifically, or about how 'intimate images' is defined in the Code? Does that distinction matter for how you frame the problem?"

---

## Summary Table

| # | Error Type |
|---|---|
| 1 | Unclear Writing |
| 2 | Inaccurate Summary |
| 3 | Grammar Error / Missing Quotation |
| 4 | Incorrect Legal Terminology |
| 5 | Incorrect Style / Imprecise Language |
| 6 | Misattributed or Unfenced Quotation |
| 7 | Tense and Structural Errors |
| 8 | Imprecise Case Reference / Passive Attribution |
| 9 | Syntactic Ambiguity |
| 10 | Structural / Sentence-Level Clarity |
| 11 | Errors in Logic / Factual Accuracy in Writing |
| 12 | Currency / Statutory Accuracy |

---

*This taxonomy is a reference implementation for a legal writing Document Type. Other Departments will define their own error categories. The platform must treat these as configurable data, not a hardcoded enum.*
