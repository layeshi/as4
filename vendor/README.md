# ALTCHA upstream snapshots

The login CAPTCHA uses unmodified files from `altcha@3.4.0` (browser) and
`altcha-lib@2.6.0` (server), both MIT licensed. Their LICENSE.txt files are
included next to the snapshots. Only the PBKDF2/SHA-256 integration is enabled.

`altcha-manifest.json` records the npm tarball URLs, published SHA-512 integrity
values, copied paths and SHA-256 file hashes. Tarball integrity was verified
before copying. No installation scripts or runtime downloads are required.
The browser snapshot lives under `public/vendor/`; server files stay outside
the public directory. Upstream code has not been edited.

To update, obtain exact-version tarballs from the official npm registry, verify
their integrity against registry metadata, review upstream changes, copy the
required files without modifications, and regenerate the manifest. Update the
versioned imports in the application together. Run the CAPTCHA security tests,
the vendor integrity test, and a real browser test under the application's CSP.

Sources:
- https://github.com/altcha-org/altcha
- https://github.com/altcha-org/altcha-lib
