---
covers: ["#1/core-actions", "#1/jev-target", "#1/jev-expectation"]
---
# Sign in with valid credentials

- do: open "http://localhost:4173/"
- expect: a sign-in form asks for an email and a password
- do: type "{{email}}" into the email field
- do: type "{{password}}" into the password field
- do: click the sign in button
- expect: the user is greeted by name
- expect: a list of invoices is shown
