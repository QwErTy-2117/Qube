# Choose your AI

Qube ships without an AI model of its own. Every response is produced by an
AI provider you choose, and you only ever pay that provider — Qube itself has
no subscription and no per-message charges.

There are three ways to give Qube a brain, and you can switch at any time in
**Settings → Advanced → Providers & Models** (the ChatGPT sign-in lives in
**Settings → Preferences**).

## Option 1 — Sign in with ChatGPT

If you already pay for ChatGPT, this is the fastest path: no API key, no
token copying, no separate per-token bill.

1. In onboarding (or the **ChatGPT** card in **Settings → Preferences**),
   choose **Connect OpenAI subscription** and follow the sign-in window.
2. Qube discovers the models available on your plan and lists them in the
   model picker.

How it works: the sign-in uses the open-source `loginwithchatgpt` server
library. Qube keeps the session in a local file
(`.memory/chatgpt-sessions.json`, signed with a locally generated secret in
`.memory/lwc-secret.txt`) and sends your requests to OpenAI through its
built-in `/api/chatgpt` proxy, so tokens never appear in the interface.

Things to know:

- Model lists reflect your actual plan. If OpenAI renames or retires a model,
  Qube automatically remaps a stale default to a live model on your next
  message.
- If usage limits are reached, OpenAI enforces them on your account, not
  Qube — wait for the reset window, pick a smaller model, or switch providers.
- If a sign-in expires, reconnect from the ChatGPT card in
  **Settings → Preferences**.
- ChatGPT models need your signed-in session, which only exists while you
  are using the app. Background work (scheduled tasks and the check-in)
  therefore uses your first enabled **non-ChatGPT** model instead; if you
  only have ChatGPT models, background runs cannot start.

## Option 2 — Add an API key

Pick a provider in **Settings → Advanced → Providers & Models**, paste its
key and choose **Save & Fetch Models**. Qube checks the key by asking the
provider for its model list (`/models`), then shows the models so you can
activate the ones you want and set a default. Listing models only proves the
key is valid — chat quota is checked when you send your first message (see
[below](#why-a-working-key-can-still-fail-in-chat)).

The provider list has 45 entries: the ChatGPT sign-in, Ollama and LM Studio
(see the other options on this page), and these API-key presets:

- **Major labs:** OpenAI, Anthropic, Google Gemini, xAI, Mistral, DeepSeek, Cohere
- **Aggregators and hosting:** OpenRouter, Together AI, Fireworks, Groq, Perplexity, Cerebras, SambaNova, DeepInfra, Nebius, Novita, SiliconFlow, Moonshot, Zhipu, MiniMax, Stepfun, Alibaba Cloud, Volcengine, Hunyuan, Spark, Yi, Upstage, AI21, Replicate, Hugging Face, Anyscale, NVIDIA, Cloudflare, Vercel, PPIO
- **Enterprise clouds:** Amazon Bedrock, Azure OpenAI, Google Vertex AI
- **Developer platforms:** GitHub Models, OpenCode Zen
- **Bring your own endpoint:** Custom OpenAI-compatible (any service that speaks the OpenAI API, including self-hosted gateways)

You can activate up to **five models in total** and switch between them
from the model picker in the composer without opening Settings.

How presets connect: Mistral uses Mistral's own SDK; OpenCode Zen uses the
OpenAI Responses API for its GPT, Grok and Muse Spark models and Chat
Completions for the rest; every other preset is called through an
**OpenAI-compatible Chat Completions** client at the preset's base URL. The
base URL is editable when you configure a provider. Some presets need it
changed before they work — Azure OpenAI ships with a `YOUR_RESOURCE`
placeholder and Cloudflare with an `{account_id}` placeholder — and services
that do not offer an OpenAI-compatible endpoint at the preset URL will fail
when you chat. When in doubt, use **Custom** with the provider's documented
OpenAI-compatible URL.

### Model capabilities

Qube detects, per model:

- **Image input (vision)** — needed for screenshots and inline image
  attachments. Without it, images are still saved to the workspace and the
  Agent receives the path.
- **Reasoning/thinking** — when supported, the model picker offers
  **Off / Low / Medium / High** thinking effort. Higher effort takes longer
  and can cost more; Off is fine for everyday tasks.
- **Context window and price** — shown when the provider reports them, and
  used for the usage meter and automatic conversation compaction.

There is no temperature control in the interface; see
[Environment variables](./configuration.md#model-settings-that-are-not-environment-variables)
for how the value is chosen.

### OpenCode Zen note

OpenCode can restrict free Zen models to its own client, in which case model
discovery or chat fails with a "FreeTier" error. Add billing to OpenCode Zen
and pick a paid Zen model, or choose another provider. Zen's Claude, Qwen and
Gemini models use APIs Qube does not support yet; Qube shows a clear error
and suggests a GPT, DeepSeek, GLM, Kimi, MiniMax or Big Pickle model
instead.

## Option 3 — Run a local model

For fully offline work, run a local inference server and add it like any
other provider:

- **Ollama** — install Ollama, pull a model (for example `ollama pull llama3.1`),
  then add the built-in Ollama provider. It points at
  `http://localhost:11434/v1` by default.
- **LM Studio** — start LM Studio's local server, then add the built-in LM
  Studio provider (default `http://localhost:1234/v1`).

For Ollama, Qube asks the server for each model's real capabilities
(vision, thinking, tools) instead of guessing from the name; for other local
servers it falls back to name-based detection. Local models are usually smaller than
cloud models, so complex multi-step tasks may work better with a strong cloud
provider; simple questions, drafting and offline work are fine locally.

## Picking a default model

The **default model** is used for every new chat unless you pick another one
in the model picker. A sensible starting point is a strong, tool-capable
model from a provider you already pay for. Background work — scheduled tasks
and the periodic check-in — uses the same default model, unless it is a
ChatGPT model (see Option 1).

## Why a working key can still fail in chat

Fetching models proves the key is accepted, but providers separate
model-list access from chat quota. The most common cases:

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| `401` / invalid key | Wrong or rotated key | Re-enter the key in Settings |
| `429` / rate limit / quota | Billing or chat credits exhausted | Check the provider dashboard, wait, or use a smaller model |
| Model not found (`404`) | Model renamed or retired | Refresh models in Settings and pick again |
| Blocked (`403`) | Workspace/account flagged or model disabled | Check the provider dashboard |
| ChatGPT usage limit | Plan limit reached | Wait for reset, use a smaller model, or switch provider |

Qube turns these raw provider errors into plain-language fixes inside the
chat. For a longer list, see [Troubleshooting](./troubleshooting.md).

## Related reading

- [Environment variables](./configuration.md) — provider-related variables for source builds
- [Qube as an ACP agent](./acp.md) — choosing the model with `QUBE_MODEL` in editors
- [Permissions and privacy](./permissions-privacy.md) — what your provider receives
