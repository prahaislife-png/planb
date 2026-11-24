# Pilot research plan

Ten business models are being researched in depth before the other 127 in the backlog. This page records, for each,
the source documents that were actually located and verified, what has been processed, and the human research that
must happen next. It is generated from `research/catalog/pilot_documents.yaml` and the backlog; the document list was
verified on 2026-11-24 (each URL fetched, SHA-256 recorded, text layer confirmed).

**Reading this page.** A government project report gives a cost *structure* and a dated benchmark. None of the
documents below is primary evidence, most print no date, and their publishers have not granted reuse rights. No pilot
record is publishable until the primary research listed at the end has been done.

## Status by pilot model

| Pilot model | Documents located | Publishers | Processed through the pipeline | Blocking gap |
|---|---|---|---|---|
| Neighbourhood retail bakery (`neighbourhood-retail-bakery`) | 4 | ncdc-sample-dpr, niftem-pmfme-dpr, up-msme-1connect | NIFTEM bread DPR → filed under `wholesale-b2b-bakery`, the operating model it actually describes (55 claims, 13 scenarios) | No document yet describes a neighbourhood retail bakery; the located reports are wholesale bread plants |
| Spice grinding and processing unit (`spice-grinding-processing-unit`) | 2 | niftem-pmfme-dpr, nstfdc-model-project-profiles | NIFTEM chilli powder DPR → `spice-grinding-processing-unit` (55 claims, 13 scenarios) | Reuse permission from NIFTEM; current machinery quotations; owner interviews |
| Oyster mushroom cultivation unit (`oyster-mushroom-cultivation`) | 5 | bihar-horticulture, niftem-pmfme-dpr, nstfdc-model-project-profiles, up-msme-1connect | not yet | Located reports need the LLM extractor (non-NIFTEM templates) — requires an API key |
| B2B commercial linen laundry (`b2b-linen-laundry`) | 0 | — | not yet | No accessible document found (the only lead is on an unreachable KVIC host) |
| Corrugated box manufacturing unit (`corrugated-box-manufacturing`) | 2 | nstfdc-model-project-profiles, up-msme-1connect | not yet | Reports are abbreviated or describe a different product; needs LLM extractor and a fuller source |
| Paper cup manufacturing unit (`paper-cup-manufacturing`) | 3 | nstfdc-model-project-profiles, up-msme-1connect | not yet | One solid report (UP MSME paper cup); needs the LLM extractor |
| Onion / garlic / vegetable dehydration unit (`onion-garlic-dehydration-unit`) | 2 | niftem-pmfme-dpr, up-msme-1connect | not yet | NIFTEM-T onion DPR uses a different template; needs the LLM extractor or a second rule set |
| Beekeeping and honey processing unit (`beekeeping-honey-processing`) | 3 | niftem-pmfme-dpr, nstfdc-model-project-profiles, up-msme-1connect | NIFTEM honey processing DPR → `beekeeping-honey-processing` (59 claims, 13 scenarios) | Document covers honey processing only; beekeeping (apiary) economics need a second source |
| Readymade garment job-work (CMT) unit (`garment-job-work-unit`) | 3 | nstfdc-model-project-profiles, up-msme-1connect | not yet | Reports are short or projections-only; needs the LLM extractor and supplier quotations |
| Takeaway coffee kiosk (`takeaway-coffee-kiosk`) | 3 | niftem-pmfme-dpr, nstfdc-model-project-profiles, up-msme-1connect | not yet | No project report exists for a coffee kiosk — only loose substitutes. This model must be built from primary research |

## Verified source documents

All are text-extractable PDFs fetched with HTTP 200 on 2026-11-24; robots.txt permitted each path (four hosts have no
robots.txt). Files are not stored in this repository. `Stated project cost` is the document's own figure, quoted for
identification only — it is not a PlanB finding.

