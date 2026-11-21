# Privacy Policy

**Last updated: November 20, 2026**

This Policy should be read together with the [Terms of Service](TERMS.md). Terms such as **Service, AI Agent, Browser Use, Model Provider, Connector, Workspace, and User Content** have the same meanings as in the Terms.

---

## 1. Who this Policy covers

Qube is a desktop AI agent application. It runs primarily on your device and keeps your workspace, settings, and memory on your machine. AI reasoning and some integrations are performed by third parties you choose — for example, the Model Provider you select and the external services you connect. When the Agent uses its managed browser, or Computer Use if you install it, it may also interact with information available on or through your computer, as described below.

This Policy explains what information Qube may handle locally, what it may send to those third parties when you ask it to, and what choices you have.

## 2. Summary

* **Your AI provider receives what you send — every time.** Each message, plus conversation history, file excerpts, tool outputs, attachments, memory entries, and profile context the Agent includes, is transmitted to the Model Provider you configured so it can reason and act. Connected services receive the inputs for the actions you request. This sharing is inherent to how Qube works; see Section 6 for the full list. Choose your Provider (or a local model) accordingly, and do not send data you are not comfortable sharing with them.
* **Local-first by design.** Your workspace files, session history, persistent memory, provider credentials, and settings are stored on your device. They are not sent to us unless you use a feature that requires it. (The ChatGPT proxy runs locally on your device and forwards requests to OpenAI, not to us.)
* **You choose what leaves your device.** Prompts, file excerpts, tool outputs, and other context are sent to the Model Provider you configured only to fulfill your request. Connector actions are sent to the integration partner and then to the external service you authorized. Page content and screenshots from the managed browser and, where you use Computer Use, observations of your desktop applications may be included as context for the model where necessary to perform the requested task.
* **Browser Use runs in a separate local browser.** When a task needs a website, the Agent browses in a Chromium-based browser on your device with its own Qube profile, visible in the Browser panel. See Section 5A.
* **Computer Use sees your desktop only when you ask, and acts only after permission checks.** When you install the open-codex-computer-use driver and ask for something outside the browser, the Agent may list running apps and read the target app's visible state (see Section 5B). Clicks, keystrokes, and changes go through Qube's permission checks (an automated review and, where needed, your approval — see Terms §7); observations needed to decide the next step may be sent to your Model Provider as described in Section 6.
* **No advertising tracker.** Qube does not embed advertising, analytics, or cross-site tracking scripts. It uses essential local browser storage and, if you use Login with ChatGPT, a session cookie to keep you signed in.
* **You are responsible for the Agent's actions.** Files it changes, messages it sends, and actions it takes in connected services are legally yours, not Qube's — even when you didn't foresee the exact steps. See Terms §6.
* **You control deletion.** You can delete sessions, tasks, workspace files, and local configuration at any time, and erase stored memory with Hard Reset or by deleting the local memory files (see Sections 6 and 9).

## 3. Information you provide directly

When you use Qube, you may provide:

* **Profile and preferences.** Display name, information about you, custom system instructions, model and temperature preferences, theme, and similar settings. These are stored in browser storage and mirrored to local application settings on disk.
* **Provider credentials.** API keys, base URLs or endpoint settings, and the derived list of available models for the Providers you configure. Stored locally on your device so Qube can call the Provider on your behalf.
* **ChatGPT sign-in, if you use it.** If you choose Login with ChatGPT, Qube creates a signed, HTTP-only session cookie and persists session state locally so requests can be proxied to the ChatGPT service under your account.
* **Workspace content.** Files you place in the Workspace or that the Agent creates for you — documents, presentations, spreadsheets, images, code — as well as the text of prompts, attachments, and instructions you send in the chat.
* **Connector authorizations.** When you link an external service, you authorize via OAuth. The integration partner (currently Composio) facilitates the connection and retains the tokens needed to perform actions; Qube stores connection status and a random identifier for your installation locally, which it uses to look up your connections at the integration partner. You can disconnect at any time.
* **Tasks, browser automation, and desktop settings.** Scheduled tasks and heartbeat configuration, including their instructions, schedules, and per-task permissions, as well as permission settings (such as whether destructive actions or automatic approval are enabled) and startup preferences.

