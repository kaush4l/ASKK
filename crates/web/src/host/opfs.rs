//! OPFS-backed `KvStore` + `BlobStore` (ADR-009: the storage seams' web
//! impls). One flat OPFS subdirectory per store ("kv", "blobs"); keys are
//! percent-encoded into file names so '/'-shaped keys round-trip.

/// '%' → "%25", '/' → "%2F". Char-wise, so prefix-of-key ⇔ prefix-of-name.
#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
fn encode_name(key: &str) -> String {
    key.replace('%', "%25").replace('/', "%2F")
}

#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
fn decode_name(name: &str) -> String {
    name.replace("%2F", "/").replace("%25", "%")
}

#[cfg(target_arch = "wasm32")]
pub use imp::{OpfsBlob, OpfsKv};

#[cfg(target_arch = "wasm32")]
mod imp {
    use super::{decode_name, encode_name};
    use askk_runtime::state::{BlobStore, KvStore, LocalBoxFuture, StoreError};
    use js_sys::{Function, Promise, Reflect, Uint8Array};
    use serde_json::Value;
    use wasm_bindgen::{JsCast, JsValue};
    use wasm_bindgen_futures::JsFuture;
    use web_sys::{
        FileSystemDirectoryHandle, FileSystemFileHandle, FileSystemGetDirectoryOptions,
        FileSystemGetFileOptions, FileSystemWritableFileStream,
    };

    fn err(ctx: &str, e: JsValue) -> StoreError {
        let msg = e
            .as_string()
            .or_else(|| {
                Reflect::get(&e, &JsValue::from_str("message"))
                    .ok()
                    .and_then(|m| m.as_string())
            })
            .unwrap_or_else(|| format!("{e:?}"));
        StoreError::new(format!("opfs {ctx}: {msg}"))
    }

    fn is_not_found(e: &JsValue) -> bool {
        Reflect::get(e, &JsValue::from_str("name"))
            .ok()
            .and_then(|n| n.as_string())
            .is_some_and(|n| n == "NotFoundError")
    }

    /// Open (creating if needed) `<opfs root>/<name>`.
    async fn subdir(name: &str) -> Result<FileSystemDirectoryHandle, StoreError> {
        let storage = web_sys::window()
            .ok_or_else(|| StoreError::new("opfs: no window"))?
            .navigator()
            .storage();
        let root = JsFuture::from(storage.get_directory())
            .await
            .map_err(|e| err("root", e))?;
        let root: FileSystemDirectoryHandle = root.unchecked_into();
        let opts = FileSystemGetDirectoryOptions::new();
        opts.set_create(true);
        let dir = JsFuture::from(root.get_directory_handle_with_options(name, &opts))
            .await
            .map_err(|e| err("subdir", e))?;
        Ok(dir.unchecked_into())
    }

    async fn read_file(
        dir: &FileSystemDirectoryHandle,
        name: &str,
    ) -> Result<Option<Vec<u8>>, StoreError> {
        let handle = match JsFuture::from(dir.get_file_handle(name)).await {
            Ok(h) => h.unchecked_into::<FileSystemFileHandle>(),
            Err(e) if is_not_found(&e) => return Ok(None),
            Err(e) => return Err(err("get file handle", e)),
        };
        let file: web_sys::File = JsFuture::from(handle.get_file())
            .await
            .map_err(|e| err("get file", e))?
            .unchecked_into();
        let buf = JsFuture::from(file.array_buffer())
            .await
            .map_err(|e| err("read", e))?;
        Ok(Some(Uint8Array::new(&buf).to_vec()))
    }

    async fn write_file(
        dir: &FileSystemDirectoryHandle,
        name: &str,
        bytes: &[u8],
    ) -> Result<(), StoreError> {
        let opts = FileSystemGetFileOptions::new();
        opts.set_create(true);
        let handle: FileSystemFileHandle =
            JsFuture::from(dir.get_file_handle_with_options(name, &opts))
                .await
                .map_err(|e| err("create file handle", e))?
                .unchecked_into();
        let stream: FileSystemWritableFileStream = JsFuture::from(handle.create_writable())
            .await
            .map_err(|e| err("create writable", e))?
            .unchecked_into();
        let write = stream
            .write_with_u8_array(bytes)
            .map_err(|e| err("write", e))?;
        JsFuture::from(write).await.map_err(|e| err("write", e))?;
        JsFuture::from(stream.close())
            .await
            .map_err(|e| err("close", e))?;
        Ok(())
    }