| Group | Title | Publisher | Pages | Stated project cost | URL |
|---|---|---|---|---|---|
| bakery | DETAILED PROJECT REPORT BREAD MAKING UNIT UNDER PMFME SCHEME | NIFTEM, Kundli (PMFME scheme, Ministry of Food Processing In | 26 | Rs.18.69 Lakh | <https://niftem.ac.in/newsite/pmfme/wp-content/uploads/2022/07/breaddpr.pdf> |
| bakery | PROJECT REPORT Of BREAD MAKING | Department of MSME & Export Promotion, Government of Uttar P | 15 | 'Cost of Project ... Total 41.10' (Rs lakh) and separately ' | <https://msme1connect.up.gov.in/Projectreport/Project%20Report638658532098915940.pdf> |
| bakery | Detailed Project Report on Establishment of a Bakery Unit by PACS | National Cooperative Development Corporation (NCDC), Ministr | 24 | Rs 60.000 lakhs | <https://www.ncdc.in/documents/downloads/09180405204.Sample-DPR_BAKERY-UNIT.pdf> |
| bakery | DETAILED PROJECT REPORT FOR PROCESSING OF BANANA FLOUR COOKIES | NIFTEM-Thanjavur, formerly IIFPT (PMFME scheme, Ministry of  | 31 | Total project cost (Lakhs) 28.44 | <https://niftem-t.ac.in/pmfme/dpr-cookies.pdf> |
| spice-processing | DETAILED PROJECT REPORT RED CHILLI POWDER UNIT UNDER PMFME SCHEME | NIFTEM, Kundli (PMFME scheme, Ministry of Food Processing In | 25 | Rs. 14.71 Lakh | <https://niftem.ac.in/newsite/pmfme/wp-content/uploads/2022/08/chillipowderdpr.pdf> |
| spice-processing | SPICES GRINDING | National Scheduled Tribes Finance and Development Corporatio | 6 | 1,00,000.00 (Amount in Rs.) | <https://nstfdc.tribal.gov.in/UploadData/pdf/spices_grinding.pdf> |
| mushroom-cultivation | MUSHROOM CULTIVATION | National Scheduled Tribes Finance and Development Corporatio | 5 | 1,40,000.00 (Rs.) | <https://nstfdc.tribal.gov.in/UploadData/pdf/mushroomcultiv.pdf> |
| mushroom-cultivation | PROJECT REPORT FOR SETTING UP OF INTEGRATED MUSHROOM CULTIVATION UNIT (cover: FEASIBILITY  | Directorate of Horticulture, Government of Bihar (HORTMIS) | 20 | Rs. 2.10 lakhs | <https://horticulture.bihar.gov.in/HORTMIS/ProjectBasedActivity/ProjectDocuments/Mushroom/Small_MUSHROOM_UNIT%202.00%20lakh.pdf> |
| mushroom-cultivation | PROJECT REPORT Of MUSHROOM CULTIVATION & PROCESSING | Department of MSME & Export Promotion, Government of Uttar P | 8 | not stated | <https://msme1connect.up.gov.in/Projectreport/Project%20Report638665945067973721.pdf> |
| mushroom-cultivation | DETAILED PROJECT REPORT CANNED MUSHROOM UNIT UNDER PMFME SCHEME | NIFTEM, Kundli (PMFME scheme, Ministry of Food Processing In | 28 | Rs. 39.14 Lakh | <https://niftem.ac.in/newsite/pmfme/wp-content/uploads/2022/07/cannedmushroomdpr.pdf> |
| mushroom-cultivation | Model Detailed Project Report CANNED MUSHROOM UNIT Under the Formalization of Micro Food P | Indian Institute of Food Processing Technology (IIFPT), Than | 20 | Rs. 31.8Lakh | <https://niftem-t.ac.in/pmfme/dpr-cmushroom.pdf> |
| corrugated-box-manufacturing | PROJECT REPORT Of CORRUGATED BOXES | Department of MSME & Export Promotion, Government of Uttar P | 8 | not stated | <https://msme1connect.up.gov.in/Projectreport/Project%20Report638658577659968214.pdf> |
| corrugated-box-manufacturing | PROJECT PROFILE ON CARD BOARD BOXES MANUFACTURING UNIT (PROF. NO.37) | National Scheduled Tribes Finance and Development Corporatio | 6 | Total 184000 (Rs; TOTAL CAPITAL INVESTMENT = machinery 11000 | <https://nstfdc.tribal.gov.in/UploadData/pdf/cardboard_boxes(1).pdf> |
| paper-products | PROJECT REPORT Of PAPER CUP | Department of MSME & Export Promotion, Government of Uttar P | 18 | Rs 21.03 Lacs | <https://msme1connect.up.gov.in/Projectreport/Project%20Report638658513876419061.pdf> |
| paper-products | PROJECT REPORT PROJECT: PAPER BAG | Department of MSME & Export Promotion, Government of Uttar P | 7 | not stated | <https://msme1connect.up.gov.in/Projectreport/Project%20Report638652317325580261.pdf> |
| paper-products | PROJECT PROFILE ON PAPER NAPKINS MANUFACTURINGUNIT (PROF. NO.34) | National Scheduled Tribes Finance and Development Corporatio | 6 | Total 1279100 (Rs; TOTAL CAPITAL INVESTMENT) | <https://nstfdc.tribal.gov.in/UploadData/pdf/paper_napkins.pdf> |
| food-dehydration | Model Detailed Project Report ONION PROCESSING UNIT Under the Formalization of Micro Food  | Indian Institute of Food Processing Technology (IIFPT), Than | 27 | Rs. 30 Lakhs | <https://niftem-t.ac.in/pmfme/DPR-Onion.pdf> |
| food-dehydration | PROJECT REPORT Of GARLIC POWDER & FLAKES | Department of MSME & Export Promotion, Government of Uttar P | 8 | not stated | <https://msme1connect.up.gov.in/Projectreport/Project%20Report638665731337389196.pdf> |
| beekeeping-honey | DETAILED PROJECT REPORT HONEY PROCESSING BUSINESS UNDER PMFME SCHEME | NIFTEM, Kundli (PMFME scheme, Ministry of Food Processing In | 25 | Rs.20.56 Lakh | <https://niftem.ac.in/newsite/pmfme/wp-content/uploads/2022/08/honeyprocessingdpr.pdf> |
| beekeeping-honey | PROJECT PROFILE ON BEE KEEPING & HONEY PROCESSING UNIT (PROF. NO.8) | National Scheduled Tribes Finance and Development Corporatio | 7 | Total 342900 (Rs; TOTAL CAPITAL INVESTMENT) | <https://nstfdc.tribal.gov.in/UploadData/pdf/bee_keeping.pdf> |
| beekeeping-honey | PROJECT REPORT Of HONEY BEE FARMING | Department of MSME & Export Promotion, Government of Uttar P | 8 | not stated | <https://msme1connect.up.gov.in/Projectreport/Project%20Report638658902786138807.pdf> |
| readymade-garments | READYMADE GARMENTS | National Scheduled Tribes Finance and Development Corporatio | 4 | 1,00,000.00 (Rs.) | <https://nstfdc.tribal.gov.in/UploadData/pdf/readymade_garments.pdf> |
| readymade-garments | PROJECT REPORT Of UNIFORM | Department of MSME & Export Promotion, Government of Uttar P | 8 | not stated | <https://msme1connect.up.gov.in/Projectreport/Project%20Report638665896660878640.pdf> |
| readymade-garments | PROJECT REPORT Of BABY GARMENTS | Department of MSME & Export Promotion, Government of Uttar P | 7 | not stated | <https://msme1connect.up.gov.in/Projectreport/Project%20Report638652132660954105.pdf> |
| coffee-kiosk-cafe | DETAILED PROJECT REPORT FOR PROCESSING OF COFFEE POWDER | NIFTEM-Thanjavur, formerly IIFPT (PMFME scheme, Ministry of  | 29 | Rs. 30.00 Lakhs | <https://niftem-t.ac.in/pmfme/dpr-cpowder.pdf> |
| coffee-kiosk-cafe | PROJECT REPORT Of FOOD TRUCK BUSINESS | Department of MSME & Export Promotion, Government of Uttar P | 15 | Grand Total 9.84 (Rs lakh: machinery/equipment 6.84 + workin | <https://msme1connect.up.gov.in/Projectreport/Project%20Report638658907292524711.pdf> |
| coffee-kiosk-cafe | ROADSIDE DHABA | National Scheduled Tribes Finance and Development Corporatio | 4 | 70,000.00 (Rs.) | <https://nstfdc.tribal.gov.in/UploadData/pdf/roadside_dhaba.pdf> |

Unreachable hosts and the specific URLs to retry from an India-based network are listed at the end of
`research/catalog/pilot_documents.yaml`.

## What the three processed records show

Each was run end to end as the restricted `planb_worker` role with the rule-based extractor (no LLM, no cost):

- every extracted claim's quote was found on its cited page;
- machinery line items sum to the document's stated plant-and-machinery total (₹7.20 L, ₹13.60 L, ₹8.36 L);
- the engine, pinned to each source's year-1 assumptions, reproduces the source's stated sales within 1.0–3.5 %
  (the gap is the source's closing-stock adjustment);
- completeness is 54 %, with two critical sections missing (description, regulatory mapping); all observations are
  grade C, unverified and — being dated 2021–22 — already past their revalidation date;
- 21–26 research tasks were raised per record.

That is the correct state for a record built from one government report: a costed skeleton, not a finding.

## Human research required next (in priority order)

1. **Reuse permissions.** Write to NIFTEM (`pmfmecell@niftem.ac.in`) and NIFTEM-T for permission to extract and
   commercially reuse figures from PMFME DPRs; record the reply in the source registry (*Source registry → record
   permission*). Read and record the terms of NSTFDC, UP MSME 1-Connect, NCDC and Bihar Horticulture. Without this,
   nothing derived from these documents can be published. Retry DC-MSME, KVIC and NABARD from an India-based network.
2. **Supplier quotations.** Three written, consented quotations per machine for delivery to Pune and Nanded, for the
   three processed records first (18 machinery lines in total). Template: `research/templates/supplier_enquiry.md`.
3. **Owner interviews.** Three operating owners and one former owner per pilot model, with recorded consent.
   Guide: `research/templates/owner_interview.md`. Start with the coffee kiosk and the retail bakery, which have no
   usable document at all.
4. **Local costs.** Rents, wages, tariffs and selling prices for Pune and Nanded. Template:
   `research/templates/rent_enquiry.md`.
5. **Regulation.** Verify each lead in the backlog against its authority, separately for Pune and Nanded.
   Checklist: `research/templates/regulatory_checklist.md`.
6. **Review.** A reviewer reads the 169 extracted claims beside their pages (*Review inbox*).
7. **LLM extraction.** Provide an Anthropic API key to process the 24 documents that are not in the NIFTEM-Kundli
   template, with a per-run budget; review a sample of its claims against the pages before trusting it at volume.
