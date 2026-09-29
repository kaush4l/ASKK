/** Late inspection reads cannot replace a newer selection or reopen a closed modal. */
export function createModalNavigation(commit) {
  let version = 0
  return {
    show(value) { version++; commit(value) },
    invalidate() { version++ },
    async read(load) {
      const ticket = ++version
      try {
        const value = await load()
        if (ticket !== version) return false
        commit(value)
        return true
      } catch (error) {
        if (ticket !== version) return false
        throw error
      }
    },
  }
}
