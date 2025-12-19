# Pull Request

## Summary

Describe the change and the motivation. Link to any relevant context.

- Related issue: Closes #<issue_number>

## Screenshots or Recordings

If the UI changes, include before or after screenshots or a short recording.

## How to Test

Describe manual testing steps, including serving locally:

- python3 -m http.server
- Open http://localhost:8000

List key scenarios to verify.

## Checklist

- [ ] I ran local checks with [./run_tests.sh](run_tests.sh) and they passed
- [ ] CI checks in [.github/workflows/ci.yml](.github/workflows/ci.yml) pass after pushing
- [ ] I updated [README.md](README.md) and other docs if user-facing behavior changed
- [ ] I did not include any secrets, credentials, or personal data in code, logs, or screenshots
- [ ] I considered accessibility and followed the guidance in [README.md](README.md)
- [ ] I labeled this PR appropriately bug, feature, documentation, internal

## Type of Change

Select one or more:

- [ ] Feature
- [ ] Bug fix
- [ ] Documentation
- [ ] Internal maintenance or refactor
- [ ] Security

## Notes for Reviewers

Call out anything specific you would like reviewers to focus on, tricky areas, or follow-up items.

## Additional Context

Add any additional context, links, or references that help understand the change.
