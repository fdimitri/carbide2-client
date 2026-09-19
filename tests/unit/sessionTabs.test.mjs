import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAIN_BRANCH, fileTabKey, fileTabPath, fileTabMatches, isFileNodeId, stripFilePath, tabBranch,
  withTabLocation, withTabLocationUnderPrefix, basenameOfPath,
} from '../../src/stores/sessionStore.js'

const UUID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

test('FileNode ids are UUIDs; paths are not', () => {
  assert.equal(isFileNodeId(UUID), true)
  assert.equal(isFileNodeId('src/app.js'), false)
  assert.equal(isFileNodeId('file:src/app.js'), false)
})

test('tab key is (id, branch), not path', () => {
  assert.equal(fileTabKey(UUID, 'main'), `file:${UUID}::main`)
  assert.equal(fileTabKey(UUID, 'feature'), `file:${UUID}::feature`)
  assert.notEqual(fileTabKey(UUID, 'main'), fileTabKey(UUID, 'feature'))
})

test('same node on two branches does not match as one tab', () => {
  const main = { kind: 'file', id: UUID, path: 'src/a.rb', branch: 'main', key: fileTabKey(UUID, 'main') }
  const feat = { kind: 'file', id: UUID, path: 'src/renamed.rb', branch: 'feature', key: fileTabKey(UUID, 'feature') }
  assert.equal(fileTabMatches(main, UUID, 'main'), true)
  assert.equal(fileTabMatches(main, UUID, 'feature'), false)
  assert.equal(fileTabMatches(feat, UUID, 'feature'), true)
  assert.equal(fileTabMatches(feat, UUID, 'main'), false)
})

test('a rename keeps identity: path is location, id still matches', () => {
  const tab = { kind: 'file', id: UUID, path: 'src/renamed.rb', branch: 'feature' }
  assert.equal(fileTabMatches(tab, UUID, 'feature'), true)
  assert.equal(fileTabPath(tab), 'src/renamed.rb')
  assert.equal(fileTabMatches(tab, 'src/renamed.rb', 'feature'), true)
  assert.equal(fileTabMatches(tab, 'src/a.rb', 'feature'), false)
})

test('tab location update changes the label, not the key', () => {
  const tab = { kind: 'file', id: UUID, path: 'src/a.rb', branch: 'feature', key: fileTabKey(UUID, 'feature'), label: 'a.rb' }
  const next = withTabLocation(tab, '/src/renamed.rb')
  assert.equal(next.id, UUID)
  assert.equal(next.key, tab.key)
  assert.equal(next.branch, 'feature')
  assert.equal(next.path, 'src/renamed.rb')
  assert.equal(next.label, 'renamed.rb')
  assert.equal(fileTabMatches(next, UUID, 'feature'), true)
  assert.equal(withTabLocation(next, 'src/renamed.rb'), next)
})

test('a folder move heals descendant tab labels without rekeying', () => {
  const child = { kind: 'file', id: UUID, path: 'lib/a.rb', branch: 'main', key: fileTabKey(UUID, 'main'), label: 'a.rb' }
  const next = withTabLocationUnderPrefix(child, 'lib', 'src')
  assert.equal(next.id, UUID)
  assert.equal(next.key, child.key)
  assert.equal(next.path, 'src/a.rb')
  assert.equal(next.label, 'a.rb')
  assert.equal(withTabLocationUnderPrefix(child, 'other', 'src'), child)
})

test('preview label follows the file basename', () => {
  const tab = { kind: 'preview', id: UUID, label: 'a.rb · preview', key: `preview:${UUID}` }
  const next = withTabLocation(tab, '/src/renamed.rb')
  assert.equal(next.id, UUID)
  assert.equal(next.key, tab.key)
  assert.equal(next.path, 'src/renamed.rb')
  assert.equal(next.label, 'renamed.rb · preview')
})

test('a later frame that names the path heals the label without a rename event', () => {
  const tab = { kind: 'file', id: UUID, path: 'src/a.rb', branch: 'main', key: fileTabKey(UUID, 'main'), label: 'a.rb' }
  const next = withTabLocation(tab, 'src/renamed.rb')
  assert.equal(next.key, tab.key)
  assert.equal(next.id, tab.id)
  assert.equal(next.label, 'renamed.rb')
})

test('a folder move heals descendant preview labels without rekeying', () => {
  const child = { kind: 'preview', id: UUID, path: 'lib/a.rb', label: 'a.rb · preview', key: `preview:${UUID}` }
  const next = withTabLocationUnderPrefix(child, 'lib', 'src')
  assert.equal(next.id, UUID)
  assert.equal(next.key, child.key)
  assert.equal(next.path, 'src/a.rb')
  assert.equal(next.label, 'a.rb · preview')
})

test('basenameOfPath is the tab title', () => {
  assert.equal(basenameOfPath('/src/a.rb'), 'a.rb')
  assert.equal(basenameOfPath('a.rb'), 'a.rb')
})

test('a resumed v3 tab whose id is still a path matches by path+branch', () => {
  const tab = { kind: 'file', id: 'src/a.rb', branch: 'feature' }
  assert.equal(fileTabPath(tab), 'src/a.rb')
  assert.equal(fileTabMatches(tab, 'src/a.rb', 'feature'), true)
  assert.equal(fileTabMatches(tab, '/src/a.rb', 'feature'), true)
  assert.equal(fileTabMatches(tab, 'src/a.rb', 'main'), false)
  assert.equal(tabBranch(tab), 'feature')
  assert.equal(tabBranch({ kind: 'file' }), MAIN_BRANCH)
})

test('stripFilePath drops a single leading slash', () => {
  assert.equal(stripFilePath('/src/a.rb'), 'src/a.rb')
  assert.equal(stripFilePath('src/a.rb'), 'src/a.rb')
})
