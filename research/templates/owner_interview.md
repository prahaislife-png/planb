# Owner interview guide (PlanB Ground Truth)

Use for tasks of type `interview_owner` and for replacing default assumptions (`define_assumption`).
The structured questions live in the database (`gt.questionnaires`: `owner_operating` v1, `owner_former` v1) and are
shown in *Ground Truth → Questionnaires*. This guide covers how to run the interview.

## Who to interview

- At least **three operating owners** per business model, at different scales and in both pilot locations where possible.
- At least **one owner whose business closed or was sold**. Failures are the evidence career-switchers most need and
  the evidence least likely to volunteer itself. Ask every operating owner whether they know someone who stopped.
- Not suppliers, consultants or franchisors speaking for owners.

## Consent — before any question

Read this aloud (or send it) and record the answer in *Ground Truth → Record consent*. No consent, no interview record.

> PlanB is building a research database to help people decide whether to start a business like yours. I would like to
> ask about what it cost to set up, what it earns and what it is like to run. Your name, your business's name and your
> contact details are kept separately, seen only by me and our administrator, and never published. Your answers are
> combined with other owners' answers; figures are only shown when at least five owners have contributed, so nobody can
> work out which are yours. You can skip any question, stop at any time, and ask us later to delete what you told us.
>
> May we (1) use your answers in combined statistics? (2) quote your words without identifying you?
> (3) keep copies of any documents you show us? (4) contact you again?

Record each of the four answers separately. If the owner withdraws later, an administrator erases the identity record.

## Running the interview

- 45–60 minutes, at the premises if you can: you will see staffing, stock and footfall for yourself.
- Ask for **ranges and typical months**, not single figures: "In a slow month? In a good month? Which months are those?"
- **Owner income is the central question.** Separate what the business earns from what the owner takes home, and ask
  what they earned in their last job.
- For every figure, ask "is there a bill, statement or loan letter for that?" If you see it, record the figure as
  *documented* and note the document; otherwise it is *self-reported*. Never upgrade a figure because it sounds right.
- Ask what the original plan assumed and what turned out differently — especially the months before the first sale,
  the months before costs were covered, and money spent that was never planned.
- Do not lead. "How long until you broke even?" not "Did you break even in the first year?"
- Write down supplier names only if the owner agrees to that specifically.

## After the interview

1. Enter responses the same day (*Ground Truth → select interview → responses*). Numeric answers with a metric become
   `business_actuals` rows automatically, marked self-reported unless you attach a document.
2. Write the analyst summary, reasons for success or closure, and the owner's advice to entrants, in their words where
   consent allows.
3. Coarsen the location to district level. Remove names, addresses and anything identifying from free text, then set
   anonymisation to *anonymised*.
4. A second person reviews the record before it counts (status *reviewed*).
5. Close the research task with what was learned and what remains unknown.
