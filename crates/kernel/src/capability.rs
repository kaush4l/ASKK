//! Capability vocabulary (ADR-006, I6). A grant is data with parameters —
//! scoped handles, not permission flags — and lives in L0 because manifests
//! (`module`), binding (`script`), and enforcement (`core`) all speak it.

use serde::{Deserialize, Serialize};

use crate::ids::EndpointName;

/// Names a kind of host power. Closed set on purpose (Spike B: "the manifest
/// vocabulary must be types, not strings"); a new host capability is a
/// deliberate kernel change, which is the right kind of friction (ADR-006).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum CapabilityId {
    /// Read/write the module's own KV slice.
    Kv,
    /// Brokered outbound HTTP — never raw fetch, never a key (ADR-006).
    Net,
    /// Call the configured model through the broker.
    Model,
    /// Read injected time.
    Clock,
    /// Draw injected randomness.
    Rng,
    /// Append a Custom event to the log.
    Emit,
    /// Run commands in a workspace, rooted at one directory (ADR-013).
    Workspace,
}

/// One scoped grant (ADR-006 Option B). The scope rides the grant so the
/// handle built from it physically cannot exceed it — default deny is
/// structural, not checked. Effective grants = manifest-declared ∩
/// host-granted (Spike B), computed in `script::effective_grants`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum CapabilityGrant {
    /// KV access confined to one key prefix — the handle cannot form a key
    /// outside it, so modules cannot read each other's data (I6).
    Kv {
        prefix: String,
    },
    /// Brokered network confined to named endpoints; the broker resolves
    /// names to user-configured base URLs and attaches credentials (I2).
    Net {
        endpoints: Vec<EndpointName>,
    },
    /// Model calls via one named endpoint profile; the module never sees
    /// a key, a URL, or a header (§4.1's headline claim).
    Model {
        endpoint: EndpointName,
    },
    Clock,
    Rng,
    Emit,
    /// A workspace confined to ONE directory. The root rides the grant, so a
    /// command runs where the grant says and nowhere else — the model names a
    /// path relative to it and can never name the root itself (I6).
    Workspace {
        root: String,
    },
}

impl CapabilityGrant {
    /// Which capability this grant scopes; exists so manifest declarations
    /// (ids) and grants (scoped) can be intersected without string matching.
    pub fn id(&self) -> CapabilityId {
        match self {
            CapabilityGrant::Kv { .. } => CapabilityId::Kv,
            CapabilityGrant::Net { .. } => CapabilityId::Net,
            CapabilityGrant::Model { .. } => CapabilityId::Model,
            CapabilityGrant::Clock => CapabilityId::Clock,
            CapabilityGrant::Rng => CapabilityId::Rng,
            CapabilityGrant::Emit => CapabilityId::Emit,
            CapabilityGrant::Workspace { .. } => CapabilityId::Workspace,
        }
    }
}
