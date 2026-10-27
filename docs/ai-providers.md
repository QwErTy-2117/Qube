# Choose your AI

Qube ships without an AI model of its own. Every response is produced by an
AI provider you choose, and you only ever pay that provider — Qube itself has
no subscription and no per-message charges.

There are three ways to give Qube a brain, and you can switch at any time in
**Settings → Providers & Models**.

## Option 1 — Sign in with ChatGPT

If you already pay for ChatGPT, this is the fastest path: no API key, no
token copying, no separate per-token bill.

1. In onboarding (or **Settings → ChatGPT**), choose **Connect OpenAI
   subscription** and follow the sign-in window.
2. Qube discovers the models available on your plan and lists them in the
   model picker.

How it works: Qube keeps you signed in with a local session and proxies
requests through its built-in ChatGPT endpoint. The browser only ever holds
an HttpOnly session cookie; your tokens never appear in the UI.

Things to know:

- Model lists reflect your actual plan. If OpenAI renames or retires a model,
  Qube automatically remaps a stale default to a live model on your next
  message.
- If usage limits are reached, OpenAI enforces them on your account, not
  Qube — wait for the reset window, pick a smaller model, or switch providers.
- If a sign-in expires, reconnect in **Settings → ChatGPT**.

## Option 2 — Add an API key

Paste a key from any supported provider in **Settings → Providers & Models →
Add provider**. Qube verifies the key with a real chat request (listing
models alone can succeed even when chat quota is exhausted), then fetches the
available models so you can activate the ones you want and set a default.

Forty-five provider configurations are built in:

- **Major labs:** OpenAI, Anthropic, Google Gemini, xAI, Mistral, DeepSeek, Cohere
- **Aggregators and hosting:** OpenRouter, Together AI, Fireworks, Groq, Perplexity, Cerebras, SambaNova, DeepInfra, Nebius, Novita, SiliconFlow, Moonshot, Zhipu, MiniMax, Stepfun, Alibaba Cloud, Volcengine, Hunyuan, Spark, Yi, Upstage, AI21, Replicate, Hugging Face, Anyscale, NVIDIA, Cloudflare, Vercel, PPIO
- **Enterprise clouds:** Amazon Bedrock, Azure OpenAI, Google Vertex AI
- **Developer platforms:** GitHub Models, OpenCode Zen
- **Bring your own endpoint:** Custom OpenAI-compatible (any service that speaks the OpenAI API, including self-hosted gateways)

You can activate several models at once and switch between them from the
model picker in the chat header without opening Settings.

### Model capabilities

Qube detects, per model:

- **Image input (vision)** — needed for screenshots and image attachments.
- **Reasoning/thinking** — when supported, the model picker offers
  **Off / Low / Medium / High** thinking effort. Higher effort takes longer
  and can cost more; Off is fine for everyday tasks.
- **Temperature** — adjustable in Settings; the chat default is a balanced
  `0.3`.

### OpenCode Zen note

Zen free-tier models are restricted by OpenCode to its own official client
and cannot be used from Qube. Add billing to OpenCode Zen and pick a paid Zen
model, or choose another provider.

## Option 3 — Run a local model

For fully offline work, run a local inference server and add it like any
other provider:

- **Ollama** — install Ollama, pull a model (for example `ollama pull llama3.1`),
  then add the built-in Ollama provider. It points at
  `http://localhost:11434/v1` by default.
- **LM Studio** — start LM Studio's local server, then add the built-in LM
  Studio provider (default `http://localhost:1234/v1`).

Qube reads each local model's reported capabilities (vision, thinking, tool
use) where the server provides them. Local models are usually smaller than
cloud models, so complex multi-step tasks may work better with a strong cloud
provider; simple questions, drafting and offline work are fine locally.

## Picking a default model

The **default model** is used for every new chat unless you pick another one
in the model picker. A sensible starting point is a strong, tool-capable
model from a provider you already pay for. Background work — scheduled tasks
and the periodic check-in — uses the same default model.

## Why a validated key can still fail in chat

Settings validates a key by sending a tiny chat probe, but providers
separate model-list access from chat quota. The most common cases:

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
