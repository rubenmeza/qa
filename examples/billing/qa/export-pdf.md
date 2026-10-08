---
covers: ["#2/export-pdf"]
requires: [sign-in]
---
# Export invoices as PDF (the example app lacks this, so it fails)

- do: open "http://localhost:4173/"
- expect: a list of invoices is shown
- expect: there is a button to export invoices as PDF
