# Security Policy

Thank you for helping keep this project and its users safe.

## Reporting a Vulnerability

- Please report vulnerabilities privately using GitHub Security Advisories:
  - Go to the repository Security tab and choose Report a vulnerability.
  - This creates a private advisory thread with the maintainers.
- Do not open public issues for security reports.
- If you cannot access the Security tab, contact the maintainers via a private GitHub message to @senad and request an advisory be opened on your behalf.

When reporting, please include:

- A clear description of the issue and potential impact.
- Steps to reproduce, a minimal proof of concept if possible, and any affected configuration.
- Your environment details such as browser, OS, and any relevant settings.
- Any temporary mitigations you are aware of.

Please do not include secrets, credentials, or personal data in your report. If reproduction requires credentials, provide instructions to reproduce without real secrets.

## Scope

This project is a static, client-side S3 explorer:

- Runs entirely in the browser and does not persist credentials.
- Connects directly to AWS S3 using AWS SDK v2 loaded from a CDN.

Out of scope examples:

- Issues caused by misconfigured AWS IAM policies or S3 CORS on user infrastructure.
- General AWS account security posture outside of how the application uses the SDK.

See [README.md](README.md) for expected permissions and CORS configuration.

## Supported Versions

- Only the latest code on the main branch is supported for security fixes.
- Backports to older commits are not guaranteed.

If you are using a fork or pinned commit, consider updating to the latest main first to verify whether the issue persists.

## Coordinated Disclosure

- We will acknowledge receipt within a reasonable time and keep you informed of the status.
- Once a fix is prepared and merged, we will coordinate a disclosure timeline and draft release notes.
- Credit will be given to reporters who wish to be acknowledged.

## Safe Harbor

We will not pursue legal action against researchers for good-faith, non-destructive testing that:

- Respects user privacy and does not access data you do not own or have permission to test.
- Does not degrade the service for others.
- Abides by the guidelines above and uses private reporting via Security Advisories.

Thank you for your responsible disclosure and for helping improve the security of this project.
