// Deep look at auth on api.asanify.com calls. Prints header NAMES and value
// LENGTHS only (no secret values) + cookie usage + request timeline order.
const fs = require("fs");
const har = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const ents = har.log.entries.filter((e) => /api\.asanify\.com/.test(e.request.url));

ents.sort((a, b) => new Date(a.startedDateTime) - new Date(b.startedDateTime));

console.log("=== api.asanify.com timeline ===");
for (const e of ents) {
  const u = new URL(e.request.url).pathname;
  console.log(`${e.startedDateTime}  ${e.request.method} ${e.response.status}  ${u}`);
}

function dumpHeaders(label, e) {
  console.log(`\n=== ${label}: ${e.request.method} ${new URL(e.request.url).pathname} (status ${e.response.status}) ===`);
  console.log("request.cookies entries:", (e.request.cookies || []).length);
  for (const h of e.request.headers) {
    const n = h.name;
    const ln = n.toLowerCase();
    const authish = /authorization|token|cookie|session|auth|jwt|bearer/i.test(ln);
    if (authish) console.log(`  ${n}: <len ${h.value ? h.value.length : 0}>`);
    else console.log(`  ${n}: ${String(h.value).slice(0, 80)}`);
  }
  // response set-cookie?
  const sc = (e.response.headers || []).filter((h) => h.name.toLowerCase() === "set-cookie");
  if (sc.length) console.log("  <- set-cookie names:", sc.map((s) => s.value.split("=")[0]).join(", "));
}

for (const path of ["/api/attendance/status", "/api/attendance/clock", "/api/auth/login/google"]) {
  const e = ents.find((x) => new URL(x.request.url).pathname === path);
  if (e) dumpHeaders(path, e);
}