    async fn remove_file(dir: &FileSystemDirectoryHandle, name: &str) -> Result<(), StoreError> {
        match JsFuture::from(dir.remove_entry(name)).await {
            Ok(_) => Ok(()),
            Err(e) if is_not_found(&e) => Ok(()), // removing absent = no-op (Mem parity)
            Err(e) => Err(err("remove", e)),
        }
    }

    /// All entry names in the directory, via the async `keys()` iterator.
    /// Driven through `Reflect` — web-sys does not bind async iterables.
    async fn list_names(dir: &FileSystemDirectoryHandle) -> Result<Vec<String>, StoreError> {
        let keys_fn: Function = Reflect::get(dir.as_ref(), &JsValue::from_str("keys"))
            .map_err(|e| err("keys", e))?
            .unchecked_into();
        let iter = keys_fn.call0(dir.as_ref()).map_err(|e| err("keys()", e))?;
        let next_fn: Function = Reflect::get(&iter, &JsValue::from_str("next"))
            .map_err(|e| err("next", e))?
            .unchecked_into();
        let mut names = Vec::new();
        loop {
            let step: Promise = next_fn
                .call0(&iter)
                .map_err(|e| err("next()", e))?
                .unchecked_into();
            let result = JsFuture::from(step).await.map_err(|e| err("iterate", e))?;
            let done = Reflect::get(&result, &JsValue::from_str("done"))
                .map_err(|e| err("done", e))?
                .as_bool()
                .unwrap_or(true);
            if done {
                break;
            }
            if let Some(name) = Reflect::get(&result, &JsValue::from_str("value"))
                .map_err(|e| err("value", e))?
                .as_string()
            {
                names.push(name);
            }
        }
        Ok(names)
    }

    async fn list_decoded(
        dir: &FileSystemDirectoryHandle,
        prefix: &str,
    ) -> Result<Vec<String>, StoreError> {
        let mut keys: Vec<String> = list_names(dir)
            .await?
            .iter()
            .map(|n| decode_name(n))
            .filter(|k| k.starts_with(prefix))
            .collect();
        keys.sort(); // OPFS iteration order is unspecified; contract says sorted
        Ok(keys)
    }

    /// `KvStore` over one OPFS directory: key → JSON file.
    pub struct OpfsKv {
        dir: FileSystemDirectoryHandle,
    }

    impl OpfsKv {
        pub async fn new() -> Result<Self, StoreError> {
            Ok(Self {
                dir: subdir("kv").await?,
            })
        }
    }

    impl KvStore for OpfsKv {
        fn get(&self, key: &str) -> LocalBoxFuture<'_, Result<Option<Value>, StoreError>> {
            let dir = self.dir.clone();
            let name = encode_name(key);
            Box::pin(async move {
                match read_file(&dir, &name).await? {
                    Some(bytes) => Ok(Some(serde_json::from_slice(&bytes)?)),
                    None => Ok(None),
                }
            })
        }

