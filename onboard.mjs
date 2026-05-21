// npm run onboard
//
// One command for a new employee. Opens Google login, captures session,
// then automatically registers them in the dashboard (no copy-pasting).
//
// Requires a onboard.config.json in this folder (created by the admin):
//   { "dashboardUrl": "https://employee-status-one-phi.vercel.app", "adminPassword": "..." }
//
// Run:  npm run onboard
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { chromium } from "playwright";
import { ASANIFY_APP, contextOptions, waitForFreshToken, waitForEmpcode } from "./lib.mjs";

// ── Load config ──────────────────────────────────────────────────────────────
const configPath = path.join(process.cwd(), "onboard.config.json");
if (!fs.existsSync(configPath)) {
  console.error("❌ onboard.config.json not found.");
  console.error("   Create it with:");
  console.error('   { "dashboardUrl": "https://employee-status-one-phi.vercel.app", "adminPassword": "your-password" }');
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
if (!config.dashboardUrl || !config.adminPassword) {
  console.error("❌ onboard.config.json must have dashboardUrl and adminPassword.");
  process.exit(1);
}

// ── Ask for employee name and ID ──────────────────────────────────────────────
function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()); }));
}

console.log("\n=== Asanify Employee Onboarding ===\n");
const empName = await ask("Your full name: ");
const empId   = await ask("Short ID for you (e.g. priya, lowercase, no spaces): ");

if (!empName || !empId || !/^[a-zA-Z0-9_]+$/.test(empId)) {
  console.error("❌ Invalid name or ID. ID must be letters/digits/underscore only.");
  process.exit(1);
}

// ── Open browser for Google login ─────────────────────────────────────────────
const browser = await chromium
  .launch({ headless: false, channel: "chrome", args: ["--disable-blink-features=AutomationControlled"] })
  .catch(() => chromium.launch({ headless: false }));

const context = await browser.newContext(contextOptions());
const page = await context.newPage();

console.log("\n🌐 A browser window opened.");
console.log("   1. Click 'Sign in with Google'");
console.log("   2. Log in with YOUR Google account (password + 2FA)");
console.log("   3. Wait until the Asanify dashboard loads");
console.log("   This window will close automatically.\n");

const tokenP  = waitForFreshToken(context, 5 * 60_000);
const empcodeP = waitForEmpcode(context, 5 * 60_000);
await page.goto(ASANIFY_APP, { waitUntil: "domcontentloaded" });

let empcode, sessionB64;
try {
  await tokenP;
  empcode = await empcodeP;
  await page.waitForTimeout(3000);

  const OUT_DIR = path.join(process.cwd(), "auth");
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const statePath = path.join(OUT_DIR, "storageState.json");
  await context.storageState({ path: statePath });

  sessionB64 = Buffer.from(fs.readFileSync(statePath)).toString("base64");
  console.log(`✅ Session captured (${sessionB64.length} chars)`);
  console.log(`✅ Employee code: ${empcode || "(not detected)"}`);
} catch (e) {
  console.error(`\n❌ Login failed: ${e.message}`);
  console.error("   Run npm run onboard again and complete login within 5 minutes.");
  process.exitCode = 1;
  await browser.close();
  process.exit(1);
} finally {
  await browser.close();
}

if (!empcode) {
  empcode = await ask("Employee code not auto-detected. Enter it manually (check Asanify profile): ");
}

// ── Register via dashboard API ────────────────────────────────────────────────
console.log(`\n📤 Registering ${empName} (${empId}) in the dashboard...`);

let res;
try {
  res = await fetch(`${config.dashboardUrl}/api/employees`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-admin-password": config.adminPassword,
    },
    body: JSON.stringify({ id: empId, name: empName, session: sessionB64, empcode }),
  });
} catch (e) {
  console.error(`❌ Could not reach dashboard: ${e.message}`);
  console.error("   Check dashboardUrl in onboard.config.json and your internet connection.");
  process.exit(1);
}

if (res.ok) {
  console.log(`\n✅ Done! ${empName} has been added to the system.`);
  console.log(`   Auto clock-in is ON for ${empId}.`);
  console.log(`   From the next weekday, ${empName} will be clocked in at 10:00 AM IST.\n`);
} else {
  const body = await res.json().catch(() => ({}));
  console.error(`\n❌ Registration failed (HTTP ${res.status}): ${body.error || "unknown error"}`);
  if (res.status === 409) console.error(`   Employee "${empId}" already exists. Use a different ID.`);
  if (res.status === 401) console.error("   Wrong admin password in onboard.config.json.");
  process.exit(1);
}