You are responsible for what you choose to put in prompts, files, and connected services, and — when the Agent uses the managed browser or Computer Use — for what you make accessible through those. Avoid including or exposing sensitive or regulated data unless you have reviewed the relevant Provider and service policies (see Section 5). Do not provide access to or use Qube with information you are not authorized to process or disclose.

## 4. Information generated or collected as you use Qube

As you chat and let the Agent work, Qube generates and stores on your device:

* **Session history.** A record for each conversation, including an identifier, title, summary, timestamps, and, where stored, the transcript. Transcripts may be truncated if they become very large, with a notice where truncation occurs.
* **Persistent memory.** Facts the Agent extracts from conversations (for example, preferences, project context, or personal details you mentioned) that may be useful in future sessions. These entries include a category, content, and relevance or confidence indicators. Where relevant, entries are included as context in future prompts to provide continuity. See Section 4A for how extraction and recall work, their known limitations, and how to erase stored memory.
* **Task logs and operational context.** Records of scheduled or heartbeat task runs, file excerpts and directory listings the Agent has read (including, where you use external listing, the names and metadata of files outside the Workspace), command outputs, web search and fetch results, and observations the Agent obtained through the managed browser (page content and screenshots) or Computer Use (window information, accessibility data, and screenshots) to complete the task you requested. A log of the automated permission reviews (the action, the verdict, and the reason) is kept in `.memory/action-reviews.jsonl`, and large tool outputs may be saved temporarily under `.memory/tool-outputs/` (kept for up to 7 days by default). These values flow through the model context and into workspace files where applicable. They are not sent to us.
* **Diagnostics.** Operational messages written to the local server console and to `sidecar.log` in the application data directory (for example, that certain tools were loaded or a stream error occurred). These logs stay on your device unless you choose to share them for support, and Hard Reset deletes them.

Qube does not create a server-side profile of you and does not collect device advertising identifiers.

## 4A. Memory system — what is stored, known limitations, and how to control it

* **What the system does.** When long-term memory is on (the default), Qube watches recent user messages for durable facts using pattern matching (for example messages containing "remember", "don't forget", "my name is", "call me", "I prefer/like/love/hate", "my favorite", "I work at/on/as", or "my project/wife/husband/dog/cat/birthday/email/phone") and the Agent additionally saves facts proactively whenever it judges something durable — even when you never said "remember this". Each entry keeps a category (such as personal, preference, project, technology, decision, pattern, constraint, goal, or general), the fact text, heuristic relevance/confidence scores, derived entities and topic tags, and timestamps. Recall ranks entries by keyword, entity, and topic overlap with your current message plus recency and relevance weighting, and injects at most the top few entries (on the order of a few hundred tokens) into the prompt.
* **Known problems.** The system is approximate and will sometimes be wrong: it can store remarks you did not intend as lasting facts (including jokes, hypotheticals, or one-off statements that happened to match a pattern); it can miss facts you did want kept; it can retrieve irrelevant, stale, or contradictory entries because matching is word-overlap based rather than true understanding; contradiction handling only *lowers* the old entry's relevance score instead of deleting it, so superseded facts persist on disk and may resurface; relevance/confidence scores are rough estimates; and entries left out of a given prompt for space reasons are still stored. Review stored entries before relying on them, and never ask Qube to remember passwords, secrets, tokens, or regulated data — the Agent is instructed not to store secrets, but compliance with that instruction depends on the model and is not guaranteed.
* **Where memory data goes.** Stored entries live in a plain-text local file (`memory.json` under `.memory/` in the local data directory, with legacy `dual-memory.json` and `semantic-memory.json` files migrated on read); they are not sent to us. However, whenever a recalled entry is used, its text is transmitted to the Model Provider you configured as part of the prompt (Section 6.1), and when the Agent curates memory (extracting or reconciling entries), the relevant transcript and existing memories are likewise sent to that Provider. Past-chat titles and transcripts recalled through session tools follow the same path when the Agent includes them.
* **How to control it.** Long-term memory is on by default in the current build, and there is no separate on/off switch in Settings. To erase stored memories, use **Settings → Advanced → Hard Reset** (which deletes all local Qube data, including chats, settings, workspace files, logs, and memory), or quit Qube and delete the memory files under `.memory/` in the local data directory. Because Hard Reset is a full wipe, export any files you want to keep first. If a cloud Provider was used while those memories were active, address retention of any transmitted context with that Provider under its policy.

