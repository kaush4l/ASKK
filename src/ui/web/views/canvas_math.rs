//! Canvas math, pure (ported from the archived canvas.js): every engine is a frame in world space;
//! a camera {x, y, z} maps world to screen (screen = world * z + (x, y)). Frames are laid out as a
//! tidy tree: parents above their children, siblings side by side, nothing overlapping.

pub const MIN_Z: f64 = 0.1;
pub const MAX_Z: f64 = 2.5;
/// Gap between frames, in world units.
pub const GAP: f64 = 48.0;
/// A frame's size in world units.
pub const FRAME_W: f64 = 300.0;
pub const FRAME_H: f64 = 200.0;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Camera {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

impl Default for Camera {
    fn default() -> Self {
        Self { x: 0.0, y: 0.0, z: 1.0 }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

pub fn clamp_zoom(z: f64) -> f64 {
    z.clamp(MIN_Z, MAX_Z)
}

/// Zoom by `factor`, keeping the screen point (px, py) fixed.
pub fn zoom_at(cam: Camera, factor: f64, px: f64, py: f64) -> Camera {
    let z = clamp_zoom(cam.z * factor);
    let k = z / cam.z;
    Camera { x: px - (px - cam.x) * k, y: py - (py - cam.y) * k, z }
}

/// Move the camera by a screen-space drag.
pub fn pan(cam: Camera, dx: f64, dy: f64) -> Camera {
    Camera { x: cam.x + dx, y: cam.y + dy, ..cam }
}

#[cfg_attr(not(test), allow(dead_code))]
pub fn overlaps(a: &Rect, b: &Rect, gap: f64) -> bool {
    a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap
}

/// The box around `rects`; None when empty.
pub fn bounds(rects: &[Rect]) -> Option<Rect> {
    let first = rects.first()?;
    let (mut x0, mut y0, mut x1, mut y1) = (first.x, first.y, first.x + first.w, first.y + first.h);
    for r in rects {
        x0 = x0.min(r.x);
        y0 = y0.min(r.y);
        x1 = x1.max(r.x + r.w);
        y1 = y1.max(r.y + r.h);
    }
    Some(Rect { x: x0, y: y0, w: x1 - x0, h: y1 - y0 })
}

/// Parent of each path (depth-first list of `a`, `a/b`, ...): the longest other path that is a
/// `/`-prefix of it.
pub fn parents(paths: &[String]) -> Vec<Option<usize>> {
    paths
        .iter()
        .map(|p| {
            paths
                .iter()
                .enumerate()
                .filter(|(_, q)| q.len() < p.len() && p.starts_with(q.as_str()) && p.as_bytes()[q.len()] == b'/')
                .max_by_key(|(_, q)| q.len())
                .map(|(i, _)| i)
        })
        .collect()
}

/// Pack subtrees (each a list of (index, rect) with its root first, at y 0) left to right, each as
/// far left as its contour allows. Returns the packed rects and each subtree's root rect.
fn pack(subs: Vec<Vec<(usize, Rect)>>, gap: f64) -> (Vec<(usize, Rect)>, Vec<Rect>) {
    let mut out: Vec<(usize, Rect)> = vec![];
    let mut roots = vec![];
    for sub in subs {
        let mut dx = 0.0;
        if !out.is_empty() {
            let mut best = f64::NEG_INFINITY;
            for (_, a) in &out {
                for (_, b) in &sub {
                    if a.y < b.y + b.h + gap && b.y < a.y + a.h + gap {
                        best = best.max(a.x + a.w + gap - b.x);
                    }
                }
            }
            if best.is_finite() {
                dx = best;
            }
        }
        let start = out.len();
        out.extend(sub.into_iter().map(|(i, r)| (i, Rect { x: r.x + dx, ..r })));
        roots.push(out[start].1);
    }
    (out, roots)
}

fn tree(i: usize, kids: &[Vec<usize>], size: Rect, gap: f64) -> Vec<(usize, Rect)> {
    let me = Rect { x: 0.0, y: 0.0, w: size.w, h: size.h };
    if kids[i].is_empty() {
        return vec![(i, me)];
    }
    let subs = kids[i]
        .iter()
        .map(|&k| tree(k, kids, size, gap).into_iter().map(|(j, r)| (j, Rect { y: r.y + size.h + gap, ..r })).collect())
        .collect();
    let (out, roots) = pack(subs, gap);
    let (a, b) = (roots[0], roots[roots.len() - 1]);
    let mid = (a.x + a.w / 2.0 + b.x + b.w / 2.0) / 2.0;
    let mut all = vec![(i, Rect { x: mid - size.w / 2.0, ..me })];
    all.extend(out);
    let min_x = all.iter().map(|(_, r)| r.x).fold(f64::INFINITY, f64::min);
    all.into_iter().map(|(j, r)| (j, Rect { x: r.x - min_x, ..r })).collect()
}

/// A rect for every path (same order): top-level engines side by side, each child row below its
/// parent, each subtree packed against its neighbours, a parent centred over its children.
pub fn auto_layout(paths: &[String], w: f64, h: f64, gap: f64) -> Vec<Rect> {
    let par = parents(paths);
    let mut kids = vec![vec![]; paths.len()];
    for (i, p) in par.iter().enumerate() {
        if let Some(p) = p {
            kids[*p].push(i);
        }
    }
    let size = Rect { x: 0.0, y: 0.0, w, h };
    let subs = (0..paths.len()).filter(|&i| par[i].is_none()).map(|i| tree(i, &kids, size, gap)).collect();
    let (out, _) = pack(subs, gap);
    let mut rects = vec![size; paths.len()];
    for (i, r) in out {
        rects[i] = r;
    }
    rects
}

/// Edges parent -> child, as (parent, child) indices.
pub fn edges(paths: &[String]) -> Vec<(usize, usize)> {
    parents(paths).into_iter().enumerate().filter_map(|(c, p)| p.map(|p| (p, c))).collect()
}

/// SVG path for a child edge: the parent's bottom centre to the child's top centre, as a curve.
pub fn edge_path(a: &Rect, b: &Rect) -> String {
    let (x1, y1, x2, y2) = (a.x + a.w / 2.0, a.y + a.h, b.x + b.w / 2.0, b.y);
    let k = (GAP / 2.0).max((y2 - y1).abs() / 2.0);
    format!("M{x1:.1} {y1:.1}C{x1:.1} {:.1},{x2:.1} {:.1},{x2:.1} {y2:.1}", y1 + k, y2 - k)
}

/// The camera that shows every rect inside a viewport (vw, vh) with a margin; zoom clamped, at most `max`.
pub fn fit_camera(rects: &[Rect], vw: f64, vh: f64, margin: f64, max: f64) -> Camera {
    let Some(b) = bounds(rects) else { return Camera::default() };
    if vw <= 0.0 || vh <= 0.0 {
        return Camera::default();
    }
    let z = clamp_zoom(((vw - margin * 2.0) / b.w.max(1.0)).min((vh - margin * 2.0) / b.h.max(1.0)).min(max));
    Camera { x: (vw - b.w * z) / 2.0 - b.x * z, y: (vh - b.h * z) / 2.0 - b.y * z, z }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn zoom_clamps_and_keeps_cursor_fixed() {
        let c = Camera { x: 10.0, y: 20.0, z: 1.0 };
        let n = zoom_at(c, 2.0, 100.0, 50.0);
        assert_eq!(n.z, 2.0);
        // the world point under the cursor stays under it
        let (wx, wy) = ((100.0 - c.x) / c.z, (50.0 - c.y) / c.z);
        assert!((wx * n.z + n.x - 100.0).abs() < 1e-9 && (wy * n.z + n.y - 50.0).abs() < 1e-9);
        assert_eq!(zoom_at(c, 100.0, 0.0, 0.0).z, MAX_Z);
        assert_eq!(zoom_at(c, 0.001, 0.0, 0.0).z, MIN_Z);
    }

    #[test]
    fn pan_moves_camera() {
        assert_eq!(pan(Camera::default(), 5.0, -3.0), Camera { x: 5.0, y: -3.0, z: 1.0 });
    }

    #[test]
    fn parents_from_paths() {
        let ps = p(&["a", "a/b", "a/b/c", "ab", "a/d"]);
        assert_eq!(parents(&ps), vec![None, Some(0), Some(1), None, Some(0)]);
        assert_eq!(edges(&ps), vec![(0, 1), (1, 2), (0, 4)]);
    }

    #[test]
    fn layout_tree_parent_above_no_overlap() {
        let ps = p(&["a", "a/b", "a/b/c", "a/d", "e", "e/f"]);
        let r = auto_layout(&ps, 100.0, 50.0, 10.0);
        for (par, c) in edges(&ps) {
            assert!(r[par].y + r[par].h <= r[c].y, "parent above child");
        }
        // parent centred over its children
        let mid = |x: &Rect| x.x + x.w / 2.0;
        assert!((mid(&r[0]) - (mid(&r[1]) + mid(&r[3])) / 2.0).abs() < 1e-9);
        for i in 0..r.len() {
            for j in i + 1..r.len() {
                assert!(!overlaps(&r[i], &r[j], 0.0), "{i} overlaps {j}");
            }
        }
        // roots on one row
        assert_eq!(r[0].y, r[4].y);
    }

    #[test]
    fn fit_shows_everything() {
        let ps = p(&["a", "b", "c"]);
        let r = auto_layout(&ps, 100.0, 50.0, 10.0);
        let c = fit_camera(&r, 400.0, 300.0, 10.0, 1.25);
        let b = bounds(&r).unwrap();
        assert!(b.x * c.z + c.x >= 0.0 && (b.x + b.w) * c.z + c.x <= 400.0 + 1e-9);
        assert_eq!(fit_camera(&[], 1.0, 1.0, 0.0, 1.0), Camera::default());
    }

    #[test]
    fn edge_path_runs_bottom_to_top() {
        let a = Rect { x: 0.0, y: 0.0, w: 100.0, h: 50.0 };
        let b = Rect { x: 0.0, y: 100.0, w: 100.0, h: 50.0 };
        assert!(edge_path(&a, &b).starts_with("M50.0 50.0C"));
        assert!(edge_path(&a, &b).ends_with("50.0 100.0"));
    }
}
