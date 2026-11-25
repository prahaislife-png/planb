# What only you can do — checklist

Everything here needs a person with accounts, an inbox or a decision. Ordered so the first three unblock the most.
Nothing below has been done on your behalf; no email has been sent and no account created.

## 1. Accounts and keys (about 30 minutes)

| Step | Where | What to bring back |
|---|---|---|
| Create a Supabase project, region **Mumbai (ap-south-1)** | supabase.com → New project | Project URL, anon key, service-role key, database connection string (pooled, "Transaction" mode) |
| Enable the `vector` extension | Supabase → Database → Extensions | — |
| Create a private Storage bucket named `evidence` | Supabase → Storage → New bucket, **Public: off** | — |
| Create an Anthropic API key with a monthly spend limit | console.anthropic.com → API keys, then Limits | The key (starts `sk-ant-`) |
| Import the GitHub repository into Vercel, root directory `web` | vercel.com → Add New → Project | The deployment URL. Turn on Deployment Protection |

Once the Anthropic key exists, the first thing to run is the extractor evaluation described in
[`RUNBOOK.md`](RUNBOOK.md#local-development) — it measures the model against 169 already-verified claims for about a
dollar, before it touches a new document.

Do **not** paste keys into chat or commit them. Put them in Vercel's environment variables and in the worker's
environment; the variable names are listed in [`RUNBOOK.md`](RUNBOOK.md#environment-variables). When the project
exists, the remaining set-up steps are in [`RUNBOOK.md`](RUNBOOK.md#first-production-deployment-not-provisioned).

## 2. Permission requests (10 minutes — send both)

These two publishers' reports underpin the three records processed so far, and both reserve all rights. Until a reply
is recorded in the source registry (*Source registry → the source → Record permission*), nothing derived from their
reports can be published. Edit the bracketed parts; keep the request specific — a vague request gets a vague answer.

### To NIFTEM (Kundli) — `pmfmecell@niftem.ac.in`

> **Subject:** Request for permission to reuse figures from NIFTEM PMFME Detailed Project Reports
>
> Dear Sir/Madam,
>
> I am the founder of PlanB, [a company being incorporated in / registered in] Maharashtra. PlanB is building a
> research database that helps salaried professionals evaluate small businesses before investing their savings.
>
> We would like to use the Detailed Project Reports that NIFTEM has published under the PMFME scheme (for example
> the reports on red chilli powder, bread and honey processing at niftem.ac.in/newsite/pmfme/) as one of our
> reference sources. Specifically, we request permission to:
>
> 1. extract individual figures from these reports — machinery lists and prices, capacity, staffing, and the
>    project-cost and profitability tables — into our database;
> 2. show those figures to our users, **each attributed to NIFTEM with the report title and page number**, alongside
>    figures from other sources such as supplier quotations and interviews with business owners;
> 3. do so as part of a paid service.
>
> We would not republish the reports themselves, would not present NIFTEM as endorsing our service, and would mark
> each figure with the year of the report so that users understand it is a benchmark rather than a current price.
>
> If permission can be granted, we would be grateful for a reply stating so, along with any attribution wording or
> conditions you require. If a different office handles such requests, please let us know whom to contact.
>
> Thank you for making these reports available.
>
> Yours faithfully,
> [Name], Founder, PlanB · [phone] · [email] · [address]

### To NIFTEM-T (Thanjavur)

Send the same letter, changing the examples to *the PMFME DPRs published at niftem-t.ac.in/pmfme/ (for example
dehydrated onion, cookies and canned mushroom)*. The registry entry `niftem-thanjavur-pmfme` lists the contact found
on their site; if none is shown there, use the general contact address on niftem-t.ac.in and ask to be redirected.

**When replies arrive:** record the date and where the email is filed in the source registry. A refusal or no reply
within three weeks means these reports stay internal scaffolding and the records must rest on quotations, tariffs
and interviews before publication — which is the stronger position anyway.

## 3. Check the sources I could not reach (15 minutes, from an Indian network)

These timed out or failed TLS from the research environment, so their reuse terms are **unverified**. For each, open
the site, find the *Copyright Policy* / *Terms of Use* / *Hyperlinking Policy* page (usually in the footer), and note
the sentence about reproduction and whether permission is required.

- `dcmsme.gov.in` — MSME-DI project profiles and district industrial profiles
- `kviconline.gov.in` — PMEGP model project profiles (and `kvic.gov.in`, whose robots.txt disallows all crawling)
- `nabard.org` — model bankable projects, unit costs
- `mofpi.gov.in` — Ministry of Food Processing Industries
- `data.gov.in` — confirm the GODL-India licence text on the site itself

While there: the Local Government Directory (`lgdirectory.gov.in`) permits reuse but serves its lists only through
interactive forms, so I did not automate it. Download the district list for Maharashtra once and send me the LGD codes
for Pune and Nanded districts — they are deliberately empty in the database until verified.

Also read the terms for the four pilot publishers whose policies were never read: `nstfdc.tribal.gov.in`,
`msme1connect.up.gov.in`, `ncdc.in`, `horticulture.bihar.gov.in`. Send me what you find and I will update the registry.

## 4. Decisions I need from you

1. **Who reviews?** The system requires a second person to approve what the first submitted. Until there is a second
   staff member you can hold both roles on different accounts, but that defeats the control — who is the reviewer?
2. **Interview budget.** Twelve owner interviews for the first three records: who conducts them, and is there an
   incentive for the owner (a common, modest practice — it must be disclosed in the consent)?
3. **Counsel.** The interview consent wording below and the customer privacy notice need review under the DPDP Act
   before any real person's data is recorded. Do you have a lawyer, or should the roadmap assume a short engagement?
4. **Company details** for the letters above (registered name, address).

## 5. Interview consent form — draft for counsel

Not legal advice and not yet reviewed. It mirrors the four permissions the system records separately.

> **PlanB research interview — information and consent**
>
> **Who we are.** PlanB [legal name, address] is building a research database to help people decide whether to start
> a business. **Contact:** [name, phone, email].
>
> **What we will ask.** What it cost to start your business, what it earns and costs to run, what you take home,
> your working hours, your suppliers and customers, what went wrong, and your advice. You may skip any question and
> stop at any time.
>
> **How we protect you.** Your name, your business's name and your contact details are stored separately from your
> answers. Only your interviewer and PlanB's administrator can see them. They are never published or sold. Your
> location is recorded only at district level.
>
> **How your answers are used.** Figures are shown to PlanB's users only as combined statistics from at least five
> owners, so that no one can tell which are yours.
>
> **Your choices** (tick each you agree to):
> ☐ PlanB may use my answers in combined statistics.
> ☐ PlanB may quote my words without identifying me or my business.
> ☐ PlanB may keep copies of documents I show (bills, statements), stored privately.
> ☐ PlanB may contact me again.
>
> **Your rights.** You can ask to see what we hold about you, correct it, or withdraw your consent and have your
> identity erased, at any time, by contacting us. Withdrawing does not affect statistics already published.
>
> [If an incentive is paid: "You will receive ₹___ for your time, whether or not you answer every question."]
>
> Name: ________  Signature / recorded verbal consent: ________  Date: ________  Interviewer: ________

## 6. Then, in the dashboard

Once deployed (or locally, `pnpm dev`): **Review inbox** → read the 169 extracted claims beside their pages and
accept, correct or reject. This is the one research task that needs no one else, and it removes the largest
publication blocker after reuse rights.
