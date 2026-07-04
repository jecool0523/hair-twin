# Hair Twin COO Decision Pipeline

Use this pipeline whenever a new idea, feature, strategy, partnership, pricing model, sales claim, hardware direction, or product request appears.

## 1. Intake Format

```md
## Idea Intake

- Idea:
- Source: customer / stylist / owner / franchise / internal / competitor / investor / technical
- Requested by:
- Target user:
- Target buyer:
- Problem it claims to solve:
- Expected business value:
- Evidence available:
- Build effort:
- Main risks:
- Deadline or trigger:
```

## 2. Stage 0: Classify the Idea

Choose one primary type:

- Core consultation value
- AI generation quality
- Stylist workflow
- Customer trust
- Buyer ROI
- Sales/GTM
- Pricing/packaging
- Hardware
- Privacy/liability
- Brand/positioning
- Nice-to-have

If it cannot be classified, it is not ready for roadmap discussion.

## 3. Stage 1: Customer and Job Check

Ask:

- Who hires this: owner, stylist, customer, or franchise HQ?
- What job does it help them complete?
- What current workaround does it replace?
- Does it reduce anxiety, time, dissatisfaction, or sales friction?
- Would the buyer pay for this, or only the user likes it?

Reject or reframe if the idea has no clear buyer/user/job.

## 4. Stage 2: Evidence Check

Score evidence from 0-5:

- 0: internal guess only.
- 1: one-off opinion or attractive demo reaction.
- 2: repeated interview pattern.
- 3: prototype reaction with specific workflow feedback.
- 4: in-salon pilot behavior or buyer asks for pilot terms.
- 5: paid pilot, signed agreement, or repeated usage with clear metric lift.

Rule:

- Evidence below 2 cannot justify major build.
- Evidence 2-3 can justify small experiment.
- Evidence 4-5 can justify roadmap priority.

## 5. Stage 3: MVP Fit Check

Score each 0-3.

- Consultation trust gain:
- Stylist workflow gain:
- Buyer ROI clarity:
- Learning speed:
- Reuse across salons:
- Demo/sales impact:

Subtract 0-3 each.

- Build complexity:
- Operational complexity:
- Privacy/liability risk:
- Hardware/setup dependency:

MVP fit score:

`sum(gains) - sum(costs)`

Decision:

- 10 or higher: include or prioritize.
- 6-9: run experiment or prototype.
- 2-5: park until stronger evidence.
- 1 or lower: reject or reframe.

Override:

- Trust blockers can be prioritized even if ROI is not direct.
- Hardware-dependent ideas require extra proof before inclusion.

## 6. Stage 4: Sales Possibility Score

Score 0-3 each.

### Pain Strength

- 0: vague interest.
- 1: mild inconvenience.
- 2: repeated operational pain.
- 3: costly complaint, lost sale, or owner-visible pain.

### Buyer Access

- 0: no buyer path.
- 1: user only.
- 2: owner/manager access.
- 3: economic buyer engaged.

### ROI Story

- 0: no ROI.
- 1: qualitative benefit only.
- 2: plausible ROI metric.
- 3: buyer agrees to a success metric.

### Urgency

- 0: someday.
- 1: interesting this quarter.
- 2: linked to upcoming campaign/store change.
- 3: buyer wants pilot now.

### Differentiation

- 0: commodity.
- 1: similar to filters/apps.
- 2: salon workflow difference is clear.
- 3: buyer says alternatives do not solve it.

Sales possibility total:

- 12-15: active sales priority.
- 8-11: discovery/pilot candidate.
- 5-7: nurture and gather more evidence.
- 0-4: not a sales priority.

## 7. Stage 5: Risk Score

Score 0-3 each.

### AI Trust Risk

- 0: no generated-image trust dependency.
- 1: minor visual issue.
- 2: could mislead consultation.
- 3: changes identity or creates unrealistic expectation.

### Workflow Risk

- 0: no added steps.
- 1: small step.
- 2: slows consultation.
- 3: disrupts chair flow or embarrasses stylist.

### Privacy Risk

- 0: no personal data.
- 1: temporary local image only.
- 2: saved face or consultation record.
- 3: unclear consent/storage/deletion or sensitive data exposure.

### Liability Risk

- 0: no claim risk.
- 1: clearly positioned as reference only.
- 2: customer could over-trust result.
- 3: result could be interpreted as guaranteed outcome.

