//! `define_response!` — declare a structured response type as fields +
//! descriptions only. The macro expands to the struct, any `choice` enums, and the
//! [`StructuredResponse`](super::StructuredResponse) impl; parsing, JSON/TOON
//! instruction generation, and format negotiation all come from the base trait's
//! default methods reading the generated field table.
//!
//! Field kinds:
//! - `text`  → `String`, extracted with [`super::string_field`], trimmed.
//! - `list`  → `Vec<String>`, extracted with [`super::list_field`].
//! - `(choice EnumName { Variant = "literal", ... } default Variant, "type name")`
//!   → generates `EnumName` with a `from_value` that maps each literal to its
//!   variant and anything else to the default.
//!
//! Optional trailing hooks (both used by `ReActResponse`):
//! - `normalize: path,` — `fn(&mut BTreeMap<String, Value>)`, runs before extraction.
//! - `finish: method,` — `fn(self, raw: &str) -> Self` inherent method, runs after.

macro_rules! define_response {
    (
        $(#[$struct_meta:meta])*
        pub struct $name:ident {
            $( $field:ident : $kind:tt => $desc:expr ),+ $(,)?
        }
        $( normalize: $normalize:path, )?
        $( finish: $finish:ident, )?
    ) => {
        $( define_response!(@enum_def $kind); )+

        $(#[$struct_meta])*
        #[derive(Clone, Debug, serde::Serialize, serde::Deserialize, PartialEq)]
        pub struct $name {
            $( pub $field: define_response!(@ty $kind), )+
        }

        impl crate::responses::StructuredResponse for $name {
            fn fields() -> &'static [crate::responses::ResponseField] {
                &[
                    $( crate::responses::ResponseField {
                        name: stringify!($field),
                        type_name: define_response!(@type_name $kind),
                        description: $desc,
                    }, )+
                ]
            }

            fn from_fields(
                #[allow(unused_mut)] mut fields: std::collections::BTreeMap<
                    String,
                    serde_json::Value,
                >,
                raw: &str,
            ) -> Self {
                let _ = raw;
                $( $normalize(&mut fields); )?
                let parsed = Self {
                    $( $field: define_response!(@extract $kind, &fields, stringify!($field)), )+
                };
                $( let parsed = parsed.$finish(raw); )?
                parsed
            }
        }
    };

    (@ty text) => { String };
    (@ty list) => { Vec<String> };
    (@ty (choice $enum_name:ident { $($variant:ident = $lit:literal),+ $(,)? } default $default:ident, $type_name:literal)) => { $enum_name };

    (@type_name text) => { "string" };
    (@type_name list) => { "list" };
    (@type_name (choice $enum_name:ident { $($variant:ident = $lit:literal),+ $(,)? } default $default:ident, $type_name:literal)) => { $type_name };

    (@extract text, $fields:expr, $key:expr) => {
        crate::responses::string_field($fields, $key).trim().to_string()
    };
    (@extract list, $fields:expr, $key:expr) => {
        crate::responses::list_field($fields, $key)
    };
    (@extract (choice $enum_name:ident { $($variant:ident = $lit:literal),+ $(,)? } default $default:ident, $type_name:literal), $fields:expr, $key:expr) => {
        $enum_name::from_value($fields.get($key))
    };

    (@enum_def text) => {};
    (@enum_def list) => {};
    (@enum_def (choice $enum_name:ident { $($variant:ident = $lit:literal),+ $(,)? } default $default:ident, $type_name:literal)) => {
        #[derive(Clone, Debug, serde::Serialize, serde::Deserialize, PartialEq)]
        pub enum $enum_name {
            $( $variant, )+
        }

        impl $enum_name {
            pub(crate) fn from_value(value: Option<&serde_json::Value>) -> Self {
                match value
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or_default()
                    .trim()
                {
                    $( $lit => Self::$variant, )+
                    _ => Self::$default,
                }
            }
        }
    };
}

pub(crate) use define_response;
