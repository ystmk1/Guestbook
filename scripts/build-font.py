"""
SM3신중고딕 → 웹폰트(woff2) 조각내기

한글 11,172자를 통째로 넣으면 1MB 를 넘고, 그게 다 받아지기 전에는
글자가 안 그려진다. 유니코드 구간별로 잘라두면 브라우저가 그 페이지에
실제로 쓰인 글자가 속한 조각만 골라 받는다.

모눈에 적히는 건 숫자뿐이라 첫 화면은 라틴 조각(수 KB) 하나로 끝난다.
한글은 방명록에 글이 올라올 때 그 글자가 든 조각만 뒤늦게 받아진다.

    python scripts/build-font.py "SM3신중고딕-03.otf"

결과
    public/fonts/sm3-*.woff2
    src/font.css          @font-face 규칙
"""

import subprocess
import sys
from pathlib import Path

from fontTools.pens.boundsPen import BoundsPen
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "public" / "fonts"
CSS_PATH = ROOT / "src" / "font.css"

FAMILY = "SM3SJGothic"

# 한글 음절 U+AC00–D7A3 을 몇 조각으로 자를지.
# 조각이 잘수록 한 조각이 작아지지만 요청 수가 늘어난다.
HANGUL_CHUNKS = 30

HANGUL_START = 0xAC00
HANGUL_END = 0xD7A3


def ranges_to_css(ranges):
    out = []
    for lo, hi in ranges:
        out.append(f"U+{lo:04X}" if lo == hi else f"U+{lo:04X}-{hi:04X}")
    return ", ".join(out)


def ranges_to_unicodes(ranges):
    return ",".join(f"{lo:04X}-{hi:04X}" for lo, hi in ranges)


def drawable(src: Path, lo: int, hi: int):
    """
    lo~hi 구간에서 '실제로 외곽선이 있는' 코드포인트만 골라 낸다.

    SM3신중고딕-03 은 한글 11,172자가 모두 cmap 에 들어있지만 그중
    8,822자는 charstring 이 endchar 뿐인 빈 글리프다. 실제로 그려지는 건
    KS X 1001 완성형 2,350자뿐이다.

    빈 글리프까지 unicode-range 에 넣으면 브라우저는 이 폰트가 그 글자를
    가졌다고 믿고 대체 폰트로 넘어가지 않는다. 그러면 방문자가 그 글자를
    쳤을 때 두부(□)도 아니고 아무것도 안 보인 채 사라진다.
    그래서 그릴 수 있는 것만 범위에 넣어 나머지는 대체 폰트로 넘긴다.
    """
    font = TTFont(src, lazy=True)
    cmap = font.getBestCmap()
    glyphs = font.getGlyphSet()

    out = []
    for cp in range(lo, hi + 1):
        gn = cmap.get(cp)
        if gn is None:
            continue
        pen = BoundsPen(glyphs)
        glyphs[gn].draw(pen)
        if pen.bounds is not None:
            out.append(cp)
    font.close()
    return out


def to_ranges(codepoints):
    """정렬된 코드포인트 목록을 연속 구간으로 묶는다."""
    out = []
    for cp in codepoints:
        if out and cp == out[-1][1] + 1:
            out[-1][1] = cp
        else:
            out.append([cp, cp])
    return [(a, b) for a, b in out]


def build_slices(src: Path):
    """(이름, [(lo, hi), ...]) 목록. 앞에 오는 것부터 먼저 필요해진다."""
    slices = []

    # 0 — 라틴/숫자/기본 문장부호. 첫 화면에 필요한 전부.
    slices.append(
        (
            "latin",
            [
                (0x0020, 0x007E),
                (0x00A0, 0x00FF),
                (0x2010, 0x2027),
                (0x2030, 0x205E),
                (0x20A0, 0x20BF),
                (0x2190, 0x2193),
                (0x2212, 0x2212),
            ],
        )
    )

    # 1 — 한글 자모와 CJK 문장부호, 전각
    slices.append(
        (
            "kr-sym",
            [
                (0x1100, 0x11FF),
                (0x3000, 0x303F),
                (0x3130, 0x318F),
                (0xA960, 0xA97F),
                (0xD7B0, 0xD7FF),
                (0xFF01, 0xFF5E),
                (0xFFE0, 0xFFE6),
            ],
        )
    )

    # 2.. — 실제로 그려지는 한글만 모아 균등하게 자른다
    usable = drawable(src, HANGUL_START, HANGUL_END)
    print(f"한글 그릴 수 있는 글자 {len(usable)} / {HANGUL_END - HANGUL_START + 1}")

    size = -(-len(usable) // HANGUL_CHUNKS)  # 올림
    for i in range(HANGUL_CHUNKS):
        part = usable[i * size : (i + 1) * size]
        if not part:
            break
        slices.append((f"kr-{i:02d}", to_ranges(part)))

    return slices


def main():
    if len(sys.argv) < 2:
        print("사용법: python scripts/build-font.py <원본.otf>")
        return 1

    src = Path(sys.argv[1])
    if not src.exists():
        print(f"원본을 찾을 수 없다: {src}")
        return 1

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for old in OUT_DIR.glob("sm3-*.woff2"):
        old.unlink()

    css = [
        "/* =====================================================================",
        "   SM3신중고딕-03 — scripts/build-font.py 가 만든 파일이다. 직접 고치지 말 것.",
        "",
        "   유니코드 구간별로 잘려 있어서 브라우저는 실제로 쓰인 글자가 속한",
        "   조각만 받는다. 모눈은 숫자뿐이라 첫 화면은 latin 조각 하나로 끝난다.",
        "   ===================================================================== */",
        "",
    ]

    total_bytes = 0
    made = 0

    for name, ranges in build_slices(src):
        out = OUT_DIR / f"sm3-{name}.woff2"
        cmd = [
            sys.executable,
            "-m",
            "fontTools.subset",
            str(src),
            f"--unicodes={ranges_to_unicodes(ranges)}",
            "--flavor=woff2",
            "--layout-features=*",
            "--no-hinting",
            "--desubroutinize",
            "--drop-tables+=DSIG",
            f"--output-file={out}",
        ]
        subprocess.run(cmd, check=True, capture_output=True)

        # 해당 구간에 글자가 하나도 없으면 만들지 않는다
        if out.stat().st_size < 900:
            out.unlink()
            continue

        size = out.stat().st_size
        total_bytes += size
        made += 1

        css.append("@font-face {")
        css.append(f'  font-family: "{FAMILY}";')
        css.append("  font-style: normal;")
        css.append("  font-weight: 400;")
        css.append("  font-display: swap;")
        css.append(f'  src: url("/fonts/{out.name}") format("woff2");')
        css.append(f"  unicode-range: {ranges_to_css(ranges)};")
        css.append("}")
        css.append("")

        print(f"  {out.name:<18} {size/1024:7.1f} KB")

    CSS_PATH.write_text("\n".join(css), encoding="utf-8")

    print()
    print(f"조각 {made}개 · 합계 {total_bytes/1024/1024:.2f} MB")
    print(f"원본 {src.stat().st_size/1024/1024:.2f} MB")
    print(f"→ {CSS_PATH.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