### Hardware Risk

- 0: software only.
- 1: commodity webcam/tablet.
- 2: special setup/lighting.
- 3: custom hardware, installation, or maintenance required.

Risk total:

- 0-4: manageable.
- 5-8: mitigation required before pilot.
- 9-11: leadership review required.
- 12-15: do not proceed without redesign.

## 8. Stage 6: Decision Matrix

Use evidence, MVP fit, sales possibility, and risk together.

### Include in MVP

Conditions:

- Evidence >= 3.
- MVP fit >= 10.
- Risk <= 8.
- Sales possibility >= 8 or trust blocker removal.

### Run Small Experiment

Conditions:

- Evidence 2-3.
- MVP fit 6-9.
- Risk <= 8.
- Experiment can finish within 1-2 weeks.

### Defer

Conditions:

- Evidence low but idea may matter later.
- Build depends on hardware, CRM, franchise admin, or large model work.
- No immediate pilot/sales impact.

### Reject

Conditions:

- No buyer/job clarity.
- Mainly cosmetic or novelty.
- Risk high and value unclear.
- Makes Hair Twin look like a casual filter app.

## 9. Strategy Evaluation Questions

For any strategy proposal:

- Which customer segment does this sharpen?
- Which buyer objection does this remove?
- Which proof metric will improve?
- What would we stop doing if we choose this?
- Does this increase or reduce complexity?
- Is this a learning move, sales move, or scaling move?
- What is the reversal trigger?

## 10. Feature Evaluation Questions

For any product feature:

- Does it improve consultation trust?
- Does it help stylists explain feasibility, price, or care?
- Does it reduce taps or add taps?
- Does it help owners see ROI?
- Does it produce reusable customer data?
- Does it increase privacy or liability burden?
- Can it be tested manually first?

## 11. Sales Claim Evaluation Questions

Before using a sales claim:

- Can we prove it with pilot data?
- Is the buyer likely to care?
- Does the claim create liability?
- Is it about business outcome rather than AI novelty?
- Can a stylist repeat it naturally to a customer?

Approved claim types:

- "Consultation aid."
- "Preview for discussion."
- "Helps compare options."
- "Supports expectation alignment."
- "Can reduce uncertainty before high-risk style changes."

Avoid unless proven:

- "Predicts exact result."
- "Guarantees satisfaction."
- "Works for every hair condition."
- "Fully replaces stylist judgment."

## 12. Pricing Decision Questions

Before setting or changing price:

- What buyer outcome does the package map to?
- What is the value metric: store, stylist seat, consultation volume, generation quota, report storage, franchise analytics?
- What is the cost floor: AI generation, support, onboarding, hardware, maintenance?
- What is the willingness-to-pay evidence?
- What is the cheapest credible pilot price?
- What feature should be fenced into Pro or Franchise?
- What discount do we get in return: testimonial, case study, data, commitment, multi-store pilot?

## 13. Hardware Decision Questions

Before hardware work:

- Has the tablet/webcam version created pull?
- What hardware constraint was observed, not imagined?
- Does hardware increase close rate or usage enough to justify cost?
- Can off-the-shelf hardware solve the same issue?
- What installation/support burden appears?
- What breaks in real salon lighting?
- What is the warranty/replacement plan?

## 14. Privacy and Trust Review Questions

Before capturing or saving user images:

- Is consent explicit?
- Is saving optional?
- Is deletion easy?
- Is the purpose clear?
- Does the user know simulation is not a guarantee?
- Is face identity preserved?
- Is data minimized?
- Can salon staff explain the policy in one sentence?

## 15. Final Decision Record

```md
## Decision Record

- Date:
- Decision:
- Classification:
- Evidence score:
- MVP fit score:
- Sales possibility score:
- Risk score:
- Decision: include / experiment / defer / reject
- Reason:
- Risk controls:
- Owner:
- Next action:
- Review date:
- Reversal trigger:
```

## 16. Next Action Rule

When several next actions compete, choose in this order:

1. Action that gets closer to paid pilot.
2. Action that removes a trust blocker.
3. Action that validates buyer willingness to pay.
4. Action that improves live consultation workflow.
5. Action that sharpens positioning or sales story.
6. Action that improves visual polish.

If an action does not create evidence, revenue, trust, or workflow progress, it is probably not the next COO action.

