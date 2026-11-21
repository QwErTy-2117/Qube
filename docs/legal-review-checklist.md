# Legal and privacy review checklist

This checklist accompanies the [Terms of Service](../TERMS.md) and the
[Privacy Policy](../PRIVACY.md). It lists statements that **could not be
verified from the source code**, decisions only the maintainers can make, and
gaps a lawyer should look at.

> **This is not legal advice, and the Terms and Privacy Policy have not been
> approved by a lawyer.** The November 20, 2026 revision only corrected
> factual descriptions of how the software behaves (listed at the end of this
> page). It did not add, remove or change any obligations, warranties,
> liability limits, jurisdiction, age or refund terms.

## 1. Decisions only the maintainers can make

| # | Item | Where | Why it matters |
| --- | --- | --- | --- |
| 1.1 | **Who is "we"?** Neither document names a legal entity or person as publisher or data controller. | Terms §1, §21; Privacy §1, §15 | Contracts and data-protection laws generally need an identifiable party. |
| 1.2 | **Contact channel.** Both documents point to "the project's repository or the contact channel listed on the distribution page". No dedicated contact address appears in the repository or on the Releases page. | Terms §21; Privacy §15 | Privacy requests need a reliable route. |
| 1.3 | **Governing law and disputes** are explicitly left open, with a fallback to "the jurisdiction where the publishing entity is established", which depends on 1.1. | Terms §19 | Flagged in the Terms themselves as requiring legal review. |
| 1.4 | **Age.** The Terms require capacity to contract, with parental involvement below the local age; the Privacy Policy says Qube is "not intended for use by individuals who cannot form a legally binding contract". Confirm these are consistent and appropriate for your target markets. | Terms §4; Privacy §12 | Minimum-age rules for AI services vary by country. |
| 1.5 | **Open-source license vs. product terms.** Terms §10 says the Terms govern use of the product where they conflict with the Apache License 2.0. Confirm this is the intended relationship; Apache 2.0 grants rights that additional terms may not be able to restrict for the source code. | Terms §10 | Potential conflict with the license under which the code is distributed. |
| 1.6 | **License metadata mismatch.** `LICENSE` is Apache 2.0, but `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` declare `MIT`, so installers carry MIT metadata. | Repository | Inconsistent license signals to users. |
| 1.7 | **"Last updated" date.** It was set to November 20, 2026 for the factual corrections. Decide whether these changes count as "material" under Terms §17 and Privacy §14 (which promise an in-app notice for material changes). | Both documents | See 2.1: there is no mechanism to show such a notice. |

## 2. Statements that depend on behavior the code does not implement

| # | Statement | Finding in the code |
| --- | --- | --- |
| 2.1 | Material changes will be announced "by showing a notice in the application" (Terms §17, Privacy §14). | Consent is stored once as `qube-terms-accepted` in browser local storage (`components/shared/onboarding-dialog.tsx`) with no version, so the app cannot tell which version a user accepted or prompt again. Updating the "Last updated" date or release notes is possible today; an in-app notice is not. |
| 2.2 | "Continued use … constitutes acceptance" of updated Terms. | Whether this is enforceable depends on jurisdiction, and on 2.1. |
| 2.3 | "We may suspend or discontinue … your access" (Terms §16). | Qube has no accounts or server-side access control. The project can stop publishing releases, and the updater would stop offering updates, but an installed copy keeps working. |
| 2.4 | Users can "edit memory entries" and view stored content (Privacy §9). | There is no memory viewer or editor in the current UI; the memory/session delete endpoints exist but no control opens them. Users can only edit or delete the JSON files while Qube is closed, or use Hard Reset. The Privacy Policy already says this. |

## 3. Statements about third parties that cannot be verified from the code

