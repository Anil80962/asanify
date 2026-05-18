// ONE-TIME, run by EACH employee on their own PC:  npm run capture
//
// Opens a real browser window. The employee logs into Asanify with THEIR OWN
// Google account (password + any 2FA) until the dashboard loads. The script
// then saves:
//   - auth/storageState.json   (their encrypted-at-rest login session)
//   - auth/empcode.txt         (their Asanify employee code)
// and prints the two values to hand to whoever administers the GitHub repo.
// Nobody ever shares a Google password — each person logs in themselves.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { ASANIFY_APP, contextOptions, waitForFreshToken, waitForEmpcode } from "./lib.mjs";

const OUT_DIR = path.join(process.cwd(), "auth");
const STATE = path.join(OUT_DIR, "storageState.json");
const EMPF = path.join(OUT_DIR, "empcode.txt");

const browser = await chromium
  .launch({
    headless: false,
    // Real Chrome — Google blocks it far less than bundled Chromium.
    channel: "chrome",
    args: ["--disable-blink-features=AutomationControlled"],
  })
  .catch(() => chromium.launch({ headless: false }));

const context = await browser.newContext(contextOptions());
const page = await context.newPage();

console.log("\n=== Asanify session capture ===");
console.log("A browser window opened. Do this:");
console.log("  1. Click 'Sign in with Google' and log in (your password + 2FA).");
console.log("  2. Wait until you see the Asanify dashboard.");
console.log("Then this saves your session automatically and closes.\n");

const tokenP = waitForFreshToken(context, 5 * 60_000); // 5 min to log in
const empcodeP = waitForEmpcode(context, 5 * 60_000);
await page.goto(ASANIFY_APP, { waitUntil: "domcontentloaded" });

try {
  await tokenP;
  const empcode = await empcodeP;
  await page.waitForTimeout(3000); // let session cookies settle
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await context.storageState({ path: STATE });
  if (empcode) fs.writeFileSync(EMPF, empcode + "\n");

  const b64 = Buffer.from(fs.readFileSync(STATE)).toString("base64");
  console.log(`\n✅ Session saved -> ${STATE}`);
  console.log(`✅ Employee code -> ${empcode || "(NOT captured — see note below)"}`);
  console.log("\n---------------------------------------------------------------");
  console.log("SEND THESE TWO VALUES to your repo admin (private channel):");
  console.log("---------------------------------------------------------------");
  console.log("1) Your Asanify employee code:");
  console.log("   " + (empcode || "(open Asanify, the admin can also read it from a HAR)"));
  console.log("\n2) Your session, base64 (one line, treat like a password):");
  console.log("   " + b64);
  console.log("---------------------------------------------------------------");
  console.log("The admin adds you to employees.json + two GitHub secrets.\n");
  if (!empcode) {
    console.log("NOTE: employee code wasn't seen automatically. Tell the admin —");
    console.log("they can extract it once from a HAR (see CAPTURE.md).\n");
  }
} catch (e) {
  console.error(`\n❌ ${e.message}`);
  console.error("You didn't finish logging in within 5 minutes, or login failed.");
  console.error("Just run `npm run capture` again.");
  process.exitCode = 1;
} finally {
  await browser.close();
}
