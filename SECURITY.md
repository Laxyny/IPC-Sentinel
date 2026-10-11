# Security policy

The current 0.1.x line is the initial supported development line. No published release is claimed here. Fixes target the latest patch in a supported line; historical versions are not maintained indefinitely.

For a vulnerability in IPC Sentinel itself, use GitHub private vulnerability reporting if the repository owner has enabled it. Otherwise request a private contact channel from the owner without disclosing exploit details publicly. Private reporting availability is repository configuration, not guaranteed by this file. Include affected versions, a minimized reproduction, impact and suggested remediation. Do not upload third-party private source or secrets.

The scanner never executes application code or imports executable configuration. It has no scan-time networking or telemetry. Scanned JSON is data, and the compiler host reads only discovered source. Source discovery skips symlinks and caps resources. Do not treat scanning as sandbox execution or assume it withstands arbitrary concurrent filesystem mutation. Dependency installation and development tests execute trusted package tooling as usual.

Findings are source facts or review recommendations, not guarantees of exploitability or application security. Read docs/rules.md for known false positives and gaps. Reports contain paths and channel names; review them before publishing SARIF or JSON.

Publication safeguards: committed lockfile, two pinned production dependencies, package contents whitelist, clean-consumer integration tests, audit gates, SHA-pinned CI actions, manual release dispatch, npm provenance, and a protected release environment requiring reviewer approval. Configure that environment and trusted publisher before dispatch. No registry credentials belong in source control.
