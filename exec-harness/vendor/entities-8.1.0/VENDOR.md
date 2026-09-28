# entities 8.1.0 (decoder only) — vendored

- Source: npm package `entities` 8.1.0 (https://github.com/fb55/entities), tarball https://registry.npmjs.org/entities/-/entities-8.1.0.tgz
- Integrity of the tarball (checked against the registry on 2026-09-28): `sha512-kxL7msIffSuh9aaFAMD7rxAIuTRMAHMeBtgHW2yUdWw732ZNh4MehkF2gdjvtdmikkaIP9bFDDJOPlsvm7avrA==`
- Licence: BSD-2-Clause (`LICENSE`, copied unchanged).
- Files: `dist/decode.js`, `dist/decode-codepoint.js`, `dist/generated/decode-data-html.js`, `dist/generated/decode-data-xml.js`, `dist/internal/bin-trie-flags.js`, `dist/internal/decode-shared.js` — copied byte for byte (the `sourceMappingURL` comments point at maps that are not vendored).
- Used by: `exec-harness/lib/attribution-rules.mjs` (`decodeHTML`, once, before the attribution column A reads a page). It replaces a hand-written table that decoded `&hyphen;` / `&dash;` to ASCII "-" instead of U+2010 (Codex review of 185d63d, R3).
- Why vendored and not a dependency: `node_modules` of this worktree is shared through a junction with the pinned runtime `kansei-marker-runtime-2`, whose first scheduled runs (M-002, M-004) must not see a changed dependency tree. Moving this to a normal `package.json` dependency is a later, separate change.

sha256 of the vendored files (the LF bytes stored in the repository — `git show HEAD:<path> | sha256sum`; a Windows checkout with core.autocrlf may hold CRLF copies):

```
dddf76e72987697316e647f046b2755dafe16308fe83159969b3155e0ebf3beb  decode-codepoint.js
6ce0048039ae0f9dab6e21dd1309661bcfe7e3beabfab1f15cdd61adb91e20b7  decode.js
1ff1226550125bb8976dd032b2dcfc37ba311863dbf9ae69b4b16922f5a38ead  generated/decode-data-html.js
e549a5fd573d540a4652c81fab6655f3418c34c1613a30ed245ca017d9a5b730  generated/decode-data-xml.js
8bb285f9ab41b9fd2525c83902c99b36e7c36da7cb7fa3be574d68f328183de5  internal/bin-trie-flags.js
cd26388e8ec3fdc2c4b212883e9ae460a4fe6dd37d80d0dacffd6b0087171b6b  internal/decode-shared.js
```
