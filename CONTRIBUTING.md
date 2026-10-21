# Contributing

Use Node.js 20.11 or newer and run `npm ci`. Run `npm run test:unit` and
`npm run test:server` before submitting server changes; the latter requires ffmpeg.
Native changes also need the applicable Swift or Android checks documented in README.

Use generated test media and isolated databases. Never connect development tests to a
production database. Keep API compatibility and explicit device capabilities in mind.

Before committing, inspect `git diff --cached`, ensure generated files are ignored,
and run a credential scanner such as `gitleaks git --redact .`. Do not add deployment
logs, real addresses, customer assets, signed distributions, signing keys or backups.
Test-only credentials in fixtures must be clearly synthetic.

Keep changes focused, describe validation and device limitations, and respect all
third-party licenses. Contributions to original project code are under the MIT license.
