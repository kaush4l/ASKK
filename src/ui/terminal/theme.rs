//! # Theme: the page's glass palette, in a terminal's cells
//!
//! `draw.rs` draws in a few named colours (blue for a key, dark grey for what is dim, red,
//! yellow, green and cyan for the marks) and a program's own colours as it chose them (one
//! of 256, or `#rrggbb`). A theme is a last pass over the cells: each named colour becomes
//! the page's colour for the same thing, the default ink and ground become the page's, and
//! a program's 16 base colours become the page's 16 (`--term-0`..`--term-15`). A program's
//! other colours are its own and are left as they are.
//!
//! | `terminal.theme` | is |
//! | --- | --- |
//! | `glass-dark` | the page's dark glass (`assets/styling/glass.css`, `:root`) |
//! | `glass-light` | the page's light glass (`:root[data-theme="light"]`) |
//! | `terminal` | the outer terminal's own colours: nothing is changed |
//!
//! With `terminal.colours` at `256`, each colour is sent as the nearest of the 240 a
//! terminal of 256 colours has beyond its base 16, never as `#rrggbb`.
use ratatui::prelude::{Buffer, Color, Rect};

/// The page's colours for each thing, as `0xrrggbb`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Palette {
    pub bg: u32,
    pub fg: u32,
    pub muted: u32,
    pub accent: u32,
    pub ok: u32,
    pub warn: u32,
    pub error: u32,
    pub busy: u32,
    pub sky: u32,
    /// What is written on the accent (`--press-ink`).
    pub ink: u32,
    /// `--term-0`..`--term-15`, worked out as the page's `color-mix` works them out.
    pub term: [u32; 16],
}

pub const GLASS_DARK: Palette = Palette {
    bg: 0x000000,
    fg: 0xf4efe6,
    muted: 0xa29d94,
    accent: 0xb8aef0,
    ok: 0x8cc4a4,
    warn: 0xe2c48e,
    error: 0xe59a94,
    busy: 0x9db8ef,
    sky: 0x9ec4f2,
    ink: 0x0c0a18,
    term: [0x363533, 0xe59a94, 0x8cc4a4, 0xe2c48e, 0x9db8ef, 0xe3a9c6, 0x9ec4f2, 0xbebab3, 0x8c8894, 0xeab0a0, 0x9fd3bb, 0xe8deaa, 0xa6b0f2, 0xc3b4f5, 0xb8d1ee, 0xf4efe6],
};

pub const GLASS_LIGHT: Palette = Palette {
    bg: 0xf7f3ec,
    fg: 0x1c1a24,
    muted: 0x6a6575,
    accent: 0x5d52b8,
    ok: 0x3f7a5e,
    warn: 0x8c6a2e,
    error: 0xb04a4a,
    busy: 0x4a6fb8,
    sky: 0x3f6aa0,
    ink: 0xfffcf7,
    term: [0xc7c3c0, 0xb04a4a, 0x3f7a5e, 0x8c6a2e, 0x4a6fb8, 0x9a4f74, 0x3f6aa0, 0x4c4a50, 0x7a7584, 0x9a5a46, 0x3f7a5e, 0x7a6e32, 0x4a58a8, 0x5d52b8, 0x35527b, 0x1c1a24],
};

/// A theme: a palette (none: the outer terminal's own colours), and how a colour is sent.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Theme {
    pub palette: Option<Palette>,
    pub truecolor: bool,
}

impl Default for Theme {
    fn default() -> Self {
        Theme::from(&crate::core::settings::Terminal::default())
    }
}

impl From<&crate::core::settings::Terminal> for Theme {
    fn from(t: &crate::core::settings::Terminal) -> Theme {
        let palette = match t.theme.as_str() {
            "glass-light" => Some(GLASS_LIGHT),
            "terminal" => None,
            _ => Some(GLASS_DARK),
        };
        Theme { palette, truecolor: t.colours != "256" }
    }
}

/// The nearest of the 240 colours beyond the base 16 of a terminal of 256 colours: the
/// 6 × 6 × 6 cube and the 24 greys.
pub fn nearest_256(rgb: u32) -> u8 {
    const LEVELS: [i32; 6] = [0, 95, 135, 175, 215, 255];
    let (r, g, b) = (((rgb >> 16) & 255) as i32, ((rgb >> 8) & 255) as i32, (rgb & 255) as i32);
    let step = |v: i32| LEVELS.iter().enumerate().min_by_key(|(_, l)| (v - **l).abs()).map_or(0, |(i, _)| i);
    let (ri, gi, bi) = (step(r), step(g), step(b));
    let far = |(x, y, z): (i32, i32, i32)| (r - x).pow(2) + (g - y).pow(2) + (b - z).pow(2);
    let cube = (16 + 36 * ri + 6 * gi + bi) as u8;
    let in_cube = far((LEVELS[ri], LEVELS[gi], LEVELS[bi]));
    let grey_i = (((r + g + b) / 3 - 8 + 5) / 10).clamp(0, 23);
    let grey = 8 + 10 * grey_i;
    if far((grey, grey, grey)) < in_cube {
        (232 + grey_i) as u8
    } else {
        cube
    }
}

impl Theme {
    fn colour(&self, rgb: u32) -> Color {
        if self.truecolor {
            Color::Rgb((rgb >> 16) as u8, (rgb >> 8) as u8, rgb as u8)
        } else {
            Color::Indexed(nearest_256(rgb))
        }
    }

