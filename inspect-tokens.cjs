// Decode JWT lifetimes from the login response; look for token rotation in
// response headers. No secret values printed — only structure/timestamps.
const fs = require("fs");
const har = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const ents = har.log.entries.filter((e) => /api\.asanify\.com/.test(e.request.url));
ents.sort((a, b) => new Date(a.startedDateTime) - new Date(b.startedDateTime));

function jwtInfo(name, tok) {
  const parts = String(tok).split(".");
  if (parts.length !== 3) {
    console.log(`  ${name}: ${parts.length}-segment, len ${tok.length} (opaque/encrypted, not a JWT)`);
    return;
  }
  try {
    const pl = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    const iat = pl.iat ? new Date(pl.iat * 1000).toISOString() : "?";
    const exp = pl.exp ? new Date(pl.exp * 1000).toISOString() : "?";
    const life = pl.exp && pl.iat ? `${Math.round((pl.exp - pl.iat) / 60)} min` : "?";
    console.log(`  ${name}: JWT len ${tok.length}  iat=${iat}  exp=${exp}  lifetime=${life}`);
    console.log(`     claims: ${Object.keys(pl).join(", ")}`);
  } catch (e) {
    console.log(`  ${name}: JWT but payload decode failed (${e.message})`);
  }
}

const login = ents.find((e) => /\/api\/auth\/login\/google/.test(e.request.url));
if (login && login.response.content && login.response.content.text) {
  console.log("=== /api/auth/login/google response tokens ===");
  let j;
  try { j = JSON.parse(login.response.content.text); } catch {}
  if (j) for (const k of Object.keys(j)) jwtInfo(k, j[k]);
  console.log("  response time:", login.startedDateTime);
}

console.log("\n=== auth-relevant RESPONSE headers per call (rotation check) ===");
for (const e of ents) {
  const p = new URL(e.request.url).pathname;
  const hs = (e.response.headers || []).filter((h) =>
    /refresh-token|access-token|authorization|set-cookie|x-.*token|token/i.test(h.name)
  );
  if (hs.length) {
    console.log(`${p} (${e.response.status}):`);
    for (const h of hs) console.log(`   <- ${h.name}: <len ${h.value ? h.value.length : 0}>`);
  }
}

// Did the SAME refresh-token value get reused across requests, or rotate?
console.log("\n=== refresh-token request header value reuse ===");
const seen = new Map();
let idx = 0;
for (const e of ents) {
  const h = e.request.headers.find((x) => x.name.toLowerCase() === "refresh-token");
  if (!h) continue;
  const key = h.value;
  if (!seen.has(key)) seen.set(key, ++idx);
  console.log(`  ${new URL(e.request.url).pathname}: token#${seen.get(key)} (len ${key.length})`);
}
console.log(`  distinct refresh-token values sent by browser: ${seen.size}`);
