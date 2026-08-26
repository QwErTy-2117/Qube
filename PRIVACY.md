# Privacy Policy 

**Last updated: August 26, 2026**

> **Important notice:** This Policy describes how Qube handles data based on its current implementation. It is not legal advice and does not guarantee compliance with any particular jurisdiction. Have it reviewed by a qualified attorney before publishing, especially for data-protection, AI-specific, and consumer requirements that apply to your deployment.

This Policy should be read together with the [Terms of Service](TERMS.md). Terms such as **Service, AI Agent, Model Provider, Connector, Workspace, and User Content** have the same meanings as in the Terms.

---

## 1. Who this Policy covers

Qube is a desktop AI agent application. It runs primarily on your device and keeps your workspace, settings, and memory on your machine. AI reasoning and some integrations are performed by third parties you choose — for example, the Model Provider you select and the external services you connect.

This Policy explains what information Qube may handle locally, what it may send to those third parties when you ask it to, and what choices you have.

## 2. Summary

* **Local-first by design.** Your workspace files, session history, persistent memory, provider credentials, and settings are stored on your device. They are not sent to us unless you use a feature that requires it (for example, forwarding a request through the ChatGPT proxy).
* **You choose what leaves your device.** Prompts, file excerpts, tool outputs, and other context are sent to the Model Provider you configured only to fulfill your request. Connector actions are sent to the integration partner and then to the external service you authorized.
* **No advertising tracker.** Qube does not embed advertising, analytics, or cross-site tracking scripts. It uses essential local browser storage and, if you use Login with ChatGPT, a session cookie to keep you signed in.
* **You control deletion.** You can delete sessions, memory entries, tasks, workspace files, and local configuration at any time (see Sections 6 and 9).

## 3. Information you provide directly

When you use Qube, you may provide:

* **Profile and preferences.** Display name, information about you, custom system instructions, model and temperature preferences, theme, and similar settings. These are stored in browser storage and mirrored to local application settings on disk.
* **Provider credentials.** API keys, base URLs or endpoint settings, and the derived list of available models for the Providers you configure. Stored locally on your device so Qube can call the Provider on your behalf.
* **ChatGPT sign-in, if you use it.** If you choose Login with ChatGPT, Qube creates a signed, HTTP-only session cookie and persists session state locally so requests can be proxied to the ChatGPT service under your account.
* **Workspace content.** Files you place in the Workspace or that the Agent creates for you — documents, presentations, spreadsheets, images, code — as well as the text of prompts, attachments, and instructions you send in the chat.
* **Connector authorizations.** When you link an external service, you authorize via OAuth. The integration partner facilitates the connection and retains the tokens needed to perform actions; Qube stores connection status locally. You can disconnect at any time.
* **Tasks and desktop settings.** Scheduled tasks and heartbeat configuration, including their instructions, schedules, and per-task permissions, as well as preferences such as the desktop-automation toggle where available.

You are responsible for what you choose to put in prompts, files, and connected services. Avoid including sensitive or regulated data unless you have reviewed the relevant Provider and service policies (see Section 5).

## 4. Information generated or collected as you use Qube

As you chat and let the Agent work, Qube generates and stores on your device:

* **Session history.** A record for each conversation, including an identifier, title, summary, timestamps, and, where stored, the transcript. Transcripts may be truncated if they become very large, with a notice where truncation occurs.
* **Persistent memory.** Facts the Agent extracts from conversations (for example, preferences, project context, or personal details you mentioned) that may be useful in future sessions. These entries include a category, content, and relevance or confidence indicators. Where relevant, entries are included as context in future prompts to provide continuity.
* **Task logs and operational context.** Records of scheduled or heartbeat task runs, file excerpts and directory listings the Agent has read, command outputs, web search and fetch results, and browser or desktop context used to complete the task you requested. These values flow through the model context and into workspace files where applicable. They are not sent to us.
* **Diagnostics.** Operational messages written to the local server console (for example, that certain tools were loaded or a stream error occurred). These logs stay on your device unless you choose to share them for support.

Qube does not create a server-side profile of you and does not collect device advertising identifiers.

## 5. How Qube uses this information

Qube processes information locally to:

* provide the chat and agent experience and stream responses;
* read, write, and organize files and run commands in the Workspace;
* perform web searches and fetches and automate browser or desktop steps when you enable those tools;
* generate documents and other artifacts;
* delegate parts of work to subagents and coordinate their results;
* remember context via session history and persistent memory and inject relevant context into future prompts;
* run scheduled and heartbeat tasks with the permissions you set;
* proxy requests to the Model Provider you chose and to services you connected;
* enforce sandboxing and permission checks and log task outcomes.

