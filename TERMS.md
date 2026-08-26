# Terms of Service 

**Last updated: August 26, 2026**

> **Important notice:** This document reflects how Qube actually works based on its current implementation. It is not legal advice and does not guarantee compliance with any particular jurisdiction. Have it reviewed by a qualified attorney before publishing or relying on it, especially for consumer-protection, data-protection, and AI-specific requirements that apply to your deployment.

---

## 1. Introduction and acceptance

Welcome to Qube. Qube is a desktop AI agent application that helps you get things done through an autonomous, chat-based assistant that can work with files, run commands, search the web, generate documents, automate browser and desktop steps when enabled, connect to external services you authorize, and delegate work to subagents.

These Terms of Service ("**Terms**") govern your access to and use of Qube, including the desktop application, its bundled local server, and any related documentation or services (together, the "**Service**").

By installing, launching, or using Qube, or by confirming acceptance during onboarding, you agree to be bound by these Terms. If you do not agree, do not install or use Qube.

If you use Qube on behalf of an organization, you represent that you have authority to bind that organization, and "you" refers to that organization.

## 2. Definitions

* **"Qube" / "Service"** — The Qube desktop application, its local server/sidecar, shell, and any updates or documentation we provide.
* **"AI Agent" / "Agent"** — The autonomous system in Qube that interprets your messages, plans tasks, calls tools, and interacts with files, browsers, desktop applications, and connected services on your behalf using a third-party AI model you configure.
* **"Model Provider" / "Provider"** — The third-party provider of the AI model that powers the Agent (for example, a commercial API provider or a local model you run yourself). You choose and configure the Provider; we do not operate the model unless we expressly state otherwise.
* **"Connector"** — An integration you authorize that lets the Agent interact with an external service on your behalf (for example, email, calendar, drive, chat, or project tools), typically via an integration partner that facilitates OAuth and tool execution.
* **"Workspace"** — The sandboxed folder on your device where the Agent works with files and commands by default. Access outside this folder requires your permission where applicable.
* **"User Content"** — Prompts, instructions, files, data, and other material you provide to Qube or that the Agent creates on your behalf.
* **"You" / "User"** — The person installing or using Qube.

## 3. What Qube does

Qube provides a chat interface to an autonomous agent that can, depending on how you configure it:

* work with files and folders (read, create, edit, delete, and list) and run shell commands, scoped to the Workspace by default;
* search the web and fetch page content;
* generate formatted documents, presentations, spreadsheets, and other files;
* automate browser and desktop interactions when you enable those capabilities;
* delegate parts of a task to subagents that operate with the same tool access and report back to the main Agent;
* remember context across conversations through session history and persistent memory stored locally;
* connect to external services you explicitly authorize and perform actions in those services on your behalf;
* run scheduled and recurring tasks, including a periodic heartbeat task, with permissions you control.

Qube runs primarily on your device. AI reasoning is performed by the Model Provider you select; Qube orchestrates tools, memory, permissions, and integrations around it.

We may add, change, or remove capabilities over time as described in Section 16.

## 4. Eligibility, installation, and accounts

* You must be able to form a legally binding contract to use Qube. If you are below the age required in your jurisdiction, you may only use Qube with the involvement of a parent or legal guardian.
* You are responsible for installing Qube on a device you own or control and for keeping your operating system reasonably up to date.
* Qube does not require a Qube-hosted account. Instead, you configure:
  * **Model Providers** with your own API keys, endpoints, or local model settings, or by signing in with your own ChatGPT account through Login with ChatGPT where offered; and
  * **Connectors** via OAuth, where you authorize Qube to act in an external service under your account. You can disconnect at any time from Qube or from the service itself.
* You are responsible for all activity that occurs through your device, your API keys, your ChatGPT session, and your connected accounts. Treat API keys, session credentials, OAuth tokens, and your device as you would a password — keep them secure and do not share them with others.

## 5. The AI Agent — what it is and what it is not

* The Agent is an **autonomous tool that acts on your instructions, approvals, and configuration**. It interprets natural language, makes plans, calls tools, and produces outputs, often taking multiple steps before reporting back — intentionally, so it can handle complex, multi-step work.
* The Agent is **not a human, not your legal representative, and not a substitute for professional advice**. It has no independent legal authority.
* What the Agent can do depends on the model you selected and the tools, connectors, and permissions you have enabled. Enabling additional capabilities (desktop or browser automation, connectors, or broader task permissions) expands what the Agent can affect on your behalf.
* We provide the Agent's orchestration, sandboxing, and permission prompts, but **we do not control the underlying model**. Model behavior, availability, pricing, and data handling are governed by the Provider you choose.

