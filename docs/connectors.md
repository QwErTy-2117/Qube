# Connected apps (connectors)

Connectors let Qube work directly inside the apps you already use — reading
an inbox, creating a calendar event, posting to Slack, filing a GitHub issue —
using that app's normal sign-in. There are no bot tokens to create by hand.

## Which apps are supported

The connector catalog is provided by [Composio](https://composio.dev/) and
fetched live, so the full list grows over time and is searchable inside
**Settings → Connectors**. The curated apps surfaced directly in Qube are:

- **Google:** Gmail, Google Calendar, Google Drive
- **Team chat:** Slack
- **Development:** GitHub
- **Notes and docs:** Notion, Confluence
- **Project management:** Linear, Jira, Trello, Asana
- **Data and CRM:** Airtable, HubSpot
- **Files and design:** Dropbox, Canva

Anything else Composio supports is reachable through the catalog search in
the same screen.

## Connecting an app

1. Open **Settings → Connectors** (or the connectors step in onboarding).
2. Pick an app and choose connect. Your system browser opens the provider's
   normal OAuth sign-in page — log in and approve access there.
3. The browser hands you back to Qube automatically (the desktop app
   registers a `qube://` deep link), and Qube checks whether the connection
   succeeded. The browser shows only a return screen, not the Qube interface.
   If your browser blocks the hand-off, choose **Return to Qube** or switch
   back to the app manually. Some browsers ask permission to open the app.

The provider's sign-in and consent pages still open in your system browser;
this is required by many OAuth providers. Browser tabs opened by the system
cannot always be closed automatically, so you may need to close the return
screen yourself. In a web-only session, the return screen instead directs you
back to your existing Qube tab.

Sign in once per app. Credentials stay with the provider and Composio; Qube
works with the resulting session and never asks you to paste a password into
the chat.

### The API key behind the connectors

Talking to Composio requires an API key.

- **Released desktop builds include a built-in key**, so connecting apps
  works out of the box with nothing to configure.
- **When running from source**, provide your own key from the
  [Composio dashboard](https://dashboard.composio.dev/settings) as
  `COMPOSIO_API_KEY` in your environment (or `.env.local`).
- In **Settings → Advanced → Composio API Key** you can switch between the
  built-in key and your own — a private key is useful for higher limits or a
  dedicated Composio project.

You can disconnect an app at any time in the same settings screen.

## What happens without asking vs. with approval

Qube follows a read-first rule:

- **Read-only actions** — searching mail, listing events, reading a page,
  fetching a ticket — run without interrupting you.
- **Sensitive actions** — sending, posting, creating, updating, deleting,
  sharing, booking, purchasing — pause on an approval card that says exactly
  what will happen and where. Nothing is sent or changed until you approve.
  Email *drafts* are reversible and don't prompt; sending or deleting a draft
  does.
- If you deny an action, Qube says so in one sentence and continues with a
  draft or an in-workspace alternative; it never retries a denied call.

This mirrors the local file rules — see
[Permissions and privacy](./permissions-privacy.md).

## Connectors in background work

- The periodic **check-in** (heartbeat) is never allowed to send, post, or
  delete on your behalf. It can read, prepare drafts and workspace files, and
  present them for your next chat.
- A **scheduled task you created yourself** — for example “email me this
  report every morning” — carries your explicit instruction, so it may perform
  the sends or creates its instructions describe, within the permissions set
  on the task. See [Automations](./automations.md).

## Example requests

- “Go through my inbox and group everything into needs-a-reply, FYI, and
  ignore.”
- “Summarize the thread with Sara and draft a reply — don't send it.”
- “Create a two-hour focus block on my calendar tomorrow morning.”
- “File a GitHub issue in my repo summarizing this bug, then show me the
  draft.”
- “Pull new leads from Gmail into a spreadsheet with name, date and status.”

If a task names an app that isn't connected, Qube says so once, points you to
**Settings → Connectors**, and offers the closest file- or web-based
alternative instead of pretending it has access.
