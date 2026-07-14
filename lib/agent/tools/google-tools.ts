import { tool } from "ai";
import { z } from "zod";
import { getAuthenticatedClient } from "@/lib/connectors/google";
import { google } from "googleapis";

export const googleTools: Record<string, any> = {};

export async function createGoogleTools(): Promise<Record<string, any>> {
  googleTools.search_emails = tool({
    description: "Search Gmail inbox for emails matching a query",
    inputSchema: z.object({
      query: z.string().describe("Gmail search query (same as Gmail search bar)"),
      maxResults: z.number().optional().describe("Max results (default 10)"),
    }),
    execute: async ({ query, maxResults = 10 }) => {
      try {
        const auth = await getAuthenticatedClient();
        const gmail = google.gmail({ version: "v1", auth });
        const res = await gmail.users.messages.list({ userId: "me", q: query, maxResults });
        const messages = res.data.messages || [];
        const details = await Promise.all(
          messages.slice(0, maxResults).map(async (m: any) => {
            const msg = await gmail.users.messages.get({ userId: "me", id: m.id! });
            const headers = msg.data.payload?.headers || [];
            const subject = headers.find((h: any) => h.name === "Subject")?.value || "";
            const from = headers.find((h: any) => h.name === "From")?.value || "";
            const date = headers.find((h: any) => h.name === "Date")?.value || "";
            const snippet = msg.data.snippet || "";
            return { id: m.id, subject, from, date, snippet };
          }),
        );
        return JSON.stringify({ success: true, data: details });
      } catch (e: any) {
        return JSON.stringify({ success: false, error: e.message });
      }
    },
  });

  googleTools.send_email = tool({
    description: "Send an email via Gmail",
    inputSchema: z.object({
      to: z.string().describe("Recipient email address"),
      subject: z.string().describe("Email subject"),
      body: z.string().describe("Email body text"),
    }),
    execute: async ({ to, subject, body }) => {
      try {
        const auth = await getAuthenticatedClient();
        const gmail = google.gmail({ version: "v1", auth });
        const utf8Bytes = Buffer.from(
          `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`,
          "utf-8",
        );
        const raw = utf8Bytes.toString("base64url");
        await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
        return JSON.stringify({ success: true });
      } catch (e: any) {
        return JSON.stringify({ success: false, error: e.message });
      }
    },
  });

  googleTools.list_calendar_events = tool({
    description: "List upcoming Google Calendar events",
    inputSchema: z.object({
      maxResults: z.number().optional().describe("Max events (default 10)"),
      timeMin: z.string().optional().describe("Start time (ISO string, default now)"),
      timeMax: z.string().optional().describe("End time (ISO string)"),
    }),
    execute: async ({ maxResults = 10, timeMin, timeMax }) => {
      try {
        const auth = await getAuthenticatedClient();
        const calendar = google.calendar({ version: "v3", auth });
        const res = await calendar.events.list({
          calendarId: "primary",
          timeMin: timeMin || new Date().toISOString(),
          timeMax,
          maxResults,
          singleEvents: true,
          orderBy: "startTime",
        });
        const events = (res.data.items || []).map((e: any) => ({
          id: e.id,
          summary: e.summary,
          start: e.start?.dateTime || e.start?.date,
          end: e.end?.dateTime || e.end?.date,
          location: e.location,
        }));
        return JSON.stringify({ success: true, data: events });
      } catch (e: any) {
        return JSON.stringify({ success: false, error: e.message });
      }
    },
  });

  googleTools.create_calendar_event = tool({
    description: "Create a Google Calendar event",
    inputSchema: z.object({
      summary: z.string().describe("Event title"),
      start: z.string().describe("Start time (ISO string)"),
      end: z.string().describe("End time (ISO string)"),
      description: z.string().optional().describe("Event description"),
      location: z.string().optional().describe("Event location"),
    }),
    execute: async ({ summary, start, end, description, location }) => {
      try {
        const auth = await getAuthenticatedClient();
        const calendar = google.calendar({ version: "v3", auth });
        await calendar.events.insert({
          calendarId: "primary",
          requestBody: { summary, description, location, start: { dateTime: start }, end: { dateTime: end } },
        });
        return JSON.stringify({ success: true });
      } catch (e: any) {
        return JSON.stringify({ success: false, error: e.message });
      }
    },
  });

  googleTools.search_drive = tool({
    description: "Search Google Drive for files",
    inputSchema: z.object({
      query: z.string().describe("Drive search query"),
      pageSize: z.number().optional().describe("Max results (default 10)"),
    }),
    execute: async ({ query, pageSize = 10 }) => {
      try {
        const auth = await getAuthenticatedClient();
        const drive = google.drive({ version: "v3", auth });
        const res = await drive.files.list({
          q: query,
          pageSize,
          fields: "files(id, name, mimeType, modifiedTime, size)",
        });
        const files = (res.data.files || []).map((f: any) => ({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          modifiedTime: f.modifiedTime,
          size: f.size,
        }));
        return JSON.stringify({ success: true, data: files });
      } catch (e: any) {
        return JSON.stringify({ success: false, error: e.message });
      }
    },
  });

  return googleTools;
}