## 6. Your responsibility for the Agent's actions

**Please read this section carefully. It is central to your use of Qube.**

* **You authorize the Agent to act for you.** When you give the Agent an instruction (for example, "organize my files," "draft and send the email," or "update the spreadsheet"), approve a permission prompt, authorize a Connector, or configure scheduled tasks or system permissions, you are authorizing the Agent to take the steps it infers are needed to carry out that request. A short or general instruction may cause the Agent to take broad actions.

* **You are responsible for the Agent's actions taken on your behalf.** This includes actions the Agent takes based on your instructions, your approvals, your Connector authorizations, your Workspace contents, and your configuration — whether or not you anticipated the specific steps. This includes without limitation files the Agent creates, edits, or deletes; commands it runs; messages it sends through connected services; browser or desktop actions it performs; and changes it makes to data or systems you have given it access to. This responsibility applies even when the result is unintended or unexpected.

* **You must review, supervise, and validate.** The Agent may act extensively before showing you a summary. You are responsible for reviewing tool calls, file changes, and outputs displayed in the chat thread; checking diffs and command results rather than assuming success; and validating that generated code, documents, emails, messages, and other outputs are correct **before** you rely on, publish, send, share, or execute them.

* **Real-world consequences.** Agent actions can affect files on your device, data in connected applications and accounts, and systems reachable from your Workspace or browser session. You are responsible for anticipating that scope, limiting the Agent's access and permissions to what you intend, and maintaining backups and version control for important data.

* **You are responsible for lawful and authorized use.** You are responsible for ensuring that your use of Qube — including instructions you give, content you provide, and actions the Agent takes on your behalf — is lawful and does not violate the rights, terms, policies, or rules of any third party or service you interact with (including any website, API, or connected service).

* **Safeguards are aids, not guarantees.** Qube surfaces confirmations for certain higher-risk actions where detected, but **we cannot guarantee that every risky action will be gated**. Permission prompts, sandboxing, and other safeguards are provided as safety aids. Your supervision remains the primary control. You should not proceed with high-stakes actions unless you are prepared to review and accept the consequences.

## 7. Permissions, sandboxing, and safeguards

Qube includes safeguards that depend on your configuration and do not replace your judgment:

* File and command tools are scoped to the Workspace by default; access that would affect locations outside the Workspace is blocked or requires your explicit approval, and external file access may be limited to certain directories.
* Certain shell commands that appear destructive and certain Connector actions that would create, send, modify, or delete data may pause for your confirmation where detected.
* Scheduled tasks enforce per-task permission flags you set. A task that lacks a permission cannot perform the gated action.

You may tighten or loosen these controls in settings. Looser settings let the Agent do more — and increase the risk that you are responsible for.

## 8. Third-party services and AI providers

Qube relies on third parties you choose:

* **Model Providers** — When you send a message, Qube transmits your prompt and relevant context to the Provider you selected so the model can generate a response and decide which tools to call. This may include conversation history, excerpts of files the Agent has read, tool outputs, attachments, and profile or memory context the Agent includes. If you use Login with ChatGPT, requests are forwarded through a local proxy using your signed session.
* **Connectors and integration partners** — When you connect a service, an integration partner facilitates OAuth and forwards tool inputs and results between Qube and the external service.
* **External websites and services** — When the Agent uses web search, web fetch, browser automation, or a Connector, it interacts directly with those websites or services under your device's network identity.

Each third party's handling of your data, availability, and security is governed by **that party's terms and privacy policy**, not ours. We do not control those third parties. By selecting a Provider or authorizing a Connector, you accept that its terms will apply to that portion of the processing.

## 9. What data may be shared with third parties and why

We try to send only what is needed for the feature you invoked, but in practice this can be broad:

* **To a Model Provider** — prompt text, conversation history, file excerpts and tool outputs the Agent chooses to include as context, attachments or referenced file content, profile information and relevant memory entries, and technical parameters such as model name and settings.
* **To a Connector/integration partner and then to the external service** — the specific inputs for the action (for example, an email draft or query), authentication data needed to perform the action, and the service's response.

**Why this happens:** without it, the model could not reason about your request and the integration could not perform the requested action.

