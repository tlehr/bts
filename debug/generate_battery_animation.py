"""Regenerate the decorative battery GIFs: python3 debug/generate_battery_animation.py.

Requires Pillow for regeneration only; BTS serves the resulting files directly.
Every meter of a size shares its image. The true charge is drawn separately in CSS.
"""
from pathlib import Path

from PIL import Image, ImageDraw


def ease(value):
    """CSS ease-in-out: cubic-bezier(.42, 0, .58, 1)."""
    low, high = 0.0, 1.0
    for _ in range(30):
        t = (low + high) / 2
        x = 3 * (1 - t)**2 * t * .42 + 3 * (1 - t) * t*t * .58 + t**3
        if x < value:
            low = t
        else:
            high = t
    return 3 * (1 - t) * t*t + t**3


def generate(directory, width, height, name):
    frames = []
    # 60 sampling points at most 25 fps, including the pauses at either end.
    for index in range(60):
        phase = index / 60
        fraction = 0 if phase <= .12 else 1 if phase >= .88 else ease((phase - .12) / .76)
        filled = round(width * fraction)
        frame = Image.new('P', (width, height), 0)
        frame.putpalette([0, 0, 0, 185, 223, 199] + [0, 0, 0] * 254)
        if filled:
            ImageDraw.Draw(frame).rectangle((0, 0, filled - 1, height - 1), fill=1)
        frames.append(frame)
    filename = directory / name
    frames[0].save(filename, save_all=True, append_images=frames[1:], duration=40,
                   loop=0, transparency=0, disposal=2, optimize=True)
    # Confirm that transparent resets do not leave the previous cycle filled.
    with Image.open(filename) as animation:
        duration, levels = 0, []
        for index in range(animation.n_frames):
            animation.seek(index)
            decoded = animation.convert('RGBA')
            pixels = [decoded.getpixel((x, height // 2)) for x in range(width)]
            level = sum(pixel[3] != 0 for pixel in pixels)
            assert all(pixel == (185, 223, 199, 255) for pixel in pixels[:level])
            assert all(pixel[3] == 0 for pixel in pixels[level:])
            levels.append(level)
            duration += animation.info['duration']
        assert animation.size == (width, height) and duration == 2400
        assert animation.info['loop'] == 0 and levels[0] == 0 and levels[-1] == width
    print(f'{filename.name}: {filename.stat().st_size} bytes, {width} x {height}, 2.4 seconds')


if __name__ == '__main__':
    output = Path(__file__).resolve().parents[1] / 'static' / 'images'
    output.mkdir(exist_ok=True)
    generate(output, 100, 30, 'battery-charge.gif')
    generate(output, 50, 15, 'battery-charge-small.gif')
