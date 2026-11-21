# Qube documentation website

This folder is the source of the documentation website at
[qwerty-2117.github.io/Qube](https://qwerty-2117.github.io/Qube/), built with
[Fumadocs](https://fumadocs.dev/) and exported as static files for GitHub
Pages. It is fully isolated from the Qube app: it has its own `package.json`
and lockfile, and the app does not use anything in this folder.

The pages themselves are **not** written here — they are generated from the
Markdown in [`../docs/`](../docs/README.md), [`../TERMS.md`](../TERMS.md) and
[`../PRIVACY.md`](../PRIVACY.md). Edit those files.

```bash
npm ci
npm run dev                              # http://localhost:3020
DOCS_BASE_PATH=/Qube npm run build       # production build into out/
DOCS_BASE_PATH=/Qube npm run check-links
```

How it works, how to add a page, and how deployment is set up:
[docs/docs-site.md](../docs/docs-site.md).