Qube does not sell your information and does not use it to train models. Where AI is used to help curate memory (for example, extracting or cleaning up memory entries), the transcript and existing memories are sent to the Model Provider you configured as part of that processing, as described in Section 6.

## 6. How AI providers and other third parties receive data

### 6.1 Model Providers

When you send a message, Qube forwards information to the Model Provider you selected so the model can reason and decide which tools to call. This may include:

* your prompt text and relevant conversation history;
* excerpts of Workspace files the Agent has read, tool outputs, web results, or browser/desktop context the Agent decides is needed;
* attachments and referenced file content;
* profile information and relevant memory entries and custom instructions where set;
* technical parameters such as model name, temperature, and reasoning settings.

If you use **Login with ChatGPT**, requests are forwarded through the ChatGPT proxy using your signed session. If you use a **local model**, requests go to the endpoint you configured and may not leave your machine beyond that local process, depending on your network setup.

**Why this is necessary:** without it, the model could not understand your request or choose tools.

**How providers may handle it:** each Provider applies its own terms and privacy policy to prompts and outputs. Some retain logs or use data to improve services; others offer zero-retention or enterprise controls. We do not control those practices. Review the Provider's policy before sending sensitive data, and consider a local model or omitting sensitive details when stricter controls are needed.

### 6.2 Connectors and integration partners

When you authorize a Connector, the integration partner handles OAuth and, for each tool call, receives the inputs the Agent provided (for example, an email draft, query, or file reference) and authentication data needed for the action, then forwards the action to the external service and returns the result.

### 6.3 External websites and services reached via tools

* Web searches are sent to the search provider to retrieve results.
* Web fetches and browser automation fetch the URL you requested directly. Fetched page content may then be included in the model context.
* Browser and desktop automation further interacts with sites and applications under your device's network identity.

### 6.4 Other helpers

Model discovery, driver installations, and similar helpers may contact their respective services (for example, to list models or fetch a component) but do not receive your prompts beyond what is needed for that specific request.

We do not control third-party availability, security, or data handling. Using a Provider or Connector means you accept that its terms will apply to that portion of the processing. This sharing is consistent with the disclosure in the Terms.

## 7. Where data is stored and how long it is kept

### 7.1 Where

* **On your device, in the local data directory.** By default this is the application's working directory, or the path set by your `QUBE_DATA_DIR` environment variable if you configure one. It holds application settings, provider configuration, session records, memory entries, scheduled tasks, task logs, and ChatGPT session state where applicable. The Workspace folder holds files you or the Agent create.
* **In browser storage.** Preferences, provider configuration, and similar settings kept in local storage for the application origin.
* **Remotely, only where you asked.** At the Model Provider, integration partner, and any external service you connected or URL you asked to fetch, as described in Section 6.

### 7.2 How long

Data on your device is kept until you delete it:

* Session records and transcripts persist until you delete the session or remove the underlying files. Very large transcripts may be truncated automatically with a notice.
* Persistent memory entries persist until you delete or update them. Older entries may be omitted from context based on relevance over time but remain on disk until a cleanup or deletion removes them.
* Task logs and task definitions persist until you delete them.
* ChatGPT sessions expire according to the session time and are pruned, or removed when you sign out.
* Provider credentials and settings persist until you change or clear them.

Data sent to third parties is retained according to their policies, not ours.

## 8. Security and its limits

Qube is designed to keep sensitive material on your device:

* Workspace sandboxing, checks for certain higher-risk commands, confirmation prompts for certain Connector actions, and per-task permission flags are built in.

**Limitations you should understand:**

* Local stores — browser storage and files on disk, including workspace files — are kept in **plain text and are not encrypted at rest by Qube**. They are protected only by your operating system's access controls, full-disk encryption if you enable it, and physical control of the device. Anyone who can read your user account or an unencrypted backup can read them.
* API keys and OAuth tokens are bearer credentials. Treat provider configuration, ChatGPT session data, and related secrets as you would a password. Do not commit local data or environment files to version control, and avoid sharing them in screenshots or support bundles without redaction.
* Local model endpoints may be reachable from other processes on your machine or network depending on how you configure them.

We take reasonable steps within a local-first desktop application, but we cannot guarantee that local files, prompts, or outputs will never be exposed if the device is compromised, shared, or backed up without encryption.

## 9. Your rights and choices

