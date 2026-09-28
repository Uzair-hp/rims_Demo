"""
Ruchita Interiors — PWA icon + brand lockup generator.

Renders every raster asset the app shell and the PWA manifest need from the
official vector logo, so the whole set can be rebuilt whenever the logo changes:

    node scripts/optimize_logo.mjs      # brand/logo.svg -> frontend/public/brand/logo.svg
    python scripts/generate_brand_icons.py

Inputs:
    brand/logo.svg                        official source, as supplied

Outputs (all committed, so a fresh clone never needs a rasteriser):
    frontend/public/brand/logo.svg   the shipped vector lockup
    frontend/public/icons/icon-192.png   manifest icon, purpose "any"
    frontend/public/icons/icon-512.png   manifest icon, purpose "any"
    frontend/public/icons/icon-maskable-192.png   manifest icon, "maskable"
    frontend/public/icons/icon-maskable-512.png   manifest icon, "maskable"
    frontend/public/icons/apple-touch-icon-180.png  iOS home screen (opaque)
    frontend/public/icons/favicon-32.png  browser tab
    frontend/public/icons/favicon.ico     16/32/48 multi-resolution icon

Why the work is split this way: `brand/logo.svg` is an automatic raster trace,
so it arrives around 2 MB of thousands of anti-aliasing shards. `optimize_logo.mjs`
reduces that to a shippable vector first, and this script only has to place that
vector on a canvas. Both steps are pure build tooling — nothing here is bundled
or shipped, and the app never needs a rasteriser to run.

The app renders the SVG directly via `BrandLockup.jsx`; these PNGs exist for the
places that cannot take a vector (iOS home screen, favicon, manifest icons).

Brand rules (PLAN §18.4, §17):
  * gold and near-black only — the icon is a brand moment, not a status colour
  * ink background --ink so the icon matches the manifest theme_color
  * the lockup is letterboxed on ink rather than cropped, which would cut the
    mark apart
  * maskable icons keep the mark inside the safe circle (central 80% of the
    canvas) so Android can crop it to any shape without clipping
"""

from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

try:
    from PIL import Image
except ImportError:  # pragma: no cover - developer convenience guard
    sys.exit("Pillow is required to regenerate icons: pip install Pillow")

REPO_ROOT = Path(__file__).resolve().parents[1]
SOURCE = REPO_ROOT / "brand" / "logo.svg"
OPTIMISED = REPO_ROOT / "frontend" / "public" / "brand" / "logo.svg"
ICON_OUT = REPO_ROOT / "frontend" / "public" / "icons"

# --ink from styles/tokens.css (PLAN §17 manifest theme colour).
INK = (22, 19, 15, 255)

# Fraction of the canvas the lockup occupies, per icon kind.
LAYOUT = {
    "any": 0.86,  # manifest icon: generous but confident
    "maskable": 0.60,  # stays well inside the 80% safe circle
    "apple": 0.80,  # iOS masks corners slightly
    "favicon": 0.92,  # small sizes need the mark as large as possible
}

# Rasterise well above the largest output so downscaling still filters cleanly.
SUPERSAMPLE = 4


def ensure_optimised() -> None:
    """Run the optimiser if the shipped vector is missing or out of date."""
    if not SOURCE.exists():
        sys.exit(f"Source logo not found: {SOURCE}")
    if OPTIMISED.exists() and OPTIMISED.stat().st_mtime >= SOURCE.stat().st_mtime:
        return
    print("  shipped vector is missing or stale, re-running the optimiser")
    subprocess.run(
        ["node", str(REPO_ROOT / "scripts" / "optimize_logo.mjs")],
        cwd=REPO_ROOT,
        check=True,
    )


def load_mark() -> Image.Image:
    """Rasterise the optimised SVG, then trim fully transparent padding."""
    if not OPTIMISED.exists():
        sys.exit(f"Optimised logo not found: {OPTIMISED}")
    width, height = view_box_size()
    scale = SUPERSAMPLE * 1200 / width
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as handle:
        temp = Path(handle.name)
    try:
        render_svg(OPTIMISED, int(width * scale), int(height * scale), temp)
        with Image.open(temp) as raw:
            mark = raw.convert("RGBA")
    finally:
        temp.unlink(missing_ok=True)

    bbox = mark.getbbox()
    if bbox is None:
        sys.exit("Source logo is fully transparent; nothing to render.")
    return mark.crop(bbox)


def view_box_size() -> tuple[int, int]:
    """Read width/height out of the SVG's viewBox without a parser dependency."""
    import re

    head = OPTIMISED.read_text(encoding="utf-8")[:600]
    match = re.search(r'viewBox="[\d.\-]+ [\d.\-]+ ([\d.]+) ([\d.]+)"', head)
    if match is None:
        sys.exit(f"No usable viewBox in {OPTIMISED}")
    return float(match.group(1)), float(match.group(2))


def render_svg(source: Path, width: int, height: int, target: Path) -> None:
    """Rasterise via resvg, which ships a prebuilt binary and needs no cairo.

    Pillow cannot read SVG and cairosvg needs the native cairo C library, which
    is not present on a stock Windows install, so the render is delegated to
    resvg through a small Node helper. `height` is unused because resvg derives
    it from the viewBox aspect; the parameter is kept for call-site clarity.
    """
    del height
    result = subprocess.run(
        ["node", str(REPO_ROOT / "scripts" / "rasterise_logo.mjs"), str(source), str(target), str(width)],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        sys.exit(f"SVG rasterisation failed:\n{result.stderr.strip() or result.stdout.strip()}")


def render(mark: Image.Image, size: int, fill_ratio: float, background) -> Image.Image:
    """Scale the mark to `fill_ratio` of `size` and place it on a canvas.

    Opaque background (square app icon): the mark is centred on a `size` square.
    """
    target_w = max(1, int(size * fill_ratio))
    target_h = max(1, round(mark.height * target_w / mark.width))
    scaled = mark.resize((target_w, target_h), Image.LANCZOS)

    canvas = Image.new("RGBA", (size, size), background)
    canvas.alpha_composite(scaled, ((size - target_w) // 2, (size - target_h) // 2))
    return canvas


def save_png(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, "PNG", optimize=True)
    print(f"  {path.relative_to(REPO_ROOT)}  {path.stat().st_size / 1024:6.1f} KB")


def save_ico(images: list[Image.Image], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    images[0].save(path, format="ICO", sizes=[(16, 16), (32, 32), (48, 48)])
    print(f"  {path.relative_to(REPO_ROOT)}  {path.stat().st_size / 1024:6.1f} KB")


def main() -> None:
    ensure_optimised()
    mark = load_mark()
    print(f"source: {SOURCE.relative_to(REPO_ROOT)}  mark {mark.width}x{mark.height} trimmed")

    for size in (192, 512):
        save_png(render(mark, size, LAYOUT["any"], INK), ICON_OUT / f"icon-{size}.png")
        save_png(
            render(mark, size, LAYOUT["maskable"], INK),
            ICON_OUT / f"icon-maskable-{size}.png",
        )

    save_png(render(mark, 180, LAYOUT["apple"], INK), ICON_OUT / "apple-touch-icon-180.png")
    save_png(render(mark, 32, LAYOUT["favicon"], INK), ICON_OUT / "favicon-32.png")
    save_ico([render(mark, 48, LAYOUT["favicon"], INK)], ICON_OUT / "favicon.ico")

    print("done")


if __name__ == "__main__":
    main()
