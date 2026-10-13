import type { RiskLevel } from "./types";

export interface RiskInput {
  label?: string;
  url?: string;
  typed?: boolean;
  coordinateBlind?: boolean;
  oldUrl?: string;
  newUrl?: string;
}

const FINANCIAL_RE = /(place\s*order|buy\s*now|complete\s*purchase|confirm\s*(purchase|payment|order)|pay\s*(now|$)|checkout\s*(and|with|\$|€|£)|subscribe|donate|transfer\s*(money|funds)|\bcheckout\b.*(pay|card|order))/i;
const DESTRUCTIVE_RE = /(\bdelete\b|\berase\b|\bdestroy\b|\bdeactivate\b|\bterminate\b|\bwipe\b|close\s*(my|your|the)?\s*account|cancel\s*(subscription|membership|account|plan)|remove\s*(my|your|the)?\s*account)/i;
const ACCOUNT_RE = /(change|reset|update)\s*(your|my|the)?\s*(password|email|phone|2fa|two-?factor)|sign\s*out\s*(of\s*)?(all|everywhere|other)|revoke\s*(access|session|token|key)|enable\s*(2fa|two-?factor)|disable\s*(2fa|two-?factor)|add\s*(payment|card|bank)|remove\s*(payment|card|bank)/i;
const EXTERNAL_RE = /\b(send|submit|post|publish|share|invite|reply|comment|tweet|sign\s*up|register|book|reserve|apply\s*(now|to|for)|confirm|upload)\b/i;
const CREDENTIAL_RE = /(password|passcode|otp|one-?time|2fa|two-?factor|authenticator|recovery\s*code|ssn|social\s*security|cvv|cvc|card\s*number|secret\s*key|api\s*key|private\s*key|seed\s*phrase)/i;
const FINANCIAL_URL_RE = /\/(checkout|payment|billing|order|subscribe|donate|pay)(\/|$|\?|#)/i;
const ACCOUNT_URL_RE = /\/(delete|remove|deactivate|unsubscribe|close)[-_ ]?(account)?(\/|$|\?|#)|[?&](delete|unsubscribe|deactivate)=/i;

export function classifyRisk(input: RiskInput): { risk: RiskLevel; purpose: string } {
  const label = String(input.label ?? "").slice(0, 200);
  let risk: RiskLevel = "interact";
  if (CREDENTIAL_RE.test(label) && input.typed) risk = "credential";
  else if (FINANCIAL_RE.test(label)) risk = "financial";
  else if (DESTRUCTIVE_RE.test(label)) risk = "destructive";
  else if (ACCOUNT_RE.test(label)) risk = "account";
  else if (EXTERNAL_RE.test(label)) risk = "external";
  const url = input.newUrl || input.url || input.oldUrl || "";
  if (risk === "interact" && input.coordinateBlind && FINANCIAL_URL_RE.test(url)) risk = "financial";
  if (risk === "interact" && ACCOUNT_URL_RE.test(url)) risk = "account";
  const typedText = input.typed ? " (typed input)" : "";
  const purpose = `${label || "browser action"}${typedText}`.slice(0, 220);
  return { risk, purpose };
}

export function decidePermission(risk: RiskLevel, interactive: boolean): "allow" | "ask" | "deny" {
  if (risk === "read" || risk === "interact") return "allow";
  return interactive ? "ask" : "deny";
}
