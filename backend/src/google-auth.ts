// One-time helper: mints a Google OAuth refresh token for the calendar
// adapter. Run with: npm run auth:google --workspace backend
// Requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env (Desktop app
// OAuth client). Opens a browser consent page, catches the redirect on
// localhost, and prints the refresh token to paste into .env.
import "./env.js";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
import { REPO_ROOT } from "./paths.js";

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env first.");
  process.exit(1);
}

const PORT = 43117;
const redirectUri = `http://localhost:${PORT}`;
const SCOPE = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events.owned",
].join(" ");

function setEnvValue(contents: string, key: string, value: string): string {
  const line = new RegExp(`^${key}=.*$`, "m");
  if (line.test(contents)) return contents.replace(line, `${key}=${value}`);
  return `${contents}${contents.endsWith("\n") || !contents ? "" : "\n"}${key}=${value}\n`;
}

const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authUrl.searchParams.set("client_id", clientId);
authUrl.searchParams.set("redirect_uri", redirectUri);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("scope", SCOPE);
authUrl.searchParams.set("access_type", "offline");
authUrl.searchParams.set("prompt", "consent"); // force refresh_token issuance

const server = http.createServer(async (req, res) => {
  const code = new URL(req.url ?? "/", redirectUri).searchParams.get("code");
  if (!code) {
    res.writeHead(400).end("no code in redirect");
    return;
  }
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const json = (await tokenRes.json()) as { refresh_token?: string; error?: string };
  if (!json.refresh_token) {
    res.writeHead(500).end(`token exchange failed: ${JSON.stringify(json)}`);
    console.error("token exchange failed:", json);
    process.exit(1);
  }
  const envPath = path.join(REPO_ROOT, ".env");
  const current = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  let next = setEnvValue(current, "GOOGLE_REFRESH_TOKEN", json.refresh_token);
  if (process.env.GOOGLE_EXPORT_CALENDAR_ID) {
    next = setEnvValue(
      next,
      "GOOGLE_EXPORT_CALENDAR_ID",
      process.env.GOOGLE_EXPORT_CALENDAR_ID,
    );
  }
  fs.writeFileSync(envPath, next);
  res.end("done — the refresh token was updated in .env. You can close this tab.");
  console.log("\nUpdated GOOGLE_REFRESH_TOKEN in .env.\n");
  server.close();
  process.exit(0);
});

server.listen(PORT, () => {
  console.log("Opening Google consent page (or open this URL yourself):\n");
  console.log(authUrl.toString() + "\n");
  exec(`open "${authUrl}"`);
});
