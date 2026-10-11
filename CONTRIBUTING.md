# Contributing

Use Node.js 22.13+ or 24 LTS and npm 11.6.4. Clone the repository, run `npm ci`, and run `npm run validate`. Run `npm run test:coverage` for a coverage report and `npm run benchmark` for a synthetic measurement.

For a rule change, include a realistic insecure fixture, a secure counterexample, accurate locations, expected confidence, and documented limitations. Prefer conservative findings to unsupported vulnerability claims. Add a regression test for each correctness bug. Preserve stable rule IDs. Do not execute target source or add scan-time network traffic. Keep production dependencies small and pinned.

Use professional English without emojis. Follow Conventional Commits and keep changes reviewable. Update rule documentation, configuration schema, changelog and public examples when behavior changes. Formatting, linting, strict type checks, tests, build, packed consumer tests and dependency audit must pass before release.

Report normal bugs through GitHub issues with minimized source, configuration and observed/expected findings. Do not attach secrets or proprietary application source. Report sensitive vulnerabilities through the process in SECURITY.md.

Publishing requires explicit approval for the exact name, version and revision. Never push a publication-triggering tag, publish a package or create a public release without authorization. The manual workflow requires a protected environment and configured npm identity; see docs/ci-integration.md.
