// Local-only HAR inspector. Redacts secret values; prints request structure.
const fs = require("fs");
const HAR = process.argv[2];
const MODE = process.argv[3] || "index";
const har = JSON.parse(fs.readFileSync(HAR, "utf8"));
const ents = har.log.entries;

const skip = /\.(js|css|png|jpe?g|gif|svg|woff2?|ttf|ico|map|webp)(\?|$)/i;
const kw = /login|signin|sign-in|auth|token|attend|check.?in|clock|punch|\bmark|session|otp/i;

function redact(s) {
  if (typeof s !== "string") return s;
  // mask long token-ish blobs and obvious secrets
  return s
    .replace(/("?(?:password|passwd|pwd|otp|pin)"?\s*[:=]\s*")[^"]+(")/gi, "$1***REDACTED***$2")
    .replace(/(password|passwd|pwd|otp|pin)=([^&\s]+)/gi, "$1=***REDACTED***")
    .replace(/(Bearer\s+)[A-Za-z0-9._\-]+/g, "$1***REDACTED***")
    .replace(/\b[A-Za-z0-9_\-]{40,}\b/g, "***LONGTOKEN***");
}
function hdr(headers, name) {
  const h = headers.find((x) => x.name.toLowerCase() === name);
  return h ? h.value : undefined;
}

if (MODE === "index") {
  const list = ents.filter((e) => !skip.test(e.request.url) && kw.test(e.request.url));
  console.log(`=== ${list.length} of ${ents.length} entries match keywords ===\n`);
  list.forEach((e, i) => {
    console.log(`[${i}] ${e.request.method} ${e.response.status}  ${e.request.url.slice(0, 160)}`);
  });
} else if (MODE === "detail") {
  const idxs = process.argv.slice(4).map(Number);
  const list = ents.filter((e) => !skip.test(e.request.url) && kw.test(e.request.url));
  for (const i of idxs) {
    const e = list[i];
    if (!e) { console.log(`#${i} not found`); continue; }
    console.log("\n================ #" + i + " ================");
    console.log(e.request.method, e.request.url);
    console.log("-- request headers --");
    for (const h of e.request.headers) {
      const n = h.name.toLowerCase();
      if (n.startsWith(":")) continue;
      const v = ["authorization", "cookie"].includes(n) ? "<present, redacted>" : redact(h.value);
      console.log(`  ${h.name}: ${v}`);
    }
    if (e.request.postData) {
      console.log("-- request body (" + (e.request.postData.mimeType || "?") + ") --");
      console.log("  " + redact(e.request.postData.text || "").slice(0, 1500));
    }
    console.log("-- response status:", e.response.status, e.response.statusText);
    const ct = hdr(e.response.headers, "content-type") || "";
    const setCookie = e.response.headers.filter((h) => h.name.toLowerCase() === "set-cookie");
    if (setCookie.length) console.log("-- set-cookie:", setCookie.map((s) => s.value.split(";")[0].split("=")[0]).join(", "));
    const body = e.response.content && e.response.content.text ? e.response.content.text : "";
    if (/json/i.test(ct) || /^[\[{]/.test(body.trim())) {
      try {
        const j = JSON.parse(body);
        // print structure with secret-ish leaf values masked
        const seen = (o, d) => {
          if (d > 4) return "…";
          if (Array.isArray(o)) return o.length ? [seen(o[0], d + 1)] : [];
          if (o && typeof o === "object") {
            const r = {};
            for (const k of Object.keys(o)) {
              if (/token|jwt|access|refresh|secret|auth/i.test(k) && typeof o[k] === "string")
                r[k] = `<string len ${o[k].length}>`;
              else r[k] = seen(o[k], d + 1);
            }
            return r;
          }
          if (typeof o === "string" && o.length > 60) return `<string len ${o.length}>`;
          return o;
        };
        console.log("-- response JSON shape --");
        console.log(JSON.stringify(seen(j, 0), null, 2).slice(0, 2500));
      } catch {
        console.log("-- response body (first 800) --");
        console.log(redact(body).slice(0, 800));
      }
    } else {
      console.log("-- response body (first 400, " + ct + ") --");
      console.log(redact(body).slice(0, 400));
    }
  }
}
