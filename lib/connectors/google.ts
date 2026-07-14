import { google } from "googleapis";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/drive.file",
];

const CALLBACK_PATH = "/api/connectors/google/callback";

let _credentials: { clientId: string; clientSecret: string } | null = null;

function getCredentials() {
  if (_credentials) return _credentials;
  let clientId = process.env.GOOGLE_CLIENT_ID;
  let clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    try {
      const configPath = join(process.cwd(), "env.json");
      if (existsSync(configPath)) {
        const config = JSON.parse(readFileSync(configPath, "utf-8"));
        clientId = clientId || config.GOOGLE_CLIENT_ID;
        clientSecret = clientSecret || config.GOOGLE_CLIENT_SECRET;
      }
    } catch {}
  }
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set");
  }
  _credentials = { clientId, clientSecret };
  return _credentials;
}

function getDataDir(): string {
  return process.env.QUBE_DATA_DIR || join(process.cwd(), ".qube-data");
}

function tokensPath(): string {
  return join(getDataDir(), "google-tokens.json");
}

export function getStoredTokens(): Record<string, any> | null {
  try {
    const path = tokensPath();
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function storeTokens(tokens: Record<string, any>) {
  const dir = dirname(tokensPath());
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(tokensPath(), JSON.stringify(tokens, null, 2));
}

export function isConnected(): boolean {
  return getStoredTokens() !== null;
}

export function getAuthUrl(callbackUrl: string): string {
  const { clientId } = getCredentials();
  const oauth2Client = new google.auth.OAuth2(clientId, "", callbackUrl);
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });
}

export function getCallbackPath(): string {
  return CALLBACK_PATH;
}

export async function handleCallback(code: string, callbackUrl: string): Promise<void> {
  const { clientId, clientSecret } = getCredentials();
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, callbackUrl);
  const { tokens } = await oauth2Client.getToken(code);
  storeTokens(tokens);
}

export async function disconnect(): Promise<void> {
  const path = tokensPath();
  if (existsSync(path)) {
    try {
      const tokens = JSON.parse(readFileSync(path, "utf-8"));
      if (tokens.access_token) {
        const { clientId, clientSecret } = getCredentials();
        const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
        oauth2Client.setCredentials(tokens);
        await oauth2Client.revokeCredentials().catch(() => {});
      }
    } catch {}
    try {
      const { unlinkSync } = await import("node:fs");
      unlinkSync(path);
    } catch {}
  }
}

export async function getAuthenticatedClient() {
  const { clientId, clientSecret } = getCredentials();
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  const tokens = getStoredTokens();
  if (!tokens) throw new Error("Google not connected");
  oauth2Client.setCredentials(tokens);
  oauth2Client.on("tokens", (newTokens) => {
    const merged = { ...tokens, ...newTokens };
    storeTokens(merged);
  });
  return oauth2Client;
}
