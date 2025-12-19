# Contributing to S3 Explorer

Thanks for your interest in contributing. This document describes how to set up your environment, run checks, and submit changes.

## Project overview

- Entry point: [index.html](index.html)
- Styles: [assets/css/styles.css](assets/css/styles.css)
- Scripts: [assets/js/app.js](assets/js/app.js), [assets/js/favicon.js](assets/js/favicon.js), [assets/js/banner-fade.js](assets/js/banner-fade.js)
- CI checks: [.github/workflows/ci.yml](.github/workflows/ci.yml)
- Local checks runner: [run_tests.sh](run_tests.sh)
- Docs: [README.md](README.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), [SECURITY.md](SECURITY.md), [SUPPORT.md](SUPPORT.md)

## Code of Conduct

By participating, you agree to abide by the [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). For any concerns, contact the enforcement contact listed in the document.

## Prerequisites

- Node.js and npx installed and available in PATH
- A modern browser for manual testing
- Python 3 for a simple local web server

## Running locally

Some browsers restrict null-origin access when opening files directly. Serve the project root over HTTP:

- macOS/Linux:
  - python3 -m http.server
  - Open http://localhost:8000
- Windows:
  - py -3 -m http.server
  - Open http://localhost:8000

See [README.md](README.md) for more details.

## Tests and quality checks

This repository uses linting and formatting checks enforced in CI:

- HTML: HTMLHint
- CSS: Stylelint
- JS: ESLint
- Formatting: Prettier check in CI

Before opening a PR, run the same checks locally using [run_tests.sh](run_tests.sh):

- Default strict mode:
  - ./run_tests.sh
- Allow ESLint warnings:
  - ALLOW_WARNINGS=1 ./run_tests.sh

The CI workflow is defined in [.github/workflows/ci.yml](.github/workflows/ci.yml).

## Branching and workflow

- Base branch: main
- Create a feature branch from main for your change
- Keep commits focused and logically grouped
- Open a Pull Request to main

### Pull Request expectations

Use the PR template that is auto-populated when opening a PR:

- Provide a clear summary and motivation
- Link related issues
- Include screenshots or recordings for UI changes
- Confirm you ran [run_tests.sh](run_tests.sh) locally and that CI passes
- Do not include secrets or personally identifiable data in PRs

## Commit messages

Use a Conventional Commits style where possible:

- feat: add new functionality
- fix: bug fix
- docs: documentation changes
- style: formatting-only changes
- refactor: non-functional refactor
- test: add or update tests
- chore: maintenance tasks

Examples:

- feat: add multipart upload progress indicator
- fix: correct region handling for bucket redirects

## Style guidelines

- Follow the linters; fix errors and warnings as applicable
- Keep JS modular and readable; prefer small functions
- Avoid adding new dependencies; this is a static site using CDN scripts
- Maintain accessibility considerations outlined in [README.md](README.md)

## Security

Do not file public issues for vulnerabilities. Follow the private reporting process in [SECURITY.md](SECURITY.md).

## Documentation

- Update [README.md](README.md) if user-facing behavior changes
- Add or update comments where helpful
- For small UI changes, include screenshots in the PR

## Release notes

Releases are drafted automatically using Release Drafter. Keep PR titles and labels accurate so they appear correctly in the changelog. See [.github/release-drafter.yml](.github/release-drafter.yml) once present.

## Getting help

- Questions: open a question issue using the template
- Troubleshooting: see [README.md](README.md) and [SUPPORT.md](SUPPORT.md)

Thank you for contributing!
