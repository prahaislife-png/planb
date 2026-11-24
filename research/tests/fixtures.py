"""Synthetic fixtures. Nothing here is business data: every figure is an obviously artificial round number."""

from __future__ import annotations

SYNTHETIC_DPR_PAGES: list[tuple[int, str]] = [
    (1, """                     DETAILED PROJECT REPORT
                  SYNTHETIC TEST POWDER UNIT
                     UNDER PMFME SCHEME
        (automated-test fixture - not a real document)
"""),
    (2, """                         1. PROJECT SUMMARY
1. Name of the proposed project                :   Synthetic Test Powder Unit
3. Proposed project capacity                   : 120000 Kg/annum (50,60,70,80&100% capacity
                                                 utilization in 1st to 5th Year respectively)
"""),
    (3, """4.1. BASIS & PRESUMPTIONS
3. Raw Material stock is for 10 days and Finished goods Closing Stock has been taken for 5 days.
4. Credit period to Sundry Debtors has been given for 20 days.
5. Credit period by the Sundry Creditors has been provided for 10 days.
7. Interest on working Capital Loan and Term loan has been taken at 10%.
9. Power Consumption has been taken at 12 KW.
10. Increase in sales and raw material costing has been taken @ 0% on a yearly basis.
"""),
    (4, """4.2.   CAPACITY, UTILIZATION, PRODUCTION & OUTPUT
        COMPUTATION OF PRODUCTION OF SYNTHETIC TEST POWDER
        Working days in a month                                  25          Days
         Wastage Considered                                     0%
         Raw material requirement                            120000           Kg
        Final Output per annum after wastage                 120000           Kg
COMPUTATION OF SALE
Particulars             1st year    2nd year 3rd year 4th year 5th year
Sale price per packet     100.00       100.00       100.00      100.00      100.00
4.3. PREMISES/INFRASTRUCTURE
   The approximate total area required for complete factory setup is 1000-1500 Sq. ft. for
   smooth production including storage area.
"""),
    (5, """4.4.    MACHINERY & EQUIPMENTS
 Machine                                            Unit           Rate        Price
 Synthetic grinder                                  2              200000      400000
 Synthetic packer                                   1              100000      100000
Note: Total Machinery cost shall be Rs 5.00 lakh including equipment's but excluding GST
       and Transportation Cost.
4.6. TOTAL COST OF PROJECT
                              COST OF PROJECT
                                                                  (in Lacs)
       Plant & Machinery                                                 5.00
       Miscellaneous Assets                                              1.00
       Working capital                                                   2.00
      Total                                                              8.00
4.7. MEANS OF FINANCE
                                 MEANS OF FINANCE
         Own Contribution (min 10%)                                                0.80
         Subsidy @35%(Max. Rs 10 Lac)                                              2.10
         Term Loan @ 55%                                                           3.00
         Working Capital (Bank Finance)                                            2.10
        Total                                                                      8.00
"""),
    (6, """  DOOR TO DOOR        60      MONTHS
  MORATORIUM
     PERIOD           6       MONTHS
4.11. SALARY & WAGES
       BREAK UP OF LABOUR CHARGES
       Particulars                                Wages      No of               Total
      Operator                                       10,000                 2    20,000
       Total salary per month                                                    20,000
     BREAK UP OF STAFF SALARY CHARGES
     Particulars                             Salary          No of          Total
     Manager                                    20,000                 1    20,000
     Total salary per month                                                 20,000
4.12 POWER REQUIREMENT
      Utility Charges (per month)
      power Bill per month                        10,000 Rs.
4.14. REPAIR & MAINTENANCE: Repair & Maintenance is 2.0 % of Gross Sale.
"""),
    (7, """4.15. PROJECTIONS OF PROFITABILITY ANALYSIS
     PROJECTED PROFITABILITY STATEMENT                                           (in Lacs)
     PARTICULARS                   1st year 2nd year 3rd year 4th year 5th year
     Capacity Utilisation %             50%     60%       70%     80%       100%
     SALES
     Gross Sale
     Synthetic Test Powder            60.00      72.00       84.00      96.00      120.00
     Total                            60.00      72.00       84.00      96.00      120.00
     COST OF SALES
     Raw Material Consumed            30.00      36.00       42.00      48.00       60.00
     Packaging                         3.00        3.60        4.20      4.80         6.00
     GROSS PROFIT                     12.00       15.00       18.00     21.00        24.00
     Rent                              2.40        2.40        2.40      2.40         2.40
     selling & adm exp                 1.20       1.20        1.20       1.20        1.20
     NET PROFIT                        5.00       6.00        7.00       8.00        9.00
     PROFIT (After Tax)                5.00       6.00        7.00       8.00        9.00
"""),
]


def minimal_pdf(lines: list[str]) -> bytes:
    """A tiny, valid, single-page text PDF built by hand (no PDF library needed in tests)."""
    content = "BT /F1 11 Tf 50 780 Td 14 TL " + " ".join(
        "(" + ln.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)") + ") Tj T*" for ln in lines
    ) + " ET"
    objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        f"<< /Length {len(content)} >>\nstream\n{content}\nendstream",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = b"%PDF-1.4\n"
    offsets = []
    for i, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n{body}\nendobj\n".encode("latin-1")
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return out
