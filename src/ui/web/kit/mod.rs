//! # The kit: standard components
//!
//! One set of standard parts (button, card, tabs, collapsible, textarea...) for every place the app is drawn:
//! a browser, the Mac app, a phone or tablet. They are taken from rust-ui.com, a registry
//! whose parts are copied in rather than depended on, so each file here is ours to change.
//!
//! How the kit fits the rest of `ui/`:
//!
//! | layer | where | what it holds |
//! | --- | --- | --- |
//! | tokens | `assets/styling/glass.css` (`:root`) | every colour, size and motion, once |
//! | kit | this folder | standard parts; they name tokens, never colours |
//! | components | `ui/web/components/` | this app's own parts (sidebar, top bar, a turn, a run...), made of kit parts; each is given the object it shows |
//! | views | `ui/web/views/` | pages, made of components; a view asks, a component shows |
//!
//! The kit's looks are Tailwind classes. `tailwind.css` (repository root) maps every colour
//! the kit names onto a glass token, and `dx` writes `assets/tailwind.css` from it.
//!
//! To add a part: copy its file from the registry
//! (`app_crates/registry/src/ui/<part>.rs` in github.com/rust-ui/ui) into this folder, keep the
//! first line that says where it came from and what was changed, give its root a `data-name`,
//! and add it below. Fix what the original lacks (a role, a label, the keyboard) in our copy.
//!
//! One trap: the pages' own stylesheet has classes with short names (`grid`, `grow`, `row`,
//! `stack`...), and a page class always wins over a kit class of the same name. A kit part
//! that needs such a utility writes it out (`[display:grid]`, `inline-grid`) instead.
//!
//! How a part moves is not its own choice: it names the motion tokens (`--motion-*`,
//! `--ease-*`, `--press-scale`), so the whole app speeds up, slows down or stands still together
//! (`docs/components.md`, "Motion").
//!
//! | part | what it is |
//! | --- | --- |
//! | `avatar` | a small circle standing for someone: a letter, an emoji, with a state dot |
//! | `badge` | a word in a pill |
//! | `button` | something to press |
//! | `card` | a surface that holds one thing |
//! | `collapsible` | a part that opens and closes on a press |
//! | `dialog` | something over the whole page that is answered or closed before the page is used again |
//! | `kbd` | a key of the keyboard, as text |
//! | `scroll_area` | an area that scrolls inside itself |
//! | `separator` | a thin line between two things |
//! | `skeleton` | the grey shape of something not yet there |
//! | `spinner` | a turning ring: something is being waited for |
//! | `tabs` | several pages in one place, one shown at a time |
//! | `textarea` | a box to type several lines in |
//! | `tooltip` | a few words that appear beside what they describe |
mod avatar;
mod badge;
mod button;
mod card;
mod collapsible;
mod dialog;
mod kbd;
mod scroll_area;
mod separator;
mod skeleton;
mod spinner;
mod tabs;
mod textarea;
mod tooltip;
#[allow(unused_imports)]
pub use avatar::{Avatar, AvatarBadge, AvatarFallback, AvatarSize};
#[allow(unused_imports)]
pub use badge::{Badge, BadgeSize, BadgeVariant};
#[allow(unused_imports)]
pub use button::{Button, ButtonSize, ButtonVariant};
#[allow(unused_imports)]
pub use card::{Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardItem, CardList, CardSize, CardTitle};
#[allow(unused_imports)]
pub use collapsible::{Collapsible, CollapsibleContent, CollapsibleTrigger};
#[allow(unused_imports)]
pub use dialog::{Dialog, DialogTitle};
#[allow(unused_imports)]
pub use kbd::Kbd;
#[allow(unused_imports)]
pub use scroll_area::ScrollArea;
#[allow(unused_imports)]
pub use separator::{Separator, SeparatorOrientation};
#[allow(unused_imports)]
pub use skeleton::Skeleton;
#[allow(unused_imports)]
pub use spinner::Spinner;
#[allow(unused_imports)]
pub use tabs::{Tabs, TabsContent, TabsList, TabsOrientation, TabsTrigger, TabsVariant};
#[allow(unused_imports)]
pub use textarea::Textarea;
#[allow(unused_imports)]
pub use tooltip::{Tooltip, TooltipContent, TooltipPosition};
