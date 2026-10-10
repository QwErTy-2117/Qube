/**
 * Static brand glyphs — OFFLINE/ERROR FALLBACK ONLY.
 *
 * Primary artwork for every connector is the live Composio logo CDN
 * (`lib/connectors/composio-logo.ts` → `ConnectorBrandIcon`), which always
 * serves the vendor's current full-color mark (Gmail envelope, Calendar,
 * Drive triangle, …). These monochrome glyphs render only when the Composio
 * artwork can't load (offline / CDN error), so they are never the visible
 * icon in normal use.
 */
import {
  SiLinear,
  SiJirasoftware,
  SiTrello,
  SiAirtable,
  SiNotion,
  SiGithub,
  SiHubspot,
  SiAsana,
  SiDropbox,
  SiGooglecalendar,
  SiGoogledrive,
} from "react-icons/si";

/** Official Gmail (2020) mark — multicolor envelope, same as the home-page strip. */
function GmailIcon({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="52 42 88 66"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path fill="#4285f4" d="M58 108h14V74L52 59v43c0 3.32 2.69 6 6 6" />
      <path fill="#34a853" d="M120 108h14c3.32 0 6-2.69 6-6V59l-20 15" />
      <path fill="#fbbc04" d="M120 48v26l20-15v-8c0-7.42-8.47-11.65-14.4-7.2" />
      <path fill="#ea4335" d="M72 74V48l24 18 24-18v26L96 92" />
      <path fill="#c5221f" d="M52 51v8l20 15V48l-5.6-4.2c-5.94-4.45-14.4-.22-14.4 7.2" />
    </svg>
  );
}

function GoogleWorkspaceIcon({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}

function SlackIcon({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M5.042 15.166a2.52 2.52 0 01-2.52 2.52A2.521 2.521 0 010 15.166a2.521 2.521 0 012.521-2.521h2.521v2.521z"
        fill="#E01E5A"
      />
      <path
        d="M6.312 15.166a2.521 2.521 0 012.521-2.521 2.521 2.521 0 012.521 2.521v6.313a2.521 2.521 0 01-2.521 2.521 2.521 2.521 0 01-2.521-2.521v-6.313z"
        fill="#E01E5A"
      />
      <path
        d="M8.833 5.042a2.521 2.521 0 01-2.52-2.52A2.521 2.521 0 018.834 0a2.521 2.521 0 012.521 2.521v2.521H8.833z"
        fill="#36C5F0"
      />
      <path
        d="M8.833 6.312a2.521 2.521 0 012.521 2.521 2.521 2.521 0 01-2.521 2.521H2.52A2.521 2.521 0 010 8.833a2.521 2.521 0 012.521-2.521h6.312z"
        fill="#36C5F0"
      />
      <path
        d="M18.958 8.834a2.521 2.521 0 012.521-2.521 2.521 2.521 0 012.521 2.521 2.521 2.521 0 01-2.521 2.521h-2.521V8.834z"
        fill="#2EB67D"
      />
      <path
        d="M17.688 8.834a2.521 2.521 0 01-2.521 2.521 2.521 2.521 0 01-2.521-2.521V2.52A2.521 2.521 0 0115.167 0a2.521 2.521 0 012.521 2.521v6.313z"
        fill="#2EB67D"
      />
      <path
        d="M15.167 18.958a2.521 2.521 0 012.521 2.521 2.521 2.521 0 01-2.521 2.521 2.521 2.521 0 01-2.521-2.521v-2.521h2.521z"
        fill="#ECB22E"
      />
      <path
        d="M15.167 17.688a2.521 2.521 0 01-2.521-2.521 2.521 2.521 0 012.521-2.521h6.313a2.521 2.521 0 012.521 2.521 2.521 2.521 0 01-2.521 2.521h-6.313z"
        fill="#ECB22E"
      />
    </svg>
  );
}

function CanvaIcon({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10c1.19 0 2.34-.21 3.41-.6-.47-.9-.74-1.92-.74-3 0-3.31 2.69-6 6-6 .35 0 .69.03 1.02.09C21.05 7.05 17.05 2 12 2z"
        fill="#00C4CC"
      />
      <path
        d="M17.67 12c0 2.35-1.3 4.4-3.22 5.47-.55.3-1.17.53-1.85.53-2.21 0-4-1.79-4-4s1.79-4 4-4c.68 0 1.3.23 1.85.53 1.92 1.07 3.22 3.12 3.22 5.47z"
        fill="#7D2AE8"
        opacity="0.9"
      />
    </svg>
  );
}

export const CONNECTOR_ICONS: Record<string, React.ComponentType<{ size?: number }>> = {
  linear: SiLinear,
  atlassian: SiJirasoftware,
  trello: SiTrello,
  airtable: SiAirtable,
  notion: SiNotion,
  slack: SlackIcon,
  github: SiGithub,
  google: GoogleWorkspaceIcon,
  gmail: GmailIcon,
  googlecalendar: SiGooglecalendar,
  googledrive: SiGoogledrive,
  hubspot: SiHubspot,
  asana: SiAsana,
  dropbox: SiDropbox,
  canva: CanvaIcon,
};

export function renderConnectorIcon(id: string, size: number = 24) {
  const Icon = CONNECTOR_ICONS[id];
  if (!Icon) return null;
  return <Icon size={size} />;
}
