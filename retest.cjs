// Integrity check + live re-test, reading the token straight from the JSON
// (no --env-file in the path). Prints only safe fragments of the secret.
const fs = require("fs");
const path = require("path");

const har = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const clock = har.log.entries.find(
  (e) => e.request.method === "POST" && /\/api\/attendance\/clock(\?|$)/.test(e.request.url)
);
const harTok = clock.request.headers.find((h) => h.name.toLowerCase() === "refresh-token").value;

const sec = JSON.parse(fs.readFileSync(path.join(__dirname, "captured", "asanify-secrets.json"), "utf8"));
const jsonTok = sec.ASANIFY_REFRESH_TOKEN;

const envRaw = fs.readFileSync(path.join(__dirname, "captured", "asanify.env"), "utf8");
const envTok = (envRaw.match(/ASANIFY_REFRESH_TOKEN=(.*)/) || [])[1];

function frag(t) {
  return t ? `len=${t.length} head=${t.slice(0, 6)} tail=${t.slice(-10)}` : "(missing)";
}
console.log("HAR  token :", frag(harTok));
console.log("JSON token :", frag(jsonTok));
console.log("ENV  token :", frag(envTok));
console.log("HAR===JSON :", harTok === jsonTok);
console.log("HAR===ENV  :", harTok === envTok);

(async () => {
  const empcode = sec.ASANIFY_EMPCODE;
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const body = {
    asan_empcode: empcode,
    clock_date: `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`,
    clock_time: `${d.getHours()}:${d.getMinutes()}:${d.getSeconds()}`,
  };
  const hdrs = {
    accept: "application/json, text/plain, */*",
    "content-type": "application/json",
    origin: "https://secure.asanify.com",
    referer: "https://secure.asanify.com/",
    "refresh-token": jsonTok,
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
  };
  console.log("\nLive test -> POST /api/attendance/status (non-destructive)");
  const res = await fetch("https://api.asanify.com/api/attendance/status", {
    method: "POST",
    headers: hdrs,
    body: JSON.stringify(body),
  });
  const txt = await res.text();
  console.log("HTTP", res.status, res.statusText);
  console.log("body:", txt.slice(0, 300));
})();
