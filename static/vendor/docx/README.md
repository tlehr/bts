# Local DOCX assets

`dist/index.umd.cjs`, `dist/shapes.umd.cjs` and `LICENSE` from
the official npm package `docx@9.16.0` (MIT).
The bundles use a `.js` suffix here so static servers send JavaScript MIME types.

- Source: https://github.com/dolanmiu/docx
- Distribution: https://registry.npmjs.org/docx/-/docx-9.16.0.tgz
- npm integrity: `sha512-fvAuqxV0705bEQ9OGPLt6onJqufGJTMS+b7PtRxNktea+iPWYgc1zO+OQBMW9ZmRLj9THTnOeiAoxTDz2ub0Fw==`

The local package manifest maps the two bundled modules for Node tests.
The browser loads them in order, on the first DOCX export, through
`btsLibraries.docx()`. No CDN or external conversion service is used.

Local patch in `shapes.umd.js`: `createAutofit` emits `a:noAutofit` when
`resizeShapeToFitText` or `shrinkTextOnOverflow` is explicitly `false` and neither
is enabled. This preserves the fixed certificate field dimensions explicitly
instead of leaving the Office application to infer them. Other options retain
the upstream behavior. `test/test_certificate_docx.js` covers this XML output.
