---
covers: ["#2/export-pdf"]
---
# Export invoices as PDF (demo app lacks this: should fail)

- do: open "http://localhost:4173/"
- do: type "{{email}}" into the email field
- do: type "{{password}}" into the password field
- do: click sign in
- expect: a list of invoices is shown
- expect: there is a button to export invoices as PDF
