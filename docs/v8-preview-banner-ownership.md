# V8 preview banner ownership

The V8 preview version banner belongs exclusively to the preview/build layer.

Operator-specific runtime modules must not read, rewrite, style or version `#tccPreviewBanner`.
Their internal revision identifiers remain local diagnostics only.

The release branch contains `scripts/test_v8_banner_ownership.mjs` to enforce this invariant during V8 maintenance.
