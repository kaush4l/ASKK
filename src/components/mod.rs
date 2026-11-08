//! Components: one file each, smallest first. Pages assemble them.
mod wall;
pub use wall::Wall;
mod surface;
pub use surface::{Glass, Pane};
mod sidebar;
pub use sidebar::Sidebar;
mod topbar;
pub use topbar::Topbar;
mod stat;
pub use stat::Stat;
mod icon;
pub use icon::{Icon, ICONS};
