# Support

Thank you for your interest in S3 Explorer. This document explains how to get help, where to ask questions, and how to report problems effectively.

## Before you ask

- Read the [README](README.md), especially Run locally, Usage, Security notes, Required permissions and CORS, and Troubleshooting.
- Search existing issues to see if your question or bug was already reported or answered.

## Where to get help

- Questions about how to use the app
  - Open a new issue using the Question template.
- Documentation improvements
  - Open a new issue using the Documentation Improvement template.
- Bug reports
  - Open a new issue using the Bug Report template with clear reproduction steps.
- Feature requests
  - Open a new issue using the Feature Request template.

All issue templates are available in the repository under .github/ISSUE_TEMPLATE.

## Security reports

Do not file public issues for security vulnerabilities.
Follow the process in [SECURITY.md](SECURITY.md) and report privately via GitHub Security Advisories.

## Troubleshooting quick checks

If you are experiencing connectivity, authorization, or region issues:

- Confirm you are serving the project over HTTP locally as described in [README](README.md) Run locally.
- Verify your AWS Region selection matches the actual bucket region. See Troubleshooting in [README](README.md).
- Ensure your IAM policy includes s3:ListBucket, s3:GetObject, s3:PutObject, and s3:DeleteObject for the target bucket.
- Ensure your S3 bucket CORS configuration allows browser access as noted in the Requirements modal and [README](README.md).

## Filing a great issue

Please include:

- What you expected vs what happened
- Steps to reproduce, including bucket region and example object paths if relevant
- Environment details: browser, OS, and any browser console errors
- Screenshots or short screen recordings where appropriate
- Logs or console output, redacted to remove any sensitive information

Do not include secrets or credentials in issues.

## Contributing fixes

If you intend to submit a fix or improvement:

- Follow the guidelines in [CONTRIBUTING.md](CONTRIBUTING.md)
- Run local checks with [run_tests.sh](run_tests.sh) before opening a PR
- Ensure your PR description links the related issue and includes screenshots for UI changes
- Adhere to our community guidelines in [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)

## Response expectations

This project is maintained on a best-effort basis. We try to triage new issues promptly and appreciate detailed, reproducible reports to help us help you more quickly.

Thank you for using and improving S3 Explorer.