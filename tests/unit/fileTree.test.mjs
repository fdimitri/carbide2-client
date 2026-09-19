import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  stripTreePath, treeBasename, treeParentPath, isBulkTreeEvent,
  applyCreated, applyRenamed, applyDeleted, findTreeNode,
} from '../../src/utils/fileTree.js'

const FILE = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const DIR  = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff'
const CHILD = 'cccccccc-dddd-4eee-8fff-000000000000'

test('stripTreePath / basename / parent', () => {
  assert.equal(stripTreePath('/src/a.rb'), 'src/a.rb')
  assert.equal(treeBasename('/src/a.rb'), 'a.rb')
  assert.equal(treeParentPath('/src/a.rb'), 'src')
  assert.equal(treeParentPath('a.rb'), '')
})

test('a root or import created is a bulk event (snapshot, not a patch)', () => {
  assert.equal(isBulkTreeEvent({ path: '/', type: 'folder' }), true)
  assert.equal(isBulkTreeEvent({ path: '/src/a.rb', reason: 'import_git' }), true)
  assert.equal(isBulkTreeEvent({ path: '/', source: 'inotify-reconcile' }), true)
  assert.equal(isBulkTreeEvent({ path: '/src/a.rb', type: 'file', id: FILE }), false)
})

test('created inserts a file without refetching', () => {
  const next = applyCreated([], { path: '/README.md', type: 'file', id: FILE })
  assert.deepEqual(next, [{ id: FILE, path: 'README.md', name: 'README.md', type: 'file' }])
})

test('created mkdir-p stubs missing parent folders', () => {
  const next = applyCreated([], { path: '/src/lib/a.rb', type: 'file', id: FILE })
  assert.equal(next[0].path, 'src')
  assert.equal(next[0].type, 'dir')
  assert.equal(next[0].children[0].path, 'src/lib')
  assert.equal(next[0].children[0].children[0].id, FILE)
  assert.equal(next[0].children[0].children[0].name, 'a.rb')
})

test('created of an existing path upgrades the id, does not duplicate', () => {
  const first = applyCreated([], { path: '/lib', type: 'folder' })
  const next = applyCreated(first, { path: '/lib', type: 'folder', id: DIR })
  assert.equal(next.length, 1)
  assert.equal(next[0].id, DIR)
  assert.equal(next[0].type, 'dir')
})

test('folders sort before files, then by name', () => {
  let t = applyCreated([], { path: '/z.rb', type: 'file', id: '1' })
  t = applyCreated(t, { path: '/a.rb', type: 'file', id: '2' })
  t = applyCreated(t, { path: '/lib', type: 'folder', id: DIR })
  assert.deepEqual(t.map((n) => n.name), ['lib', 'a.rb', 'z.rb'])
})

test('renamed updates the label and keeps identity', () => {
  const t = applyCreated([], { path: '/src/a.rb', type: 'file', id: FILE })
  const next = applyRenamed(t, { old_path: '/src/a.rb', new_path: '/src/renamed.rb', id: FILE })
  const n = findTreeNode(next, { id: FILE })
  assert.equal(n.id, FILE)
  assert.equal(n.path, 'src/renamed.rb')
  assert.equal(n.name, 'renamed.rb')
})

test('a folder rename rewrites descendant paths', () => {
  let t = applyCreated([], { path: '/lib', type: 'folder', id: DIR })
  t = applyCreated(t, { path: '/lib/a.rb', type: 'file', id: CHILD })
  const next = applyRenamed(t, { old_path: '/lib', new_path: '/src', id: DIR })
  assert.equal(findTreeNode(next, { id: DIR }).path, 'src')
  assert.equal(findTreeNode(next, { id: CHILD }).path, 'src/a.rb')
  assert.equal(findTreeNode(next, { id: CHILD }).id, CHILD)
})

test('renamed of a node not in the forest asks for a snapshot', () => {
  assert.equal(applyRenamed([], { old_path: '/a.rb', new_path: '/b.rb', id: FILE }), null)
})

test('deleted removes a file, and a folder takes its children', () => {
  let t = applyCreated([], { path: '/lib', type: 'folder', id: DIR })
  t = applyCreated(t, { path: '/lib/a.rb', type: 'file', id: CHILD })
  t = applyCreated(t, { path: '/README.md', type: 'file', id: FILE })
  t = applyDeleted(t, { path: '/lib' })
  assert.equal(findTreeNode(t, { id: DIR }), null)
  assert.equal(findTreeNode(t, { id: CHILD }), null)
  assert.equal(findTreeNode(t, { id: FILE }).name, 'README.md')
})