        fn set(&self, key: &str, value: Value) -> LocalBoxFuture<'_, Result<(), StoreError>> {
            let dir = self.dir.clone();
            let name = encode_name(key);
            Box::pin(async move {
                let bytes = serde_json::to_vec(&value)?;
                write_file(&dir, &name, &bytes).await
            })
        }

        fn remove(&self, key: &str) -> LocalBoxFuture<'_, Result<(), StoreError>> {
            let dir = self.dir.clone();
            let name = encode_name(key);
            Box::pin(async move { remove_file(&dir, &name).await })
        }

        fn list_prefix(&self, prefix: &str) -> LocalBoxFuture<'_, Result<Vec<String>, StoreError>> {
            let dir = self.dir.clone();
            let prefix = prefix.to_string();
            Box::pin(async move { list_decoded(&dir, &prefix).await })
        }
    }

    /// `BlobStore` over one OPFS directory: path → byte file.
    pub struct OpfsBlob {
        dir: FileSystemDirectoryHandle,
    }

    impl OpfsBlob {
        pub async fn new() -> Result<Self, StoreError> {
            Ok(Self {
                dir: subdir("blobs").await?,
            })
        }
    }

    impl BlobStore for OpfsBlob {
        fn read(&self, path: &str) -> LocalBoxFuture<'_, Result<Option<Vec<u8>>, StoreError>> {
            let dir = self.dir.clone();
            let name = encode_name(path);
            Box::pin(async move { read_file(&dir, &name).await })
        }

        fn write(&self, path: &str, bytes: &[u8]) -> LocalBoxFuture<'_, Result<(), StoreError>> {
            let dir = self.dir.clone();
            let name = encode_name(path);
            let bytes = bytes.to_vec();
            Box::pin(async move { write_file(&dir, &name, &bytes).await })
        }

        fn remove(&self, path: &str) -> LocalBoxFuture<'_, Result<(), StoreError>> {
            let dir = self.dir.clone();
            let name = encode_name(path);
            Box::pin(async move { remove_file(&dir, &name).await })
        }

        fn list(&self, prefix: &str) -> LocalBoxFuture<'_, Result<Vec<String>, StoreError>> {
            let dir = self.dir.clone();
            let prefix = prefix.to_string();
            Box::pin(async move { list_decoded(&dir, &prefix).await })
        }
    }
}

/// OPFS stores, verified writable end to end (some contexts — incognito,
/// embedded webviews — grant OPFS but fail `createWritable` with quota
/// errors at ~KB scale). The probe writes real payloads through both seams
/// so a broken grant is caught at boot, not mid-run.
#[cfg(target_arch = "wasm32")]
pub(super) async fn stores() -> Result<
    (
        std::rc::Rc<dyn askk_runtime::state::KvStore>,
        std::rc::Rc<dyn askk_runtime::state::BlobStore>,
    ),
    String,
> {
    use askk_runtime::state::{BlobStore, KvStore};
    use std::rc::Rc;

    let kv: Rc<dyn KvStore> = Rc::new(OpfsKv::new().await.map_err(|e| e.to_string())?);
    let blobs: Rc<dyn BlobStore> = Rc::new(OpfsBlob::new().await.map_err(|e| e.to_string())?);
    kv.set("probe/kv", serde_json::Value::from("ok"))
        .await
        .map_err(|e| e.to_string())?;
    kv.remove("probe/kv").await.map_err(|e| e.to_string())?;
    // ponytail: 64 KiB ≈ one busy run's log segment; the REWRITE of the same
    // path matters — broken grants pass a single write and fail the second.
    for _ in 0..2 {
        blobs
            .write("probe.bin", &vec![0u8; 64 * 1024])
            .await
            .map_err(|e| e.to_string())?;
    }
    blobs.remove("probe.bin").await.map_err(|e| e.to_string())?;
    Ok((kv, blobs))
}

/// Host stubs so the crate host-compiles; host runs inject the memory stores.
#[cfg(not(target_arch = "wasm32"))]
#[allow(dead_code)]
pub struct OpfsKv;

#[cfg(not(target_arch = "wasm32"))]
#[allow(dead_code)]
pub struct OpfsBlob;

#[cfg(not(target_arch = "wasm32"))]
#[allow(dead_code, clippy::unused_async)]
impl OpfsKv {
    pub async fn new() -> Result<Self, askk_runtime::state::StoreError> {
        panic!("OpfsKv is wasm-only (OPFS); host runs use askk_runtime::state::MemKv")
    }
}

#[cfg(not(target_arch = "wasm32"))]
#[allow(dead_code, clippy::unused_async)]
impl OpfsBlob {
    pub async fn new() -> Result<Self, askk_runtime::state::StoreError> {
        panic!("OpfsBlob is wasm-only (OPFS); host runs use askk_runtime::state::MemBlob")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn name_encoding_round_trips_and_preserves_prefixes() {
        for key in ["session/provider/default", "seg-1.jsonl", "a%2Fb", "%", ""] {
            assert_eq!(decode_name(&encode_name(key)), key);
        }
        // No '/' survives encoding (OPFS name rule).
        assert!(!encode_name("a/b/c").contains('/'));
        // Prefix relation survives encoding — list_prefix depends on this.
        let (key, prefix) = ("session/provider/default", "session/provider/");
        assert!(encode_name(key).starts_with(&encode_name(prefix)));
    }
}