## 5. How Qube uses this information

Qube processes information locally to:

* provide the chat and agent experience and stream responses;
* read, write, and organize files and run commands in the Workspace, and — where you authorize external access — with absolute paths on your system;
* perform web searches and fetches, browse and interact with websites in the managed browser, and — where you install Computer Use — operate desktop applications, using an observe → decide → act → verify loop;
* generate documents and other artifacts;
* delegate parts of work to subagents and coordinate their results;
* remember context via session history and persistent memory and inject relevant context into future prompts;
* run scheduled and heartbeat tasks with the permissions you set;
* proxy requests to the Model Provider you chose and to services you connected;
* enforce Workspace scoping and permission checks (including the automated review of sensitive actions, which sends a short description of the action and your request to your configured Model Provider), and log task outcomes.

Qube does not sell your information and does not use it to train models. Where AI is used to help curate memory (for example, extracting or cleaning up memory entries), the transcript and existing memories are sent to the Model Provider you configured as part of that processing, as described in Section 6.

## 5A. Browser Use — what the Agent may access

When you ask for a task that needs a website, Qube launches a Chromium-based browser that is already installed on your device (Chrome, Chromium, or Edge) with its own separate Qube profile, controls it locally, and shows it live in the Browser panel. Browsing runs under your device's network identity, and page content may become model context as described in Section 6.

Depending on the task, this may include, for example:

* the pages the Agent visits and their text, interactive elements, and screenshots (password fields are masked in the page snapshots the Agent reads);
* information you or the Agent enter into websites, including forms the Agent submits on your behalf;
* cookies, sign-ins, and open tabs in the Qube browser profile, which persist between tasks until you clear them (for example with Hard Reset) — so the Agent can act on sites where you previously signed in through the Browser panel;
* input you provide yourself in the Browser panel, for example when you take over to complete a login or two-factor prompt.

The managed browser does not use your everyday browser profile and cannot see or control other desktop applications (that is Computer Use, Section 5B). Actions inside the managed browser are not subject to Qube's permission prompts (see Terms §7), so do not ask the Agent to work on sites containing information you are not authorized to have processed, and sign in through the Browser panel only to accounts you want the Agent to be able to use.

## 5B. Computer Use — what the Agent may access

When you install the open-codex-computer-use driver (`open-computer-use` / `ocu`) and ask the Agent to do something outside the browser, Qube runs that driver locally on your device to observe and — subject to Qube's permission checks — act on your desktop. Nothing here happens unless you both install the driver and request a computer task; subagents and background runs cannot click, type, or change anything (mutating actions refuse headless and return read-only findings instead).

Depending on the task and the permissions you grant the driver at the OS level, this may include, for example:

* the list of running and recently used applications (names, bundle identifiers, window titles);
* the target application's visible state: accessibility information (roles, names, values of on-screen controls) and screenshots where the harness includes them as model context to decide the next action;
* the results of approved actions (what was clicked, typed, or set) as returned by the driver.

System permissions required: Accessibility and Screen Recording on macOS; on Windows and Linux, follow what the driver's `ocu doctor` command reports. Set `COMPUTER_USE_DISABLED=1` to turn this path off entirely, and revoke the OS permissions if you no longer want the access path available. As with the managed browser, observations the harness includes as model context may be transmitted to the Model Provider you configured where necessary to interpret the screen and choose the next step (see Section 6.1), and are governed by that Provider's policy — close or avoid exposing sensitive windows, files, or sessions you do not want processed, and consider a local model when stricter controls are needed.

## 6. How AI providers and other third parties receive data

### 6.1 Model Providers

When you send a message, Qube forwards information to the Model Provider you selected so the model can reason and decide which tools to call. This may include:

