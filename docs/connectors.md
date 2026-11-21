# Connected apps (connectors)

Connectors let Qube work directly inside the apps you already use — reading
an inbox, creating a calendar event, posting to Slack, filing a GitHub issue —
using that app's normal sign-in. There are no bot tokens to create by hand.

## Which apps are supported

Connectors are provided through [Composio](https://composio.dev/), an
integration service that handles each app's sign-in and API. Qube has a
curated set of twelve connectors, and these are the apps whose tools the
agent can use:

- **Google** (one connection): Gmail, Google Calendar, Google Drive
- **Team chat:** Slack
- **Development:** GitHub
- **Notes and docs:** Notion
- **Project management:** Linear, Jira, Trello, Asana
- **Data and CRM:** Airtable, HubSpot
- **Files and design:** Dropbox, Canva

**Settings → Connectors** has a search box and may also list other apps that
are configured in the Composio project behind the API key, but the agent only
loads tools for the curated apps above.

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
works with the resulting connection and never asks you to paste a password
into the chat.

Connections are filed at Composio under a random ID created for your Qube
install (stored locally in `.memory/composio-user-id`), so other installs
using the same built-in key do not see your accounts.

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

You can disconnect an app at any time in the same settings screen;
disconnecting deletes the connected account at Composio.

**Hard Reset does not disconnect your apps at Composio** — it only forgets the
local ID. To revoke access, disconnect the apps first, or remove Qube/Composio
access from the app's own account settings (for example your Google account's
third-party access page).

## What happens without asking vs. with approval

Qube follows a read-first rule:

- **Read-only actions** — searching mail, listing events, reading a page,
  fetching a ticket — run without interrupting you.
- **Sensitive actions** — sending, posting, creating, updating, deleting,
  sharing, booking, purchasing — first go through Qube's **invisible
  self-review**: a separate, short model call checks that the action matches
  what you asked for. If it clearly does, it runs; if the review is unsure,
  an **approval card** says exactly what will happen and where, and nothing
  happens until you approve. Email *drafts* are reversible and skip the
  review; sending or deleting a draft does not.
- **Destructive actions** — deleting items, merging pull requests, closing
  issues — are blocked entirely unless you turn on **Destructive actions** in
  **Settings → Advanced → Heartbeat and Task → Configure**.
- If you switch on **Auto-approve actions** in the same dialog, allowed
  sensitive actions run without the review.
- If you deny an action, Qube is instructed to say so in one sentence and
  continue with a draft or an in-workspace alternative rather than retrying.

This mirrors the local file rules — see
[Permissions and privacy](./permissions-privacy.md).

## Connectors in background work

- The periodic **check-in** (heartbeat) is never allowed to send, post, or
  delete on your behalf: its sensitive connector tools are replaced with
  draft-only versions. It can read, prepare drafts and workspace files, and
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
