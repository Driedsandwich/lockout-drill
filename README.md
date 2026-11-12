# Lockout Drill

**If your phone disappeared today, which accounts could you still get back into?**

Lockout Drill is a single-page, offline prototype. You describe each account only by *method type* (authenticator app on phone, SMS code, passkey, backup codes and where they are stored, recovery email, memorized passphrase). Press **Lose my phone** to see how many accounts you would be locked out of, the dependency chain behind each one (for example `Bank ← SMS ← Phone`), and which fixes rescue the most accounts.

- No secrets: it never asks for passwords, IDs, phone numbers, email addresses, or recovery codes.
- Nothing leaves your device. No sign-up. No cost. Works offline.
- Unknown stays **Unknown** — it is never shown as safe.

> Status: prototype built for SafeSpace Hacks (build window October 17 – November 22, 2026). It is a model of your setup, not proof that recovery will work. Some services offer other recovery paths.

## Try it
Open `index.html` in a browser and press **Try the sample student** (a fictional student with 9 accounts).

## Tests
```
node --test tests/
```

## Built with
Plain HTML, CSS and JavaScript in one file. No external requests, fonts, or libraries.

## Credits and AI assistance
- Prototype code and tests were generated with OpenAI Codex from written specifications and design mockups; planning, review, and browser testing used Anthropic Claude.
- All sample data is fictional.