    /// A colour of the screen as this theme shows it; `ground`: it is a cell's ground.
    pub fn map(&self, c: Color, ground: bool) -> Color {
        let Some(p) = self.palette else {
            return match c {
                Color::Rgb(r, g, b) if !self.truecolor => Color::Indexed(nearest_256(u32::from(r) << 16 | u32::from(g) << 8 | u32::from(b))),
                other => other,
            };
        };
        let rgb = match c {
            Color::Reset if ground => p.bg,
            Color::Reset => p.fg,
            Color::DarkGray => p.muted,
            Color::Blue | Color::LightBlue => p.accent,
            Color::Red | Color::LightRed => p.error,
            Color::Yellow | Color::LightYellow => p.warn,
            Color::Green | Color::LightGreen => p.ok,
            Color::Cyan | Color::LightCyan => p.sky,
            Color::Magenta | Color::LightMagenta => p.term[5],
            Color::Black => p.ink,
            Color::White | Color::Gray => p.fg,
            Color::Indexed(n) if n < 16 => p.term[usize::from(n)],
            Color::Rgb(r, g, b) => u32::from(r) << 16 | u32::from(g) << 8 | u32::from(b),
            other => return other,
        };
        self.colour(rgb)
    }

    /// Paint every cell of `area` in this theme.
    pub fn paint(&self, buf: &mut Buffer, area: Rect) {
        if self.palette.is_none() && self.truecolor {
            return;
        }
        for y in area.y..area.y + area.height {
            for x in area.x..area.x + area.width {
                let cell = &mut buf[(x, y)];
                let (fg, bg) = (self.map(cell.fg, false), self.map(cell.bg, true));
                cell.set_fg(fg).set_bg(bg);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `--name: #hex` as the page's stylesheet writes it, in the block that begins with `start`.
    fn token(css: &str, start: &str, name: &str) -> u32 {
        let block = &css[css.find(start).unwrap_or_else(|| panic!("{start}"))..];
        let at = block.find(&format!("--{name}: #")).unwrap_or_else(|| panic!("--{name} in {start}"));
        u32::from_str_radix(&block[at + name.len() + 5..at + name.len() + 11], 16).unwrap()
    }

    #[test]
    fn the_palettes_are_the_pages_glass_dark_and_light() {
        let css = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/assets/styling/glass.css"));
        for (p, start) in [(GLASS_DARK, ":root[data-theme=\"dark\"]"), (GLASS_LIGHT, ":root[data-theme=\"light\"]")] {
            let t = |n: &str| token(css, start, n);
            assert_eq!((p.bg, p.fg, p.muted, p.accent, p.ok, p.warn, p.error, p.busy, p.sky, p.ink), (t("bg"), t("fg"), t("muted"), t("accent"), t("ok"), t("warn"), t("error"), t("busy"), t("c-sky"), t("press-ink")), "{start}");
            // The base 16 the page names straight from its tokens (the others it mixes).
            for (i, name) in [(1, "error"), (2, "ok"), (3, "warn"), (4, "busy"), (5, "c-rose"), (6, "c-sky"), (8, "neutral"), (9, "c-coral"), (10, "c-mint"), (11, "c-lemon"), (12, "c-indigo"), (13, "c-violet"), (15, "fg")] {
                assert_eq!(p.term[i], t(name), "{start}: --term-{i} is --{name}");
            }
        }
    }

    #[test]
    fn a_theme_turns_the_named_colours_and_the_base_16_and_leaves_a_programs_own() {
        let dark = Theme { palette: Some(GLASS_DARK), truecolor: true };
        assert_eq!(dark.map(Color::Blue, false), Color::Rgb(0xb8, 0xae, 0xf0), "a key is the accent");
        assert_eq!((dark.map(Color::Reset, false), dark.map(Color::Reset, true)), (Color::Rgb(0xf4, 0xef, 0xe6), Color::Rgb(0, 0, 0)));
        assert_eq!(dark.map(Color::Indexed(1), false), Color::Rgb(0xe5, 0x9a, 0x94), "a program's red is the page's");
        assert_eq!(dark.map(Color::Indexed(200), false), Color::Indexed(200), "beyond 16, the program's own");
        assert_eq!(dark.map(Color::Rgb(1, 2, 3), false), Color::Rgb(1, 2, 3));
        let light = Theme { palette: Some(GLASS_LIGHT), truecolor: false };
        assert_eq!(light.map(Color::Blue, false), Color::Indexed(nearest_256(0x5d52b8)), "in 256 colours, the nearest");
        let own = Theme { palette: None, truecolor: true };
        assert_eq!((own.map(Color::Blue, false), own.map(Color::Reset, true)), (Color::Blue, Color::Reset), "`terminal`: nothing changes");
        assert_eq!(Theme { palette: None, truecolor: false }.map(Color::Rgb(255, 0, 0), false), Color::Indexed(196));
        assert_eq!((nearest_256(0x000000), nearest_256(0xffffff), nearest_256(0x808080), nearest_256(0x5f87af)), (16, 231, 244, 67));
        let mut buf = Buffer::empty(Rect::new(0, 0, 2, 1));
        buf[(0, 0)].set_fg(Color::DarkGray);
        dark.paint(&mut buf, Rect::new(0, 0, 2, 1));
        assert_eq!((buf[(0, 0)].fg, buf[(1, 0)].bg), (Color::Rgb(0xa2, 0x9d, 0x94), Color::Rgb(0, 0, 0)), "every cell, its ink and its ground");
        let t = crate::core::settings::Terminal { theme: "glass-light".into(), colours: "256".into(), ..Default::default() };
        assert_eq!(Theme::from(&t), light);
        assert_eq!(Theme::default(), dark, "the page's dark glass, in true colour, unless settings.json says otherwise");
    }
}
