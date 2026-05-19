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
  contextOptions,
  launchOpts,
  resolveStatePath,
  waitForFreshToken,
  getEmpcode,
  callAttendance,
} from "./lib.mjs";

const DRY_RUN = process.argv.includes("--dry-run");
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);

// Today's date in IST (YYYY-MM-DD). GitHub Actions runners are UTC.
const todayIST = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());

// Holiday check — skip all employees on listed dates.
try {
  const { holidays = [] } = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "holidays.json"), "utf8")
  );
  if (holidays.includes(todayIST)) {
    log(`⏭ Holiday on ${todayIST} — skipping clock-in.`);
    process.exit(0);
  }
} catch {
  /* holidays.json missing or malformed — proceed normally */
}

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
  const tokenP = waitForFreshToken(context, 90_000);
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
  log(`Fresh token intercepted (${token.length} chars). Calling attendance API...`);

  const res = await callAttendance(page, { token, authorization, empcode, dryRun: DRY_RUN });

  if (res.status !== 200) {
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
