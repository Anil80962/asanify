// Replay the status call over real HTTP/2, mimicking the browser closely,
// to rule out protocol/WAF-based 401 vs token expiry.
const fs = require("fs");
const path = require("path");
const http2 = require("http2");

const sec = JSON.parse(fs.readFileSync(path.join(__dirname, "captured", "asanify-secrets.json"), "utf8"));
const tok = sec.ASANIFY_REFRESH_TOKEN;
const empcode = sec.ASANIFY_EMPCODE;

const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
const payload = JSON.stringify({
  asan_empcode: empcode,
  clock_date: `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`,
  clock_time: `${d.getHours()}:${d.getMinutes()}:${d.getSeconds()}`,
});

const client = http2.connect("https://api.asanify.com");
client.on("error", (e) => { console.error("h2 connect error:", e.message); process.exit(1); });

const req = client.request({
  ":method": "POST",
  ":path": "/api/attendance/status",
  ":scheme": "https",
  ":authority": "api.asanify.com",
  accept: "application/json, text/plain, */*",
  "accept-encoding": "gzip, deflate, br, zstd",
  "accept-language": "en-US,en;q=0.9",
  "content-type": "application/json",
  origin: "https://secure.asanify.com",
  priority: "u=1, i",
  referer: "https://secure.asanify.com/",
  "refresh-token": tok,
  "sec-ch-ua": '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-site",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
  "content-length": Buffer.byteLength(payload),
});

let status, body = "";
req.on("response", (h) => { status = h[":status"]; });
req.setEncoding("utf8");
req.on("data", (c) => (body += c));
req.on("end", () => {
  console.log("HTTP/2 status:", status);
  console.log("body:", body.slice(0, 300));
  client.close();
});
req.write(payload);
req.end();
