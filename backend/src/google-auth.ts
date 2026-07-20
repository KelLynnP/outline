// One-time helper: mints a Google OAuth refresh token for the calendar
// adapter. Run with: npm run auth:google --workspace backend
// Requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env (Desktop app
// OAuth client). Opens a browser consent page, catches the redirect on
// localhost, and prints the refresh token to paste into .env.
import "./env.js";
import http from "node:http";
import { exec } from "node:child_process";

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env first.");
  process.exit(1);
}

const PORT = 43117;
const redirectUri = `http://localhost:${PORT}`;
const SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

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
  res.end("done — you can close this tab and return to the terminal.");
  console.log("\nAdd this to your .env:\n");
  console.log(`GOOGLE_REFRESH_TOKEN=${json.refresh_token}\n`);
  server.close();
  process.exit(0);
});

server.listen(PORT, () => {
  console.log("Opening Google consent page (or open this URL yourself):\n");
  console.log(authUrl.toString() + "\n");
  exec(`open "${authUrl}"`);
});
