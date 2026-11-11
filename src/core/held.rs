//! # Locks that outlive a panic
//!
//! The standard lock *poisons* itself when the code holding it panics: every later
//! `lock().unwrap()` then panics too, so one bad step in one engine would stop every engine
//! for as long as the service runs. Here a lock is simply taken ([`Held::held`]): what a
//! panicking holder left behind is what the next one reads. The values behind these locks
//! are small and whole after each statement (a status, a list, a counter), so that is the
//! lesser harm; the panic itself is still printed where it happened.
//!
//! `structure.rs` refuses `lock().unwrap()` anywhere in the app.
use std::sync::{Mutex, MutexGuard, PoisonError, RwLock, RwLockReadGuard, RwLockWriteGuard};

pub trait Held<T: ?Sized> {
    /// Take the lock, whatever happened to the last holder.
    fn held(&self) -> MutexGuard<'_, T>;
}

impl<T: ?Sized> Held<T> for Mutex<T> {
    fn held(&self) -> MutexGuard<'_, T> {
        self.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// The same for a lock with many readers.
pub trait Shared<T: ?Sized> {
    fn reading(&self) -> RwLockReadGuard<'_, T>;
    fn writing(&self) -> RwLockWriteGuard<'_, T>;
}

impl<T: ?Sized> Shared<T> for RwLock<T> {
    fn reading(&self) -> RwLockReadGuard<'_, T> {
        self.read().unwrap_or_else(PoisonError::into_inner)
    }
    fn writing(&self) -> RwLockWriteGuard<'_, T> {
        self.write().unwrap_or_else(PoisonError::into_inner)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn a_lock_is_still_usable_after_its_holder_panicked() {
        let m = Arc::new(Mutex::new(1));
        let held = m.clone();
        let _ = std::thread::spawn(move || {
            let _g = held.held();
            panic!("the holder dies (expected in this test)");
        })
        .join();
        assert!(m.lock().is_err(), "the standard lock is poisoned");
        *m.held() += 1;
        assert_eq!(*m.held(), 2);
    }
}
