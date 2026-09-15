# frozen_string_literal: true
#
# Ruby side of tests/parity/ot_parity.mjs. Loads the server's real DbfsV2 OT
# code (no Rails, no database) and answers one JSON case per stdin line with one
# JSON result per stdout line.
#
# Merge and Rebase touch storage only through a few calls (merge base lookup,
# Content.at, branch lock, Store#write); those are stubbed below so the real
# method bodies run unchanged.
#
#   ruby tests/parity/ot_parity.rb <carbide2-server dir>
Encoding.default_external = Encoding::UTF_8
Encoding.default_internal = Encoding::UTF_8
require 'json'
require 'digest'
require 'set'

server = File.expand_path(ARGV.fetch(0))
%w[errors buffer delta myers transform merge rebase].each do |f|
  require File.join(server, 'lib/dbfs_v2', f)
end

module ActiveRecord
  class Base
    def self.transaction = yield
  end
end

StubBranch = Struct.new(:id, :head_revision_id) do
  def reload = self
end

class Branch
  MAIN = 'main'
  def self.lock = self
  def self.find(_id) = StubBranch.new('b', 'head')
end

StubRev = Struct.new(:id, :delta) do
  def update_columns(**) = nil
end

class StubStore
  attr_reader :written
  def initialize = @written = []
  def write(_path, delta, **)
    @written << delta
    StubRev.new("r#{@written.size}", delta)
  end
end

StubBranches = Struct.new(:x) do
  def find_by!(**) = StubBranch.new('b', 'head')
end
StubNode = Struct.new(:path) do
  def branches = StubBranches.new(nil)
  def binary? = false
end

module DbfsV2
  module Content
    CONTENTS = {}
    def self.at(_node, id) = CONTENTS.fetch(id)
  end

  module Rebase
    CONCURRENT = []
    def self.concurrent_since(*) = CONCURRENT
  end

  module Merge
    def self.lowest_common_ancestor(*) = :base
  end
end

D = DbfsV2::Delta
B = DbfsV2::Buffer
T = DbfsV2::Transform

def delta(h)
  pri = h['priority']
  d = D.new(h['type'], h['payload'])
  d.priority = pri unless pri.nil?
  d
end

def err_kind(e)
  case e
  when DbfsV2::ConflictError then 'conflict'
  when ArgumentError then e.message.start_with?('unknown delta type') ? 'unknown' : 'range'
  else 'error'
  end
end

def prims_out(prims) = prims.map { |p| [p.start, p.finish, p.text, p.priority] }

def hashes_out(hashes) = JSON.parse(hashes.to_json)

def run(c)
  case c['kind']
  when 'buffer'
    b = B.new(c['base'])
    { offsets: c['offsets'].map { |l, ch| b.offset(l, ch) }, positions: c['positions'].map { |o| b.position(o) } }
  when 'apply'
    buf = B.new(c['base'])
    d = delta(c['delta'])
    begin
      d.validate_against!(buf)
      valid = true
    rescue StandardError => e
      valid = err_kind(e)
    end
    content = begin
      d.apply_to(B.new(c['base'])).to_s
    rescue StandardError => e
      "!#{err_kind(e)}"
    end
    range = begin
      d.range(buf)
    rescue StandardError => e
      "!#{err_kind(e)}"
    end
    { valid: valid, content: content, range: range, priority: D.new(c['delta']['type'], c['delta']['payload']).priority_for(nil) }
  when 'pcre'
    d = delta(c['delta'])
    begin
      { matches: d.matches(B.new(c['base'])) }
    rescue StandardError => e
      { error: err_kind(e) }
    end
  when 'myers'
    { hunks: DbfsV2::Myers.hunks(c['a'], c['b']) }
  when 'diff'
    { prims: prims_out(T.diff_prims(c['old'], c['new'], 'p')) }
  when 'transform'
    a = delta(c['a'])
    b = delta(c['b'])
    begin
      ap, bp = T.transform(a, b, B.new(c['base']))
      { a: hashes_out(ap), b: hashes_out(bp) }
    rescue StandardError => e
      { error: err_kind(e), message: e.message }
    end
  when 'transform_list'
    ops = c['ops'].map { |s, f, t, p| T::Prim.new(s, f, t, p) }
    others = c['others'].map { |s, f, t, p| T::Prim.new(s, f, t, p) }
    begin
      { prims: prims_out(T.transform_list(ops, others)) }
    rescue StandardError => e
      { error: err_kind(e) }
    end
  when 'merge'
    DbfsV2::Content::CONTENTS.replace(base: c['base'], ours: c['ours'], theirs: c['theirs'])
    node = StubNode.new('/f')
    confs = DbfsV2::Merge.conflicts(node, :ours, :theirs)
    content = begin
      DbfsV2::Merge.auto_merge_content(node, :ours, :theirs)
    rescue DbfsV2::ConflictError
      nil
    end
    { conflicts: JSON.parse(confs.to_json), content: content }
  when 'rebase'
    DbfsV2::Content::CONTENTS.replace('base' => c['base'])
    DbfsV2::Rebase::CONCURRENT.replace(c['concurrent'].map { |h| delta(h) })
    store = StubStore.new
    begin
      res = DbfsV2::Rebase.onto!(store, StubNode.new('/f'), c['deltas'].map { |h| delta(h) },
                                 base_id: 'base', source_head_id: 'src', branch: 'main')
      # onto! adds an empty-insert carrier when nothing survives; the JS port
      # leaves that to storage, so drop it here.
      written = store.written
      written = [] if written.size == 1 && written[0].type == 'insertDataSingleLine' && written[0].data.empty? && written[0].priority.nil?
      {
        deltas: written.map { |d| JSON.parse(d.to_h.to_json).merge('priority' => d.priority) },
        bridge: hashes_out(res[:bridge]),
      }
    rescue StandardError => e
      { error: err_kind(e) }
    end
  else
    { error: "unknown kind #{c['kind']}" }
  end
end

$stdout.sync = true
$stdin.each_line do |line|
  next if line.strip.empty?
  c = JSON.parse(line)
  out = begin
    run(c)
  rescue StandardError => e
    { crash: "#{e.class}: #{e.message}", at: e.backtrace.first(3) }
  end
  puts JSON.generate(out)
end
