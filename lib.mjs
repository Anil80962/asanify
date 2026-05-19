// Shared helpers: browser launch (stealth-ish) + fresh-token interception.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const ASANIFY_APP = "https://secure.asanify.com/";
export const ASANIFY_API = "https://api.asanify.com";

// Args that reduce the most obvious "is automated" signals. Not bulletproof
// against Google's bot heuristics, but removes navigator.webdriver etc.
const STEALTH_ARGS = [
  "--disable-blink-features=AutomationControlled",
  "--no-sandbox",
  "--disable-dev-shm-usage",
];

export function contextOptions() {
  return {
    viewport: { width: 1366, height: 768 },
    locale: "en-US",
    timezoneId: "Asia/Kolkata",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
  };
}

export function launchOpts({ headless }) {
  return { headless, args: STEALTH_ARGS };
}

// Resolve a Playwright storageState path. In CI the state arrives as a base64
// env var (ASANIFY_STATE_B64); locally it's a file (default auth/storageState.json).
export function resolveStatePath() {
  const b64 = process.env.ASANIFY_STATE_B64;
  if (b64) {
    const tmp = path.join(os.tmpdir(), "asanify-state.json");
    fs.writeFileSync(tmp, Buffer.from(b64, "base64").toString("utf8"));
    return tmp;
  }
  const p = process.env.AUTH_STATE_PATH || path.join(process.cwd(), "auth", "storageState.json");
  if (!fs.existsSync(p)) {
    throw new Error(
      `No saved session. Expected ${p} or ASANIFY_STATE_B64. Run \`npm run capture\` first.`
    );
  }
  return p;
}

// Attaches a listener that resolves with the first fresh auth headers
// the Asanify SPA sends to its API after login. Returns { token, authorization }.
// The attendance API requires BOTH refresh-token AND Authorization: Bearer <access_token>.
export function waitForFreshToken(context, timeoutMs = 90_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for Asanify API auth (${timeoutMs}ms)`)),
      timeoutMs
    );
    context.on("request", (req) => {
      try {
        if (!req.url().startsWith(ASANIFY_API)) return;
        const h = req.headers();
        const tok = h["refresh-token"];
        if (tok && tok.length > 100) {
          clearTimeout(timer);
          resolve({ token: tok, authorization: h["authorization"] || "" });
        }
      } catch {
        /* ignore */
      }
    });
  });
}

// Best-effort: the SPA posts `asan_empcode` in attendance calls on load.
// Resolves the code, or null on timeout (capture still succeeds without it).
export function waitForEmpcode(context, timeoutMs = 120_000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    context.on("request", (req) => {
      try {
        if (!req.url().startsWith(ASANIFY_API)) return;
        const pd = req.postData();
        if (!pd) return;
        const j = JSON.parse(pd);
        if (j && j.asan_empcode) {
          clearTimeout(timer);
          resolve(String(j.asan_empcode));
        }
      } catch {
        /* not the request we want */
      }
    });
  });
}

export function getEmpcode() {
  if (process.env.ASANIFY_EMPCODE) return process.env.ASANIFY_EMPCODE;
  const f = path.join(process.cwd(), "captured", "asanify-secrets.json");
  if (fs.existsSync(f)) {
    const j = JSON.parse(fs.readFileSync(f, "utf8"));
    if (j.ASANIFY_EMPCODE) return j.ASANIFY_EMPCODE;
  }
  throw new Error("ASANIFY_EMPCODE not set (env) and not found in captured/asanify-secrets.json");
}

// Performs the clock-in/status call using Playwright's context.request, which
// uses the browser context's cookies and bypasses CORS — identical fidelity to
// what the SPA sends, without the in-page fetch CORS block.
export async function callAttendance(page, { token, authorization, empcode, dryRun }) {
  const headers = {
    accept: "application/json, text/plain, */*",
    "content-type": "application/json",
    "refresh-token": token,
    origin: "https://secure.asanify.com",
    referer: "https://secure.asanify.com/",
  };
  if (authorization) headers["authorization"] = authorization;
  if (dryRun) {
    const d = new Date();
    const body = {
      asan_empcode: empcode,
      clock_date: `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`,
      clock_time: `${d.getHours()}:${d.getMinutes()}:${d.getSeconds()}`,
    };
    const r = await page.context().request.post(
      ASANIFY_API + "/api/attendance/status",
      { headers, data: body }
    );
    return { status: r.status(), text: await r.text(), kind: "status" };
  }
  const body = {
    asan_empcode: empcode,
    clock_type: "IN",
    clock_time: "",
    latitude: null,
    longitude: null,
    source: "WEB",
  };
  const r = await page.context().request.post(
    ASANIFY_API + "/api/attendance/clock",
    { headers, data: body }
  );
  return { status: r.status(), text: await r.text(), kind: "clock" };
}
