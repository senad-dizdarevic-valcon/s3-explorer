# S3 Explorer

Lightweight, single-page S3 file manager that runs entirely in the browser. It connects directly to Amazon S3 using the AWS SDK v2 from a CDN and never persists credentials.

This repository has been refactored from a single-file implementation into a small, maintainable multi-file structure without changing functionality.

## File structure

```
.
├── index.html
└── assets
    ├── css
    │   └── styles.css
    └── js
        ├── app.js
        ├── favicon.js
        └── banner-fade.js
```

- Entry point: [index.html](index.html)
- Styles: [assets/css/styles.css](assets/css/styles.css)
- Application logic: [assets/js/app.js](assets/js/app.js)
- Favicon injector: [assets/js/favicon.js](assets/js/favicon.js)
- Banner fade script: [assets/js/banner-fade.js](assets/js/banner-fade.js)

CDN dependencies loaded in head of index:
- AWS SDK v2 pinned to version 2.1488.0
- JSZip pinned to version 3.10.1

## Run locally

Some browsers block null-origin requests when opening index.html directly from the filesystem. Serve locally via loopback:

- Python 3
  - macOS/Linux:
    - Start a simple server in the project root:
      - python3 -m http.server
    - Open http://localhost:8000 in your browser
  - Windows:
    - py -3 -m http.server
    - Open http://localhost:8000

No build step is required.

## Usage

1. Open the app in your browser.
2. In the Connect form, enter:
   - Access Key ID
   - Secret Access Key
   - Region example: eu-west-1
   - Bucket example: my-s3-bucket
3. Click Connect.
   - Your credentials are only used in memory for this session and are cleared on Sign Out.

Once connected, you can:
- Browse prefixes with the breadcrumb navigation
- Filter the current page
- Upload files including multipart for large files
- Preview images and text with safe truncation
- Download a single object or multiple objects as a zip
- Create directory-like prefixes
- Delete objects and bulk delete all objects under a prefix
- Move selected objects to another prefix with conflict detection
- Switch between light and dark themes

## Accessibility and UX

- Keyboard and screen-reader friendly modals with focus traps and ESC/overlay dismissal
- Visible focus outlines configurable via CSS token
- Dark/light theme toggle persists the selection in localStorage
- Responsive layout with mobile-first design and list reflow under narrow screens
- Toast notifications and inline banners for errors and status

## Security notes

- Secrets are never persisted to disk; they live only in memory for the page session
- Secret Access Key is never logged or rendered in the UI
- Use only on trusted machines and profiles
- Ensure your S3 bucket has CORS enabled for browser access

## Required permissions and CORS

Your IAM user must have permissions for:
- s3:ListBucket
- s3:GetObject
- s3:PutObject

Minimal example policy and CORS configuration are shown in the Requirements modal within the app.

## Troubleshooting

- Region mismatch or PermanentRedirect
  - The bucket may be in a different region than selected. Choose the bucket’s actual region.
- NoSuchBucket
  - Check the bucket name spelling and that it exists.
- AccessDenied
  - The IAM policy may not allow ListBucket/GetObject/PutObject for the target bucket.
- Network / Timeout
  - Verify connectivity and retry. Some corporate networks restrict S3 endpoints.

## Notes on the refactor

- Functionality is unchanged from the single-file version.
- Inline styles were consolidated into [assets/css/styles.css](assets/css/styles.css).
- The large inline script was moved to [assets/js/app.js](assets/js/app.js).
- The favicon injector was moved to [assets/js/favicon.js](assets/js/favicon.js) and still loads in head.
- The banner fade snippet was moved to [assets/js/banner-fade.js](assets/js/banner-fade.js) and loads at the end of body.
- The early theme initialization script remains inline in head to avoid flashes of incorrect theme.
