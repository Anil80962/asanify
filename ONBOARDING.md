# Asanify auto clock-in — employee onboarding

This is an **opt-in** internal tool. It clocks you in on Asanify automatically
every weekday. You log into your own Google once on your own PC; the system
never sees your password — only an encrypted session you generate yourself.
If you don't want this, don't enroll.

## What you need

- Windows/Mac/Linux PC with **Google Chrome** installed
- **Node.js 20+** (https://nodejs.org — install the LTS)

## Steps (≈5 minutes, one time)

1. Get the project folder from your admin (or `git clone` the private repo).
2. Open a terminal in that folder and run:
   ```
   npm install
   npx playwright install chromium
   npm run capture
   ```
3. A browser window opens. Click **Sign in with Google**, log in with **your
   own** Google account (password + 2FA). Wait for the Asanify dashboard.
4. The window closes and the terminal prints **two values**:
   - your **Asanify employee code**
   - your **session (base64)** — one long line

5. Send **both values to your admin over a private channel** (DM, not a public
   group). They're sensitive — the base64 is effectively your login.

That's it. The admin wires you into the schedule. From the next weekday, you're
clocked in automatically.

## Later

- If you ever get a message that your clock-in stopped working, it just means
  Google expired your saved session — re-run `npm run capture` and send the new
  base64 to your admin. (Expect this every few weeks.)
- To stop: tell your admin to remove you from `employees.json` and delete your
  secrets. You can also revoke the session anytime from your Google Account →
  Security → Your devices / third-party access.

## Honest note

This marks you present in the official payroll/attendance system at a fixed
time regardless of when you actually start, and Asanify records IP/location
context. Enroll only if you're comfortable with that.
