# Web research

Qube can answer questions that need current information without you opening
a dozen tabs. It searches, reads the relevant pages, and comes back with a
short, sourced answer.

## What it does

- **Web search** — runs a search and reads the results (six by default, up
  to ten per query). Search needs no account or API key: Qube queries
  DuckDuckGo (HTML and Lite pages) and Bing's RSS feed in parallel and uses
  whichever answers first, so your search terms are sent to those services.
- **Page reading** — fetches a specific URL, strips scripts and styling, and
  extracts the page's text (25,000 characters by default, up to 50,000),
  optionally restricted to one CSS section. Each fetch times out after 15
  seconds.
- **Synthesis** — compares sources, notes where they disagree, and cites the
  pages it actually read. The agent is instructed never to invent a URL or a
  fact it did not fetch — still double-check anything important.

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

You can force it explicitly: type `/` in the composer and pick **research**
(it appears as a skill chip), then ask your question. More
research playbooks can be added in **Settings → Advanced → Skills** —
see [Memory and skills](./memory-and-skills.md).

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
  to the watchable browser, which detects bot checks and asks you to complete
  them in the panel — see [Browser automation](./browser.md).

## Safety under the hood

Fetch requests carry SSRF protection: DNS resolution and private-address
checks block requests aimed at your local network or internal infrastructure,
redirects are validated, and response sizes are bounded.

## When to use the browser instead

Plain reading is fastest for articles, docs, listings and public pages. Use
the [managed browser](./browser.md) when a site needs interaction — filling
forms, navigating a booking flow, checking a logged-in account, or watching
Qube work through a page step by step.
