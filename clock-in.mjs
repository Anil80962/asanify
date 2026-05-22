// Scheduled job. Restores the saved Google/Asanify session, lets Asanify SSO
// log in fresh (no password — cookies do it silently), intercepts the freshly
// minted refresh-token from the SPA's own traffic, and immediately calls the
// attendance API while that token is still valid.
//
//   node clock-in.mjs            -> real clock-IN  (POST /api/attendance/clock)
//   node clock-in.mjs --dry-run  -> safe check     (POST /api/attendance/status)
//
// Needs: a saved session (auth/storageState.json locally, or ASANIFY_STATE_B64
// in CI) and ASANIFY_EMPCODE.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import {
  ASANIFY_APP,
  ASANIFY_API,
  contextOptions,
  launchOpts,
  resolveStatePath,
  waitForFreshToken,
  waitForEmpcode,
  getEmpcode,
  callAttendance,
} from "./lib.mjs";

const DRY_RUN = process.argv.includes("--dry-run");
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);

// ── Working-day gate ────────────────────────────────────────────────────────
// All checks use IST so the date is correct even on UTC GitHub runners.

// IST date string "YYYY-MM-DD" and day-of-week (0=Sun … 6=Sat).
const istNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
const todayIST = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());
const DAY_NAMES = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const dayOfWeek = istNow.getDay(); // 0=Sun, 6=Sat

// 1. Weekend check
if (dayOfWeek === 0 || dayOfWeek === 6) {
  log(`⏭ ${DAY_NAMES[dayOfWeek]} (${todayIST}) is a weekend — skipping clock-in.`);
  process.exit(0);
}

// 2. Holiday check — dates listed in holidays.json are skipped for all employees.
try {
  const { holidays = [] } = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "holidays.json"), "utf8")
  );
  // Support both flat string array and {date, label} object array
  const holidayDates = holidays.map(h => typeof h === "string" ? h : h.date);
  const match = holidays.find(h => (typeof h === "string" ? h : h.date) === todayIST);
  if (holidayDates.includes(todayIST)) {
    const label = match && typeof match === "object" ? match.label : todayIST;
    log(`⏭ Holiday: ${label} (${todayIST}) — skipping clock-in.`);
    process.exit(0);
  }
} catch {
  /* holidays.json missing or malformed — proceed normally */
}

// 3. Time window guard — GitHub Actions scheduled jobs can lag significantly.
//    If this is a scheduled run (not a manual dispatch) and the current IST
//    time is past 10:45 AM, the run is too late to be useful; skip it so
//    employees don't get a mid-afternoon clock-in.
//    CLOCK_IN_CUTOFF_HOUR env var overrides the cutoff (default 10, i.e. 10:45).
if (process.env.GITHUB_EVENT_NAME === "schedule") {
  const cutoffHour = parseInt(process.env.CLOCK_IN_CUTOFF_HOUR || "11", 10);
  const istHour = istNow.getHours();
  const istMin  = istNow.getMinutes();
  if (istHour > cutoffHour || (istHour === cutoffHour && istMin > 0)) {
    log(`⏭ Ran too late (${istHour}:${String(istMin).padStart(2,"0")} IST, cutoff 11:00 IST). Skipping to avoid late attendance.`);
    process.exit(0);
  }
}

// 4. Employee leave: handled below — if Asanify returns IS_VALID=false with a
//    leave/holiday reason, the script exits 0 (graceful skip, not a failure).
// ────────────────────────────────────────────────────────────────────────────

const statePath = resolveStatePath();
const empcode = getEmpcode();

const browser = await chromium.launch(launchOpts({ headless: true }));
const context = await browser.newContext({
  ...contextOptions(),
  storageState: statePath,
});
const page = await context.newPage();

async function dumpFailure(tag) {
  try {
    fs.mkdirSync(path.join(process.cwd(), "auth"), { recursive: true });
    await page.screenshot({ path: `auth/failure-${tag}.png`, fullPage: true });
    fs.writeFileSync(`auth/failure-${tag}.html`, await page.content());
    log(`Saved auth/failure-${tag}.png + .html for diagnosis.`);
  } catch {
    /* best effort */
  }
}

