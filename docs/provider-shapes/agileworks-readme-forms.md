# The two official configuration forms (README of the sealed repository)

Source: https://github.com/atled-workflow/agileworks-mcp-server — README.md (raw, read 2026-10-02; first read 2026-09-29).
The configuration blocks, verbatim:

Local (P2):

```json
"command": "{nodejsのインストールディレクトリの絶対パス}",
"args": [
    "{aw-app/dist/custom/admin/server.js の絶対パス}"
],
"env": {
     "SYSTEM_URL": "{AgileWorksのシステムURL}",
    "ACCESS_TOKEN": "{AgileWorks WebAPIで使用するOAuth2のアクセストークン}"
}
```

設定例: `"command": "c:\\nvm4w\\nodejs\\node"`, `"args": ["C:\\temp\\agileworks-mcp-server\\aw-app\\dist\\custom\\admin\\server.js"]`

Remote (P3):

```json
"command": "npx",
"args": [
  "-y",
  "mcp-remote",
  "http(s)://{FQDN}/mcp",
  "--header",
  "x-system-url: {AgileWorksのシステムURL}",
  "--header",
  "x-access-token: {AgileWorks WebAPIで使用するOAuth2のアクセストークン}"
]
```

The README also says `x-system-url` / `x-access-token` may be given as query parameters of the `/mcp` URL.

## The grammar the harness reads (lib/natural-task-rules.mjs `entryForm`, by position — Codex 79e624d N1)

- **P2**: `command` is exactly `node` — its last path segment, case-insensitive, `node` or `node.exe` (the README's own example is a path to `node`). The script is the first argument that is not an option (does not start with `-`) and it ends with `aw-app/dist/custom/admin/server.js` (separators and case normalised). No option before it runs or loads other code (`-e`, `--eval`, `-p`, `--print`, `-r`, `--require`, `--import`, `--loader`, `--experimental-loader`). Credentials: the entry's `env` itself has `ACCESS_TOKEN` and `SYSTEM_URL`.
- **P3**: `command` is exactly `npx` (`npx` or `npx.cmd`, last path segment). With `-y` / `--yes` left out, the first argument is exactly `mcp-remote` (or `mcp-remote@<version>`, the version matching `^[0-9A-Za-z][0-9A-Za-z.\-]*$` — a plain tag or semver; `mcp-remote@npm:other`, `@git+https:…`, `@github:…`, `@file:…`, a second `@` or an empty version name another package and are **unclear**) and the next one is an http(s) URL whose path ends with `/mcp`. Credentials: `--header x-access-token: …` and `--header x-system-url: …`, or the query of that URL.
- Three values per entry: **official** (the grammar holds) / **other** (neither the P2 path nor `mcp-remote` appears anywhere in the entry) / **unclear** (one of them appears but the grammar does not hold — e.g. `echo <path>`, `node other.js <path>`, `node -e … <path>`, `npx other-package mcp-remote <url>`, `npx mcp-remote <other url> <…/mcp>`). Unclear is undetermined, never a false completion: only the passing side is strict.
- **The P3 host is not bound** (known, on purpose): the README itself writes `http(s)://{FQDN}/mcp` — the host is each customer's own. The pass is bound by `mcp-remote`, the `/mcp` path and the two AgileWorks-specific headers `x-access-token` and `x-system-url`.