**How third parties handle it:** Model Providers and integration partners may process, log, or retain data under their own policies. Some providers offer zero-retention or enterprise controls; others may retain logs or use data to improve services. Review the applicable policies before sending sensitive or regulated data. If you need stricter control, choose a provider and configuration that offers it, run inference locally where supported, or avoid including sensitive data in prompts and files the Agent can access.

Data you store locally (such as Workspace files, session history, memory, and provider settings) stays on your device and is not sent to us unless you use a feature that requires it (for example, the ChatGPT proxy).

## 10. Your content and intellectual property

* **Your content stays yours.** You retain ownership of User Content and of files the Agent creates for you. You grant us only the limited rights needed to operate Qube locally on your device and, where you have chosen a cloud Provider or Connector, to transmit that content to the Provider or service as described above.
* **Our rights.** Qube, including its code, design, and documentation, is owned by us or our licensors and protected by intellectual-property laws. These Terms do not grant you ownership of Qube — only a limited, non-exclusive, non-transferable, revocable license to install and use it for its intended purpose, subject to these Terms. Where Qube's source code is made available under the Apache License 2.0, that license continues to apply to the code; to the extent of any conflict between those open-source permissions and these Terms as applied to Qube as a product, these Terms govern use of the product.
* **Feedback.** If you send us ideas or feedback, you grant us permission to use them without obligation or compensation.

## 11. Acceptable use

You agree not to use Qube to:

* violate applicable law or regulation, or the rights of any person;
* access, collect, or process data without authorization, or attempt to bypass authentication, permission, or security controls;
* interfere with or disrupt any service, network, or system;
* upload or transmit malware, spam, or unlawful content;
* use the Agent for malicious automation — including harassment, impersonation, deception, or large-scale non-consensual messaging, scraping, or other activity that violates a site's or service's terms;
* attempt to extract, reverse-engineer, or misuse another person's credentials, tokens, or data;
* strip or modify copyright, attribution, or license notices;
* or otherwise use Qube in a way we reasonably consider abusive.

We may update these rules or take steps to prevent misuse, including limiting features or refusing to provide the Service where we believe there is a risk of harm.

## 12. AI limitations — do not rely without review

**AI outputs and agent actions may be incorrect, incomplete, unexpected, or harmful, even when they appear confident.** The Agent may hallucinate facts or file contents, misinterpret instructions, produce code or documents with errors, security issues, or formatting problems, or fail to notice consequences that would be obvious to a person.

**We do not guarantee that the Agent will behave correctly, accurately, safely, or as you intended.** Qube is provided without guarantees of accuracy, completeness, reliability, fitness for a particular purpose, or availability. Verify important information from authoritative sources. Do not use Qube as the sole basis for financial, legal, medical, or other high-stakes decisions without independent professional review.

You should maintain backups of important data, use version control for code and documents, review diffs before accepting file edits, and test code before deploying. **Where the consequences of an action matter, do not rely on the Agent without appropriate human review.**

## 13. Disclaimers

To the fullest extent permitted by law, the Service is provided **"as is" and "as available"** without warranties of any kind, whether express, implied, or statutory, including warranties of merchantability, fitness for a particular purpose, title, and non-infringement. We do not warrant that Qube will be uninterrupted, error-free, secure, or free of harmful components, or that defects will be corrected.

Model Providers, Connectors, browsers, websites, and external services are operated by third parties; we make no warranties about them.

## 14. Limitation of liability

To the fullest extent permitted by law:

* **Indirect damages excluded.** We will not be liable for any indirect, incidental, special, consequential, exemplary, or punitive damages, or for lost profits, revenue, data, business interruption, or cost of substitute services, even if advised of the possibility of such damages.
* **Cap on direct damages.** Our aggregate liability for any claim arising out of or relating to the Service or these Terms will not exceed the greater of (a) the amounts you paid to us for Qube in the 12 months preceding the claim, or (b) USD $100, if you paid nothing. Because Qube is currently offered without charge, (b) will typically apply, to the extent permitted by law.
* **Essential purpose.** These limitations apply regardless of the form of action and even if a remedy fails of its essential purpose.
* **Jurisdiction variations.** Some jurisdictions do not allow the exclusion or limitation of certain damages or warranties, so some of the above limitations may not apply to you. Where that is the case, they will be applied to the maximum extent permitted.

Nothing in these Terms is intended to limit liability in a way that is not permitted by law.

## 15. Indemnification

