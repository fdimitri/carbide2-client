// An edit that overlaps a concurrent replace (or a rebase that does not
// converge). Mirrors DbfsV2::ConflictError.
export class ConflictError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ConflictError'
  }
}
