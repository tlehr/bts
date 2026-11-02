# Local PDF assets

These libraries are loaded on demand by the certificate designer. Runtime use
requires no CDN or external service.

- `pdf-lib.min.js`: pdf-lib 1.17.1, reused from the local `feat/accounting-workflow`
  branch. Source: https://github.com/Hopding/pdf-lib. See `pdf-lib.LICENSE`.
- `fontkit.min.js`: @pdf-lib/fontkit 1.1.1, official npm distribution.
  Source: https://github.com/Hopding/fontkit. See `fontkit.README.md` and `fontkit.NOTICE`.
- `pdfjs/`: PDF.js 6.3.289 legacy browser build, matching worker, CMaps, standard
  fonts and WebAssembly decoders from the official `pdfjs-dist` npm distribution.
  Source: https://github.com/mozilla/pdf.js. See `pdfjs/LICENSE` and license files
  in the included asset directories. JavaScript evaluation is disabled when
  loading PDF backgrounds. No PDF scripting or interactive actions are executed.
- `../fonts/certificates/`: eight local font families with real regular and
  bold styles: DejaVu Sans, Serif and Mono, Liberation Sans and Serif, Noto
  Sans and Serif, and Yrsa. The same files supply browser preview and embedded
  PDF subsets. See that directory's `README.md`, license notices and `SHA256SUMS`.