Depending on your jurisdiction, you may have rights to access, correct, delete, restrict, object to, or export personal information, and to withdraw consent. In Qube you can exercise many of these directly:

* **Access and export.** View stored content through the session list and memory views, or by opening the local data and workspace folders. Copying those files is an export.
* **Correction.** Edit memory entries, tasks, or files in the application or by editing the underlying data.
* **Deletion.** Delete individual sessions, memory entries, tasks, or workspace files in the UI; clear provider credentials or disconnect ChatGPT and Connectors in Settings; or remove the corresponding local data.
* **Objection or restriction.** Leave optional profile fields blank, disable long-term memory or the heartbeat task, use a local model to avoid sending prompts to a cloud provider, or avoid connecting a Connector.
* **Withdraw consent.** Disconnect a Connector or sign out of ChatGPT at any time; change the default model or remove a Provider to stop future sends to that Provider.

Requests that concern data held by a Model Provider, integration partner, or connected service (for example, deletion from an email or project service) must be made directly to that party under its policy.

## 10. Account and data deletion

Qube does not maintain a Qube-hosted account. To remove data:

1. In the application, delete sessions, memory entries, tasks, and workspace files you no longer want, and disconnect any Connectors and ChatGPT sessions.
2. Quit Qube and delete the local data you wish to remove (the local data folder and, if desired, workspace contents). If you configured a custom data directory, remove that path instead.
3. Clear browser storage for the Qube origin or clear site data for the local origin.
4. At the external services, revoke access for Qube or the integration partner.
5. Uninstall the desktop application.

If you need to keep some data, delete selectively rather than removing everything.

## 11. Cookies and similar technologies

* **Browser storage.** Qube stores preferences, provider configuration, and onboarding state in browser local storage. This storage is essential for the application to function; clearing it will reset preferences and require reconfiguration.
* **Session cookie for Login with ChatGPT.** When you sign in with ChatGPT, the server sets a signed, HTTP-only session cookie tied to the Login with ChatGPT secret to maintain your session. It is sent only to the ChatGPT proxy endpoints on the same origin and expires according to the handler's time limit. No advertising or cross-site tracking cookies are set by Qube itself.
* **No advertising tracker.** Qube does not load advertising or cross-site tracking scripts.

Your browser and any sites you visit via web fetch or browser automation may set their own cookies under their policies.

## 12. Children's privacy

Qube is not directed to children and is not intended for use by individuals who cannot form a legally binding contract. We do not knowingly collect personal information from children through Qube. If you believe a child has provided personal information via a Qube installation you control, delete the relevant sessions, memory entries, and files and, if you used a cloud Provider or Connector, address retention with that third party. We do not have a separate mechanism to verify age because there are no Qube-hosted accounts.

## 13. International transfers

Qube runs on your device, but when you choose a cloud Model Provider, integration partner, or connected service, prompts, file excerpts, tool outputs, and other context are transmitted over the internet to servers those parties operate, which may be located in a different country than you. Browser and web-fetch requests likewise go to the hosts you specify. Those parties' handling of the transfer is governed by their terms and policies. If you need data to stay in a particular region, choose a Provider and configuration that offers regional controls or run inference locally.

## 14. Changes to this Policy

We may update this Policy as Qube evolves. When we do, we will update the "Last updated" date and, for material changes, show a notice in the application or publish the update with the release. Continued use after the effective date constitutes acceptance. We recommend reviewing this Policy after updates, especially when new Providers, Connectors, or memory behaviors are added.

## 15. Contact

Privacy questions, requests, or concerns about Qube may be directed to the maintainers through the project's repository or the contact channel listed on the distribution page. If you deploy Qube for an organization, replace this with your legal entity name and privacy contact address. Requests concerning data held by a Model Provider, integration partner, or connected service must be directed to that party.

---

### Relationship to the Terms

The [Terms of Service](TERMS.md) describe your responsibility for the Agent's actions, the nature of AI outputs, and limits on warranties and liability. This Policy complements those Terms by describing data handling. In particular, the Terms' description of third-party sharing and categories of data that may be sent to Providers is reflected and expanded here in Sections 6–7.

### Scope note

We have written this Policy to track what the code actually does: local-first storage, browser storage for preferences, file-backed sessions and memory, the ChatGPT proxy where enabled, and Connector-based integrations. Claims are limited to what the implementation supports at the time of drafting. Integration partner names and specific Provider features are described in general terms so the Policy remains accurate as offerings change. Data-protection addenda, AI transparency, and jurisdiction-specific disclosures are intentionally left for counsel to validate rather than asserted as compliant.
