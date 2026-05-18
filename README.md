# asanify-autoclock (multi-employee)

Automated Mon–Fri Asanify clock-in for a small team (2–5 people), running free
on GitHub Actions. Asanify has no API key — every clock-in needs a fresh Google
SSO login (proven during reverse-engineering), so each run drives a headless
browser to log in, intercepts the freshly-minted `refresh-token` from the app's
own traffic, and immediately fires the clock-in `POST`.

## Architecture

```
Each employee (once, own PC):  npm run capture -> own Google login
                               -> session base64 + employee code  --(private)--> admin

Admin: employees.json (+ 2 GitHub secrets per person)

GitHub Actions cron (Mon-Fri):
  plan job        -> reads employees.json -> builds a job matrix
  clock-in job    -> one run per employee (serialized):
                       restore that employee's session (headless Chromium)
                       -> Asanify SSO logs in silently
                       -> intercept fresh refresh-token
                       -> POST /api/attendance/clock  (clock_type:"IN")
```

`clock-in.mjs` / `lib.mjs` are per-employee and unchanged from the single-user
version — multi-employee is just the roster + matrix workflow. No GPS/selfie
(verified from captured traffic).

## Admin: deploy

1. Create a **private** GitHub repo and push this folder:
   ```
   git init && git add . && git commit -m "asanify autoclock"
   git remote add origin <private-repo-url> && git push -u origin main
   ```
   `.gitignore` excludes `auth/`, `captured/`, `*.har` — confirm with
   `git status` that none are staged. **The repo must be private.**
2. Set the schedule: edit the `cron:` line in
   `.github/workflows/clock-in.yml` (IST→UTC table in the comments; default
   = 09:30 IST). Hosted cron can lag 5–15 min — set early if it matters.

## Admin: add an employee

For each person (including yourself) who completed [`ONBOARDING.md`](./ONBOARDING.md):

1. They send you their **employee code** and **session base64** privately.
2. Pick a short id (letters/digits/underscore), e.g. `anil`. Add it to
   `employees.json`:
   ```json
   { "employees": ["anil", "priya"] }
   ```
3. Repo → **Settings → Secrets and variables → Actions → New repository
   secret**, add **two** (id uppercased):

   | Secret | Value |
   |---|---|
   | `ASANIFY_STATE_<ID>` | the session base64 they sent |
   | `ASANIFY_EMPCODE_<ID>` | their employee code |

   e.g. `ASANIFY_STATE_ANIL`, `ASANIFY_EMPCODE_ANIL`.
4. Commit the `employees.json` change and push.

To remove someone: delete their id from `employees.json` and delete their two
secrets.

## Test

**Actions** tab → "Asanify clock-in (multi-employee)" → **Run workflow** with
*Dry run = true*. Every employee should go green (this verifies each login
end-to-end and does **not** clock anyone in). Then run once with *Dry run =
false* to confirm a real clock-in. A failed employee uploads an
`asanify-failure-<id>` artifact (screenshot + HTML) so you can see what Google
or Asanify showed.

## Costs / limits

- GitHub Actions free tier for a **private** repo: 2,000 min/month. ~5
  employees × ~3 min × 22 weekdays ≈ ~330 min/month — well within free.
  (Browsers are cached between runs to keep this low.)
- Jobs run serialized (`max-parallel: 1`) so Google sees one login at a time.

## Caveats (important)

- **The Google session is the fragile part.** It will periodically expire or
  Google will demand re-verification — likelier from GitHub's datacenter IPs,
  and a bit more with several accounts from the same runner. When an employee's
  run fails with "Never saw an authenticated API call", they re-run
  `npm run capture` and you update their `ASANIFY_STATE_<ID>` secret. Expect
  this every few weeks per person. If it's too frequent, the same code runs
  unchanged on a fixed-IP VM (Google challenges those far less).
- **Holidays/leave:** clocks everyone in every weekday regardless. Add a
  skip-list later if wanted.
- Sessions are stored as encrypted GitHub Actions secrets (not in logs, not in
  git). Acceptable for a small internal tool; keep the repo private and
  membership tight.

## Honest note

This writes to each enrolled person's official payroll/attendance record at a
fixed time regardless of when they actually start, with IP/location captured.
Keep it opt-in and company-sanctioned — see [`ONBOARDING.md`](./ONBOARDING.md).

## Files

| File | What |
|---|---|
| `ONBOARDING.md` | what each employee runs (give them this) |
| `capture-session.mjs` | one-time local login → session + employee code |
| `clock-in.mjs` / `lib.mjs` | per-employee headless login + token intercept + clock |
| `employees.json` | roster (ids only, no secrets) |
| `.github/workflows/clock-in.yml` | plan + matrix cron, one run per employee |
| `parse-har.cjs`, `inspect-*.cjs`, `extract-secrets.cjs` | reverse-engineering diagnostics (reference) |