* your prompt text and relevant conversation history;
* excerpts of Workspace files the Agent has read, tool outputs, web results, page content and screenshots from the managed browser, or — where Computer Use is used — window or accessibility information and screenshots that the Agent decides are needed to choose the next action;
* attachments and referenced file content;
* profile information and relevant memory entries and custom instructions where set;
* technical parameters such as model name, temperature, and reasoning settings.

Information obtained through the managed browser or Computer Use — to the extent it is included as context for the model — may be transmitted to and processed by the third-party AI/model provider you have configured where necessary to provide the AI functionality (for example, to interpret what is on screen and decide what to click or type next).

If you use **Login with ChatGPT**, requests are forwarded through the ChatGPT proxy, which runs locally on your device, to OpenAI using your signed session. If you use a **local model**, requests go to the endpoint you configured and may not leave your machine beyond that local process, depending on your network setup.

**Why this is necessary:** without it, the model could not understand your request or choose tools (including, where applicable, the next browser or Computer Use action).

**How providers may handle it:** each Provider applies its own terms and privacy policy to prompts and outputs, including any browser or Computer Use observations that were included as context. Some retain logs or use data to improve services; others offer zero-retention or enterprise controls. We do not control those practices and do not promise whether a Provider does or does not train on data — that depends on the Provider and your agreement with them. Review the Provider's policy before sending sensitive data or letting the Agent browse or use your desktop with sensitive content visible, and consider a local model or omitting/closing sensitive details when stricter controls are needed.

### 6.2 Connectors and integration partners

When you authorize a Connector, the integration partner (currently Composio) handles OAuth and, for each tool call, receives the inputs the Agent provided (for example, an email draft, query, or file reference) and authentication data needed for the action, then forwards the action to the external service and returns the result.

### 6.3 External websites and services reached via tools

* Web searches are sent to the search providers Qube uses (currently DuckDuckGo and Bing) to retrieve results; no account or API key is used.
* Web fetches fetch the URL you requested directly. Fetched page content may then be included in the model context.
* The managed browser interacts with sites under your device's network identity; content the Agent observes there may, as described in 6.1, be included as model context where needed.

### 6.4 Other helpers

Model discovery, driver installations, and similar helpers may contact their respective services (for example, to list models or fetch a component) but do not receive your prompts beyond what is needed for that specific request. In the current build these include: checking GitHub for application updates; looking up the current Codex client version on the npm registry when you use Login with ChatGPT; loading website icons for cited sources from DuckDuckGo's icon service (which receives the domain names of those sources) and app logos from Composio; and browsing skills marketplaces when you open them in Settings. Custom MCP servers you add run on your device and may contact services of their own.

We do not control third-party availability, security, or data handling. Using a Provider, Connector, or the managed browser means you accept that its terms will apply to that portion of the processing. This sharing is consistent with the disclosure in the Terms.

## 7. Where data is stored and how long it is kept

### 7.1 Where

* **On your device, in the local data directory.** In a source run this defaults to the application's working directory and can be overridden with the `QUBE_DATA_DIR` environment variable; the desktop app points it at the application data directory. It holds application settings, provider configuration, session records, memory entries, scheduled tasks, task logs, learned skills under `.agents/`, browser profiles, diagnostics such as `sidecar.log`, and ChatGPT session state where applicable. The Workspace folder — `workspace/` in a source run, or the local server's temporary working directory in the desktop app — holds files you or the Agent create, including chat attachments (saved under `attachments/` inside the Workspace).
* **In browser storage.** Preferences, provider configuration, and similar settings kept in local storage for the application origin.
* **Remotely, only where you asked.** At the Model Provider, integration partner, and any external service you connected or URL you asked to fetch (including any browser or Computer Use observations the harness included as model context), as described in Section 6.

### 7.2 How long

Data on your device is kept until you delete it:

