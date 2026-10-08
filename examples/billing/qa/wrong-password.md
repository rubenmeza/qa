---
covers: ["#1/wrong-password"]
---
# Wrong password is rejected

- do: open "http://localhost:4173/"
- do: type "{{email}}" into the email field
- do: type "nope" into the password field
- do: press "Enter"
- expect: an error says the email or password is wrong
- expect: the sign-in form is still shown