| # | Statement | Note |
| --- | --- | --- |
| 3.1 | How Model Providers, Composio, DuckDuckGo, Bing, GitHub and the npm registry retain or use data. | Both documents correctly defer to each party's own policy. Consider linking to them. |
| 3.2 | "The integration partner … retains the tokens needed to perform actions" (Privacy §3). | Consistent with how Composio works, but its retention is governed by Composio's terms. Released builds use a **built-in Composio API key owned by the project**, so connections are created in the project's Composio account under a random per-install ID. Consider disclosing that the project, as Composio account holder, may be able to see connection metadata. |
| 3.3 | ChatGPT sign-in: requests go "to OpenAI using your signed session". | The sign-in uses `@opencoredev/loginwithchatgpt-*` packages and the Codex client identity. Confirm this use of a ChatGPT subscription is permitted by OpenAI's terms; Qube cannot guarantee it. |
| 3.4 | Computer Use OS permission requirements on Windows and Linux. | These come from the third-party `open-computer-use` driver. The previous text named specific requirements (macOS 14+, AT-SPI2/GDK on Linux, none on Windows) that cannot be verified from Qube's code; they were replaced with a pointer to `ocu doctor`. |

## 4. Statements that were inaccurate and were corrected

These factual corrections were made on November 20, 2026. Please review
them, since they change what users are told about safeguards.

| # | Previous statement | Correction | Evidence |
| --- | --- | --- | --- |
| 4.1 | Computer Use "clicks, keystrokes, and changes always pause for your explicit approval". | They go through an automated AI review first and only prompt when the review is unsure; with "auto-approve" on they run directly; background runs refuse them. | `lib/middleware/permission-middleware.ts`, `lib/permissions/reviewer.ts` |
| 4.2 | Browser Use runs "server-side" and requires enabling browser automation and granting system permissions. | The browser runs locally in a separate Qube profile and needs no OS permissions or toggle. System permissions apply to Computer Use. | `lib/browser/`, `lib/pi/browser-mcp.ts` |
| 4.3 | The Workspace is a "sandboxed folder" and Qube provides "sandboxing". | It is a default scope enforced by Qube's tools, not an OS sandbox; shell commands run with the user's privileges. | `lib/middleware/workspace.ts`, `lib/pi/tools.ts` |
| 4.4 | Destructive commands and connector writes "may pause for your confirmation". | Destructive actions are blocked unless enabled in Settings; other sensitive actions are reviewed, then prompted if needed. | `lib/permissions/policy.ts` |
| 4.5 | (Not stated) | Actions inside the managed browser and tools from custom MCP servers are **not** covered by the permission checks; the system prompt allows the agent to complete purchases the user asked for. This is now disclosed. | `lib/pi/harness.ts` (MCP tools merged unwrapped), `lib/pi/prompt-context.ts` |
| 4.6 | Browser capabilities have SSRF protection. | SSRF protection applies to web fetching, not to the managed browser. | `lib/agent/` SSRF guard used by the fetch tool |
| 4.7 | Data is not sent to us "unless you use a feature that requires it (for example, the ChatGPT proxy)". | The ChatGPT proxy is local and forwards to OpenAI; no feature sends data to the maintainers. | `app/api/chatgpt/` |
| 4.8 | Garbled text: "(e as accessibility…", "including browser engine (MIT)", "browser automation automation via browser engine". | Rewritten to the evident meaning; the unverifiable "MIT" component claim was replaced by a pointer to the dependency manifests. | — |
| 4.9 | (Not stated) | Newly disclosed: search providers (DuckDuckGo, Bing); update checks (GitHub); npm registry lookup for ChatGPT sign-in; site icons from DuckDuckGo's icon service; Composio logos; skills marketplaces; the action-review log; temporary tool-output files; Hard Reset does not revoke Composio connections; the desktop Workspace is deleted on version updates. | See [Permissions and privacy](./permissions-privacy.md) |

## 5. Gaps a lawyer may want to address

- **Data-protection roles.** If an entity publishes Qube, is it a controller
  for any processing? Processing happens on the user's device, but released
  builds embed a project-owned Composio key (3.2) and the project hosts update
  files on GitHub.
- **GDPR/UK GDPR and similar laws.** No lawful-basis statement, no data
  protection officer or EU/UK representative details, no statement of
  supervisory-authority complaint rights. Whether these are required depends
  on 1.1.
- **AI-specific transparency** (for example the EU AI Act) — flagged in both
  documents' scope notes as left for counsel.
- **Consumer-law disclosures** for the markets where Qube is distributed,
  including whether the liability cap and indemnity in Terms §14–15 are
  enforceable against consumers.
- **Security statements.** Provider API keys are stored in plain text
  (`.memory/providers.json`); this is disclosed in Privacy §8. Consider
  whether more prominent notice is appropriate.
- **Consent record.** See 2.1. Consider storing the accepted version and date.
