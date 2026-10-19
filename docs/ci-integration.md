# CI and releases

Scan application source with an explicit threshold:

```sh
npx ipc-sentinel scan . --fail-on medium
```

Exit 1 means findings at or above the threshold. Exit 2 means incomplete analysis or a fatal configuration/root error. Neither should be ignored in a security gate. JSON and SARIF stdout have no progress logs. Verbose observations use stderr.

## SARIF upload

After npm publication, an application repository can use:

```yaml
permissions:
  contents: read
  security-events: write
steps:
  - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
    with:
      persist-credentials: false
  - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
    with:
      node-version: '24'
  - run: npm ci --ignore-scripts
  - name: Scan
    id: sentinel
    continue-on-error: true
    run: npx --no-install ipc-sentinel scan . --format sarif > ipc-sentinel.sarif
  - uses: github/codeql-action/upload-sarif@f3c49fd1ef3281abc41069b3dd22807a60c963f6 # v4
    if: always() && steps.sentinel.outcome != 'skipped'
    with:
      sarif_file: ipc-sentinel.sarif
  - name: Enforce scan result
    if: steps.sentinel.outcome == 'failure'
    run: exit 1
```

This is a workflow fragment: put steps in a job and install IPC Sentinel in the application's devDependencies. Fatal configuration errors produce no SARIF; uploads can fail appropriately. GitHub code-scanning availability and fork permissions depend on repository configuration. Reports include suppressed findings with SARIF suppression metadata. Paths are relative to the scanned root: scan the checkout root for straightforward code-scanning path mapping. Scans of subdirectories need appropriate path handling in the receiving system.

## Project validation

The repository workflow runs formatting, ESLint, strict TypeScript checks, unit/CLI tests, build, packed installation, exports and publication dry-run on Node 22/24 across Ubuntu, Windows and macOS. Coverage and npm audit also run. Actions are pinned to verified commit SHAs; Dependabot proposes updates. Pull requests get read-only repository access and no publication credentials. There is no pull_request_target execution.

The initial six-job remote matrix passed on the implementation revision recorded in docs/release-validation.md. That record also distinguishes the clean local Windows validation and subsequent documentation revisions. Check the exact release commit's workflow before publication.

## Publication approval and setup

`release.yml` is manual only; it does not publish on push or tags. It accepts the exact version and 40-character commit SHA, requires a default-branch run, validates those values against checkout metadata, runs release gates, then waits at the `npm-release` environment before the OIDC job. It does not create GitHub releases or push tags.

Before dispatch, the repository owner must:

1. Explicitly approve `ipc-sentinel@0.2.0` and its final commit after reviewing validation.
2. Confirm authenticated npm identity, name availability and package/scope ownership. E404 does not establish ownership or eligibility.
3. Create GitHub environment `npm-release`, require reviewers, prevent self-review, and restrict deployment to the default branch. Without those external settings the environment name alone does not enforce approval.
4. Configure the npm trusted publisher for owner `Laxyny`, repository `IPC-Sentinel`, workflow `release.yml`, and environment `npm-release`. Trusted publishing may require an existing package; if first publication requires interactive authenticated bootstrap, obtain exact approval and follow npm's current setup instructions. Never paste credentials into source.
5. Push the reviewed revision and confirm the six OS/Node jobs and pinned public-source regression job before dispatching.
6. Dispatch manually with exact inputs; approve the protected environment after validating logs.
7. Verify `npm view ipc-sentinel@0.2.0` and install it in a fresh consumer, then record the npm URL and revision.

The job grants id-token only to publication and uses npm provenance. [npm trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/) is authoritative for account-side requirements. No npm token is committed or expected in the workflow. Existing versions cannot be republished; npm immutability and serialized release jobs prevent replacement or overlapping publication. Correct failed publication through a reviewed new version, not a force workflow.

Release approval remains outstanding. A dry run verifies packaging; it does not authenticate a publisher, reserve a name, test provenance or publish anything.

## Approved development maintenance

Validation runs on pull requests and main pushes; concurrency cancels stale validation runs. Development branch pushes without a PR do not duplicate the PR matrix. The manual release gate additionally runs coverage and pinned public-source regressions.

The maintenance workflow runs trusted default-branch policy code after successful PR validation; it never checks out or executes a PR with its write token. A same-repository Dependabot PR must change only package.json/package-lock.json, carry maintenance-approved, have a current-head approval from an owner/member/collaborator, no outstanding requested changes, include current main, and pass all seven required checks. Only exact patch increases to typescript-eslint or paired vitest/@vitest/coverage-v8 are eligible. Production dependency/lock entries, scripts, metadata, major/minor updates, unpaired peers and non-registry tarballs are rejected. The merge uses the expected SHA and normal branch protection. No bypass or unconditional automerge is configured.

Apply approval and label before the final Validation run, or rerun Validation afterward; this workflow is not triggered by labeling alone. The policy has executable rejection tests. Its actual post-merge write-token operation requires repository-side permissions and has not been exercised by publishing or merging the feature PR. Protection settings and required owner actions are recorded in docs/v0.2-engineering.md.
