//! # The kit: standard components
//!
//! One set of standard parts (button, card, badge, tabs...) for every place the app is drawn:
//! a browser, the Mac app, a phone or tablet. They are taken from rust-ui.com, a registry
//! whose parts are copied in rather than depended on, so each file here is ours to change.
//!
//! How the kit fits the rest of `ui/`:
//!
//! | layer | where | what it holds |
//! | --- | --- | --- |
//! | tokens | `assets/styling/glass.css` (`:root`) | every colour, size and motion, once |
//! | kit | this folder | standard parts; they name tokens, never colours |
//! | components | `ui/components/` | this app's own parts (sidebar, top bar...), made of kit parts |
//! | views | `ui/views/` | pages, made of components |
//!
//! The kit's looks are Tailwind classes. `tailwind.css` (repository root) maps every colour
//! the kit names onto a glass token, and `dx` writes `assets/tailwind.css` from it.
//!
//! To add a part: copy its file from the registry into this folder, keep the first line that
//! says where it came from, give its root a `data-name`, and add it below.
mod badge;
mod button;
mod card;
mod tabs;
#[allow(unused_imports)]
pub use badge::{Badge, BadgeSize, BadgeVariant};
#[allow(unused_imports)]
pub use button::{Button, ButtonSize, ButtonVariant};
#[allow(unused_imports)]
pub use card::{Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardItem, CardList, CardSize, CardTitle};
#[allow(unused_imports)]
pub use tabs::{Tabs, TabsContent, TabsList, TabsOrientation, TabsTrigger, TabsVariant};