You agree to indemnify, defend, and hold harmless Qube, its contributors, maintainers, and affiliates, and their respective officers, directors, employees, and agents, from and against any claims, liabilities, damages, losses, and expenses (including reasonable attorneys' fees) arising out of or related to:

* your use of the Service;
* your instructions to the Agent and your configuration of providers, permissions, Connectors, and scheduled tasks;
* actions the Agent takes on your behalf as described in Section 6, including unintended or unexpected actions;
* your User Content or your violation of these Terms, applicable law, or any third-party rights, terms, policies, or rules.

We may, at our option, assume the exclusive defense and control of any matter subject to indemnification by you, at your expense, and you agree to cooperate with us in that defense.

## 16. Termination

* You may stop using Qube at any time by uninstalling it and, if you wish, deleting local data and revoking any OAuth grants you made in connected services.
* We may suspend or discontinue Qube, a feature, or your access if we reasonably believe you have violated these Terms, if needed for security or legal reasons, or if we decide to retire the product. Where practicable, we will provide notice.
* Upon termination, your right to use Qube ends. Provisions that by their nature should survive (including Sections 6, 10–15, and 17–19) will continue to apply.

## 17. Changes to the Service and to these Terms

* **Service changes.** Qube is actively developed. We may update the application, add or remove features, or change requirements at any time. Updates may be automatic or may require you to reinstall or rebuild the desktop package.
* **Terms changes.** We may update these Terms from time to time. If we make material changes, we will provide notice by updating the "Last updated" date, showing a notice in the application, or publishing the update with the release. Your continued use after the updated Terms become effective constitutes acceptance of the new Terms. If you do not agree, stop using Qube.

## 18. Intellectual property and third-party notices

* Qube may include open-source components under their own licenses. Your use of those components is governed by their licenses.
* Names, marks, and logos of third-party services are the property of their respective owners and are used for identification only.

## 19. Governing law and dispute resolution

*These Terms do not yet specify a governing law or dispute-resolution mechanism. This is intentional because the correct choices depend on where Qube is operated and distributed.*

We expect to select a single governing law and a proportionate dispute-resolution process in a later revision. Until then:

* These Terms will be governed by the laws that would otherwise apply in the jurisdiction where the publishing entity is established, without regard to conflict-of-laws principles.
* Any dispute should first be raised informally with us so we can attempt to resolve it.
* If you are a consumer, you may have additional mandatory protections under the laws of your habitual residence, which are not affected by these Terms.

> **Requires legal review:** Have counsel select a governing law, venue, arbitration and class-action provisions, and any consumer-dispute disclosures appropriate to your entity and distribution model.

## 20. Miscellaneous

* **Entire agreement.** These Terms, together with the applicable open-source licenses and any additional product notices we provide, constitute the entire agreement between you and us concerning Qube and supersede prior agreements on the same subject.
* **Severability.** If any provision is held unenforceable, it will be limited or removed to the minimum extent necessary so the remaining provisions stay in effect.
* **No waiver.** Our failure to enforce any provision is not a waiver of our right to do so later.
* **Assignment.** You may not assign these Terms without our prior written consent. We may assign them in connection with a merger, acquisition, reorganization, or sale of assets.
* **Notices.** We may provide notices by posting them with the application, on the distribution page, or by other reasonable means. You may contact us through the repository or the contact method listed in Section 21.
* **Language.** These Terms may be translated. The English version governs if there is a conflict.
* **Compliance with law.** You are responsible for complying with all laws that apply to your use of Qube, including export-control, data-protection, AI-use, and sector-specific rules. Do not use Qube to process personal or regulated data in a way that violates applicable law.

## 21. Contact

Questions about these Terms may be directed to the maintainers through the project's repository or the contact channel listed on the distribution page. If you deploy Qube for an organization, replace this with your legal entity name and support contact.

---

### Scope note

We have drafted these Terms to track the actual product — a local-first desktop agent that orchestrates third-party models and connectors, sandboxed by default, gated by permission prompts where implemented, and storing sensitive material locally. Descriptions are kept intentionally broad so they remain accurate as the product evolves, and implementation details are avoided where not needed for the legal document. Areas that depend on your Provider, deployment, and jurisdiction — notably governing law, consumer disclosures, and any required data-processing or AI transparency addenda — are flagged for attorney review rather than asserted as compliant.

To the extent legally permissible, responsibility and liability for use of Qube and for actions the Agent takes on your behalf remain with you, as detailed in Sections 6, 12–15.
