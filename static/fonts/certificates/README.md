# Certificate fonts

BTS ships these unmodified TrueType files in regular and bold styles. The
designer uses the same files for SVG preview metrics, browser rendering and
embedded PDF text. It does not use locally installed fonts, CDN requests or
synthetic bold. Only faces used in the current preview or output are loaded.
PDF output contains embedded glyph subsets and does not require recipients
to install fonts. Screen antialiasing can still differ by device or browser.

| Families | Version | Source package | Included license |
| --- | --- | --- | --- |
| DejaVu Sans, DejaVu Serif, DejaVu Sans Mono | 2.37 | Debian/Ubuntu `fonts-dejavu-core`, `fonts-dejavu-mono` | [LICENSE](LICENSE) and [DEJAVU-UPSTREAM-LICENSE](DEJAVU-UPSTREAM-LICENSE), including Bitstream Vera and Arev notices |
| Liberation Sans, Liberation Serif | 2.1.5 | Debian/Ubuntu `fonts-liberation` | [LIBERATION-LICENSE](LIBERATION-LICENSE), SIL Open Font License 1.1 |
| Noto Sans, Noto Serif | 2.004 | Debian/Ubuntu `fonts-noto-core` | [NOTO-LICENSE](NOTO-LICENSE), SIL Open Font License 1.1 |
| Yrsa | 2.004 | Debian/Ubuntu `fonts-yrsa-rasa` | [YRSA-LICENSE](YRSA-LICENSE), SIL Open Font License 1.1 |

The included notices retain the attribution and complete license terms from
the source packages. The OFL permits bundling and embedding subject to its
conditions, including retaining the copyright and license notices. DejaVu's
license permits redistribution with its notices. The fonts are distributed
as part of BTS, without modifying their binaries or reserved font names.
CSS family aliases used by BTS do not rename the font binaries.

Upstream sources and license texts checked on 2026-11-02:

- [DejaVu](https://dejavu-fonts.github.io/),
  [license](https://dejavu-fonts.github.io/License.html).
- [Liberation](https://github.com/liberationfonts/liberation-fonts),
  [license](https://github.com/liberationfonts/liberation-fonts/blob/main/LICENSE).
- [Noto](https://github.com/notofonts/noto-fonts),
  [license](https://github.com/notofonts/noto-fonts/blob/main/LICENSE).
- [Yrsa](https://github.com/rosettatype/yrsa-rasa),
  [license](https://github.com/rosettatype/yrsa-rasa/blob/master/OFL.txt).

[SHA256SUMS](SHA256SUMS) identifies the exact distributed font files. The
source font files also permit embedding and subsetting in their OS/2 flags;
tests check those flags, the available accented Latin characters and actual
PDF font-file embedding for all sixteen faces. Existing `sans` and `serif`
template identifiers keep their original DejaVu files and typography.
