// Pulls the refresh-token + asan_empcode out of the HAR into a local,
// git-ignored file. Does NOT print secret values to stdout.
const fs = require("fs");
const path = require("path");
const HAR = process.argv[2];
const har = JSON.parse(fs.readFileSync(HAR, "utf8"));

const clock = har.log.entries.find(
  (e) => e.request.method === "POST" && /\/api\/attendance\/clock(\?|$)/.test(e.request.url)
);
if (!clock) {
  console.error("Could not find the /api/attendance/clock request in the HAR.");
  process.exit(1);
}

const rtHeader = clock.request.headers.find((h) => h.name.toLowerCase() === "refresh-token");
if (!rtHeader || !rtHeader.value) {
  console.error("Clock request had no refresh-token header.");
  process.exit(1);
}
let body = {};
try { body = JSON.parse(clock.request.postData.text); } catch {}
const empcode = body.asan_empcode;
if (!empcode) {
  console.error("Could not read asan_empcode from clock request body.");
  process.exit(1);
}

const outDir = path.join(__dirname, "captured");
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, "asanify-secrets.json");
fs.writeFileSync(
  out,
  JSON.stringify({ ASANIFY_REFRESH_TOKEN: rtHeader.value, ASANIFY_EMPCODE: empcode }, null, 2)
);
// .env form for local testing convenience
fs.writeFileSync(
  path.join(outDir, "asanify.env"),
  `ASANIFY_REFRESH_TOKEN=${rtHeader.value}\nASANIFY_EMPCODE=${empcode}\n`
);

console.log("Wrote captured/asanify-secrets.json and captured/asanify.env");
console.log("  ASANIFY_REFRESH_TOKEN: <" + rtHeader.value.length + " chars, hidden>");
console.log("  ASANIFY_EMPCODE:       " + empcode.slice(0, 6) + "…(" + empcode.length + " chars)");
console.log("  source clock_type was: " + (body.clock_type || "?"));
