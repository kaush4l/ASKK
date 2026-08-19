//! THE FRAME AROUND EVERY VIEW — the parts of the page that are on screen
//! whichever surface is open, and the plumbing that gets them there.
//!
//! Three jobs live here and nothing else. WHERE you are: `route` binds the
//! location hash to a `View` and `views` is the set of them, navigated by the
//! left panel. WHAT THE PAGE IS DOING while you are there: `statusbar`,
//! `warmth`, `status_pills` and `token_meter` are the header's strip of facts,
//! and `heartbeat` is the one poll that feeds them. And the FURNITURE the
//! views sit in: `dash` (the panel switches and the viewport rules), `rail`
//! (the instruments column beside the centre), `agent_switcher`, `skin`, and
//! `boot_reads`, the first trip through the seam.
//!
//! The centre column itself is `centre`, not here: what the frame does is the
//! same on every view, and what the middle shows is not.

pub(crate) mod agent_switcher;
pub(crate) mod boot_reads;
pub(crate) mod dash;
pub(crate) mod heartbeat;
pub(crate) mod rail;
pub(crate) mod route;
pub(crate) mod skin;
pub(crate) mod status_pills;
pub(crate) mod statusbar;
pub(crate) mod token_meter;
pub(crate) mod views;
pub(crate) mod warmth;
