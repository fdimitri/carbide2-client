// An edit that overlaps a concurrent replace (or a rebase that does not
// converge). Mirrors DbfsV2::ConflictError.
export class ConflictError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ConflictError'
  }
}

// A conflict between two known sets of changes. `regions` is
// [{ target, source }], each a list of { start, end, type } in one coordinate
// space (DbfsV2::OverlapConflict).
export class OverlapConflict extends ConflictError {
  constructor(message, regions = []) {
    super(message)
    this.name = 'OverlapConflict'
    this.regions = regions
  }
}