try {
  log(`Mode: ${DRY_RUN ? "DRY RUN (status only)" : "CLOCK-IN"}. Restoring session...`);
  const tokenP   = waitForFreshToken(context, 90_000);
  const empcodeP = waitForEmpcode(context, 20_000); // intercept empcode from SPA traffic
  await page.goto(ASANIFY_APP, { waitUntil: "domcontentloaded" });

  // SSO may bounce through accounts.google.com and back. We don't drive it —
  // valid cookies make it silent. We just wait for the SPA to authenticate.
  let token, authorization;
  try {
    ({ token, authorization } = await tokenP);
  } catch (e) {
    await dumpFailure("noauth");
    log(`❌ Never saw an authenticated API call: ${e.message}`);
    log("Likely the saved Google session expired / Google asked to re-verify.");
    log("Fix: re-run `npm run capture` locally and update the ASANIFY_STATE_B64 secret.");
    process.exitCode = 1;
    throw e;
  }

  // Try to get empcode from the SPA's own API traffic — more reliable than the
  // stored value. If the SPA's home page doesn't trigger an attendance call,
  // navigate to the attendance section to force one.
  let resolvedEmpcode = empcode;
  try {
    // Give SPA 3 s to make an attendance call on its own, then nudge it.
    const nudge = setTimeout(async () => {
      try { await page.goto(ASANIFY_API.replace("api.", "secure.") + "/attendance", { waitUntil: "domcontentloaded", timeout: 10_000 }); } catch { /* best effort */ }
    }, 3000);
    const detected = await empcodeP;
    clearTimeout(nudge);
    if (detected && detected !== resolvedEmpcode) {
      log(`Empcode auto-detected from SPA: ${detected} (stored was: ${resolvedEmpcode}) — using detected value.`);
      resolvedEmpcode = detected;
    } else if (detected) {
      log(`Empcode confirmed from SPA: ${detected}`);
    } else {
      log(`Empcode not intercepted from SPA, using stored value: ${resolvedEmpcode}`);
    }
  } catch {
    log(`Empcode intercept timed out, using stored value: ${resolvedEmpcode}`);
  }

  log(`Fresh token intercepted (${token.length} chars). Calling attendance API...`);

  const res = await callAttendance(page, { token, authorization, empcode: resolvedEmpcode, dryRun: DRY_RUN });

  const ok = res.status === 200 || res.status === 204;
  if (!ok) {
    await dumpFailure("api");
    log(`❌ ${res.kind} HTTP ${res.status}: ${res.text.slice(0, 400)}`);
    process.exitCode = 1;
    throw new Error("attendance API non-200");
  }

  if (DRY_RUN) {
    log(`✅ DRY RUN ok. Auth path works, no clock-in performed. Body: ${res.text.slice(0, 200)}`);
  } else {
    let j = {};
    try {
      j = JSON.parse(res.text);
    } catch {
      /* fall through */
    }
    if (j.IS_VALID === false) {
      const reason = (j.REASON || "").toUpperCase();
      if (reason.includes("LEAVE") || reason.includes("HOLIDAY") || reason.includes("ABSENT")) {
        log(`⏭ Skipped — Asanify says: "${j.REASON}". Employee is on leave/holiday today.`);
        process.exit(0);
      }
      log(`❌ Asanify rejected clock-in. REASON: ${j.REASON || "(none)"} | ${res.text.slice(0, 300)}`);
      process.exitCode = 1;
      throw new Error("IS_VALID false");
    }
    log(
      `✅ Clocked IN. LAST_CLOCK_TYPE=${j.LAST_CLOCK_TYPE} ` +
        `LAST_CLOCK_TIME=${j.LAST_CLOCK_TIME} REASON="${j.REASON ?? ""}"`
    );
  }
} catch (err) {
  if (process.exitCode !== 1) {
    log(`❌ Unexpected error: ${err?.message || err}`);
    await dumpFailure("error");
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
