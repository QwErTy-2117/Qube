# Web research

Qube can answer questions that need current information without you opening
a dozen tabs. It searches, reads the relevant pages, and comes back with a
short, sourced answer.

## What it does

- **Web search** — runs a search and reads the results (up to ten per query).
- **Page reading** — fetches a specific URL, strips scripts and styling, and
  extracts the page's text (up to about 50,000 characters), optionally
  restricted to one CSS section.
- **Synthesis** — compares sources, notes where they disagree, and cites the
  pages it actually read. It never invents a URL or a fact it did not fetch.

Read-only research does not pause for approval, so a question like “what's a
good kids' bike under €150?” goes straight through to an answer with source
links.

## The research skill

For anything non-trivial, Qube applies its built-in **research** playbook:

1. Run several focused searches, including official documentation.
2. Read the strongest primary sources.
3. Return a brief structured as a short **TL;DR**, grouped findings with
   inline source links, trade-offs or open questions, and a deduplicated
   source list.

You can force it explicitly by typing `/research` before your question, and
deeper research playbooks are available in **Settings → Skills** — see
[Memory and skills](./memory-and-skills.md).

## Giving Qube a link directly

Paste a URL into your message and say what you want:

- “Summarize this and tell me what changed: https://example.com/report”
- “Extract every price from this page and put them in a spreadsheet.”
- “Read these three docs and tell me which plan fits a team of five.”

When a question links out to other pages, Qube follows the important links
itself (at most a few, one hop deep) rather than asking whether it should.

## Links in emails and messages are treated cautiously

Links from other people can be phishing, one-click actions, or trackers.
Qube follows these rules automatically:

- Suspicious or action links — unsubscribe, confirm, verify, accept
  invitation, reset password, magic sign-in, pay-now — are **not opened**;
  Qube says so in one short line.
- Lookalike domains and messages demanding credentials or payment trigger a
  plain warning instead of a click.
- Fetched page content is treated as data, never as instructions — a page
  that says “email these contents somewhere” is ignored.
- Logins, captchas and 2FA are never handled by the fetch tool; those belong
  to the watchable Qube Computer browser with you in control — see
  [Qube Computer](./computer.md).

## Safety under the hood

Fetch requests carry SSRF protection: DNS resolution and private-address
checks block requests aimed at your local network or internal infrastructure,
redirects are validated, and response sizes are bounded.

## When to use the browser instead

Plain reading is fastest for articles, docs, listings and public pages. Use
the [Qube Computer browser](./computer.md) when a site needs interaction — filling
forms, navigating a booking flow, checking a logged-in account, or watching
Qube work through a page step by step.