* Session records and transcripts persist until you delete the session or remove the underlying files. Very large transcripts may be truncated automatically with a notice.
* Persistent memory entries persist until you delete or update them. Older entries may be omitted from context based on relevance over time but remain on disk until a cleanup or deletion removes them. Superseded entries are demoted (relevance reduced), not automatically deleted. There is no separate memory on/off switch in the current build; Hard Reset deletes the memory files along with all other local Qube data, and deleting those files manually while Qube is closed also removes them.
* Task logs and task definitions persist until you delete them.
* ChatGPT sessions expire according to the session time and are pruned, or removed when you sign out.
* Provider credentials and settings persist until you change or clear them.
* In the desktop app, the Workspace (including attachments) lives in a temporary copy of the application that is deleted and recreated when Qube is updated to a new version; your operating system may also clear temporary folders. Data in the local data directory is not affected.

Data sent to third parties is retained according to their policies, not ours. We do not make specific claims about retention periods for third-party providers.

## 8. Security and its limits

Qube is designed to keep sensitive material on your device:

* Workspace scoping (a default enforced by Qube's tools, not an operating-system sandbox), blocking of destructive actions unless you enable them, automated review and confirmation prompts for certain sensitive actions, per-task permission flags, and SSRF protection for web fetching are built in. Actions inside the managed browser and tools from custom MCP servers are not covered by these checks.

**Limitations you should understand:**

* Local stores — browser storage and files on disk, including workspace files — are kept in **plain text and are not encrypted at rest by Qube**. They are protected only by your operating system's access controls, full-disk encryption if you enable it, and physical control of the device. Anyone who can read your user account or an unencrypted backup can read them.
* API keys and OAuth tokens are bearer credentials. Treat provider configuration, ChatGPT session data, and related secrets as you would a password. Do not commit local data or environment files to version control, and avoid sharing them in screenshots or support bundles without redaction.
* Local model endpoints may be reachable from other processes on your machine or network depending on how you configure them.
* The managed browser and Computer Use expand the information the Agent can observe and interact with to the extent you have permitted; the same OS controls and physical-device protections apply. Close or restrict access to sensitive applications and files you do not want the Agent to be able to reach.

We take reasonable steps within a local-first desktop application, but we cannot guarantee that local files, prompts, or outputs — including any browser or Computer Use observations that were processed — will never be exposed if the device is compromised, shared, or backed up without encryption. We do not invent security controls beyond what the implementation provides.

## 9. Your rights and choices

Depending on your jurisdiction, you may have rights to access, correct, delete, restrict, object to, or export personal information, and to withdraw consent. In Qube you can exercise many of these directly:

* **Access and export.** View stored content through the session list, or by opening the local data and workspace folders. Copying those files is an export.
* **Correction.** Edit tasks or files in the application, or edit memory entries by editing the underlying data files while Qube is closed.
* **Deletion.** Delete individual sessions, tasks, or workspace files in the UI; clear provider credentials or disconnect ChatGPT and Connectors in Settings; use **Settings → Advanced → Hard Reset** to erase all local Qube data (including memory, workspace files and attachments, logs, learned skills, browser profiles, and browser storage); or remove the corresponding local files while Qube is closed. To limit Computer Use access, uninstall the driver or revoke its system permissions at the OS level. Hard Reset also clears the managed browser's profile (cookies and sign-ins).
* **Objection or restriction.** Leave optional profile fields blank, erase stored memory with Hard Reset or by deleting the local memory files, ask Qube to pause the heartbeat task, avoid browser or Computer Use tasks, use a local model to avoid sending prompts (and, where applicable, browser or Computer Use observations) to a cloud provider, or avoid connecting a Connector.
* **Withdraw consent.** Disconnect a Connector or sign out of ChatGPT at any time; stop using browser or Computer Use tasks, or change the default model or remove a Provider to stop future sends to that Provider.

Requests that concern data held by a Model Provider, integration partner, or connected service (for example, deletion from an email or project service) must be made directly to that party under its policy.

## 10. Account and data deletion

Qube does not maintain a Qube-hosted account. To remove data:

1. Use **Settings → Advanced → Hard Reset** to erase Qube's local data, workspace files and attachments, logs, learned skills, browser profiles, and browser storage, then restart with fresh defaults. Hard Reset does not disconnect Connectors at the integration partner — disconnect them in **Settings → Connectors** first (see step 4). Alternatively, delete sessions, tasks, and workspace files individually, and disconnect any Connectors and ChatGPT sessions. If you installed Computer Use, revoke its system permissions if you no longer want that access path available.
2. If you prefer to remove files manually, quit Qube and delete the local data folder (including `.memory/`, `.agents/`, browser profiles, logs, and any `agent.sqlite` files) and the workspace. If you configured a custom data directory, remove that path instead. If `WORKSPACE_PATH` points outside the data directory, remove that workspace separately.
3. Clear browser storage for the Qube origin or clear site data for the local origin if you did not use Hard Reset.
4. At the external services, revoke access for Qube or the integration partner.
5. Uninstall the desktop application.

If you need to keep some data, delete selectively rather than removing everything.

## 11. Cookies and similar technologies

* **Browser storage.** Qube stores preferences, provider configuration, and onboarding state in browser local storage. This storage is essential for the application to function; clearing it will reset preferences and require reconfiguration.
* **Session cookie for Login with ChatGPT.** When you sign in with ChatGPT, the server sets a signed, HTTP-only session cookie tied to the Login with ChatGPT secret to maintain your session. It is sent only to the ChatGPT proxy endpoints on the same origin and expires according to the handler's time limit. No advertising or cross-site tracking cookies are set by Qube itself.
* **No advertising tracker.** Qube does not load advertising or cross-site tracking scripts.

Sites the Agent visits in the managed browser may set their own cookies under their policies; these are stored in the Qube browser profile on your device until you clear them (for example with Hard Reset).

## 12. Children's privacy

Qube is not directed to children and is not intended for use by individuals who cannot form a legally binding contract. We do not knowingly collect personal information from children through Qube. If you believe a child has provided personal information via a Qube installation you control, delete the relevant sessions and files, erase stored memory with Hard Reset or by deleting the local memory files, and, if you used a cloud Provider, Connector, or browser session that may have included that information as context, address retention with that third party. We do not have a separate mechanism to verify age because there are no Qube-hosted accounts.

## 13. International transfers

Qube runs on your device, but when you choose a cloud Model Provider, integration partner, or connected service, prompts, file excerpts, tool outputs, and other context — including any browser or Computer Use observations included as model context — are transmitted over the internet to servers those parties operate, which may be located in a different country than you. Browser and web-fetch requests likewise go to the hosts you specify. Those parties' handling of the transfer is governed by their terms and policies. If you need data to stay in a particular region, choose a Provider and configuration that offers regional controls or run inference locally.

## 14. Changes to this Policy

We may update this Policy as Qube evolves. When we do, we will update the "Last updated" date and, for material changes, show a notice in the application or publish the update with the release. Continued use after the effective date constitutes acceptance. We recommend reviewing this Policy after updates, especially when new Providers, Connectors, browser or Computer Use capabilities, or memory behaviors are added.

## 15. Contact

Privacy questions, requests, or concerns about Qube may be directed to the maintainers through the project's repository or the contact channel listed on the distribution page. If you deploy Qube for an organization, replace this with your legal entity name and privacy contact address. Requests concerning data held by a Model Provider, integration partner, or connected service must be directed to that party.

---

### Relationship to the Terms

The [Terms of Service](TERMS.md) describe your responsibility for the Agent's actions — including browser automation and Computer Use — the nature of AI outputs, and limits on warranties and liability. This Policy complements those Terms by describing data handling, including the privacy implications of browser automation and Computer Use. In particular, the Terms' description of third-party sharing and categories of data that may be sent to Providers is reflected and expanded here in Sections 5A–6.

### Scope note

We have written this Policy to track what the code actually does: local-first storage, browser storage for preferences, file-backed sessions and memory, the ChatGPT proxy where enabled, Connector-based integrations, a managed local browser, and — where you install it — Computer Use with its permission-gated, environment-dependent access. Claims are limited to what the implementation supports at the time of drafting and are described at a general level where behavior depends on runtime configuration or permissions. Specific Provider features are described in general terms so the Policy remains accurate as offerings change; the integration partner and search providers in use at the time of writing are named. Data-protection addenda, AI transparency, and jurisdiction-specific disclosures are intentionally left for counsel to validate rather than asserted as compliant.
