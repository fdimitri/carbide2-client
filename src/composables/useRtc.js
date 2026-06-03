// useRtc — WebRTC mesh calls scoped to a chat channel.
//
// A call lives inside a chat channel, so video shares the same context as
// text. The worker (rtc commandSet) is a pure signalling relay; this
// composable owns the RTCPeerConnection mesh, local media, and stream wiring.
//
// Topology: full mesh. Whoever joins last is the offerer toward every peer
// already in the call (the worker returns that list in rtc/peers), which keeps
// offer/answer glare-free — existing peers only ever answer.
//
// Peers are addressed by a per-connection peer_id assigned by the worker, so
// the same user can join from multiple tabs/devices without collisions.
import { storeToRefs } from 'pinia'
import workerSocket from '../services/workerSocket'
import { logInfo, logWarn } from '../services/log'
import { useWorkspaceStore } from '../stores/workspaceStore'

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }]

export function useRtc({ error }) {
  const store = useWorkspaceStore()
  const {
    callChannelId, callParticipants, callLocalStream, callRemoteStreams,
    callMicEnabled, callCamEnabled,
  } = storeToRefs(store)

  // peer_id -> { pc, pendingCandidates: [] }
  const peers = new Map()

  function reset() {
    for (const { pc } of peers.values()) {
      try { pc.close() } catch { /* already closed */ }
    }
    peers.clear()
    if (callLocalStream.value) {
      callLocalStream.value.getTracks().forEach(t => t.stop())
    }
    callLocalStream.value   = null
    callRemoteStreams.value = {}
    callParticipants.value  = []
    callChannelId.value     = null
    callMicEnabled.value    = true
    callCamEnabled.value    = true
  }

  function setRemoteStream(peerId, stream) {
    callRemoteStreams.value = { ...callRemoteStreams.value, [peerId]: stream }
  }

  function dropParticipant(peerId) {
    const entry = peers.get(peerId)
    if (entry) { try { entry.pc.close() } catch { /* noop */ } }
    peers.delete(peerId)
    callParticipants.value = callParticipants.value.filter(p => p.peer_id !== peerId)
    const next = { ...callRemoteStreams.value }
    delete next[peerId]
    callRemoteStreams.value = next
  }

  function addParticipant(peerId, name) {
    if (!callParticipants.value.find(p => p.peer_id === peerId)) {
      callParticipants.value = [...callParticipants.value, { peer_id: peerId, name }]
    }
  }

  // Create (or reuse) the peer connection toward `peerId`. When `initiator` is
  // true we create and send the SDP offer; otherwise we wait for one.
  function createPeer(peerId, name, initiator) {
    addParticipant(peerId, name)
    let entry = peers.get(peerId)
    if (entry) return entry

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    entry = { pc, pendingCandidates: [] }
    peers.set(peerId, entry)

    if (callLocalStream.value) {
      callLocalStream.value.getTracks().forEach(t => pc.addTrack(t, callLocalStream.value))
    }

    pc.ontrack = (ev) => setRemoteStream(peerId, ev.streams[0])

    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        signal(peerId, { type: 'candidate', candidate: ev.candidate })
      }
    }

    pc.onconnectionstatechange = () => {
      if (['failed', 'closed'].includes(pc.connectionState)) dropParticipant(peerId)
    }

    if (initiator) {
      pc.createOffer()
        .then(offer => pc.setLocalDescription(offer))
        .then(() => signal(peerId, { type: 'offer', sdp: pc.localDescription }))
        .catch(e => logWarn('useRtc', 'offer failed', e))
    }

    return entry
  }

  function signal(toPeerId, data) {
    if (!callChannelId.value) return
    workerSocket.send('rtc', 'signal', { channel_id: callChannelId.value, to: toPeerId, data })
  }

  async function flushCandidates(peerId) {
    const entry = peers.get(peerId)
    if (!entry) return
    for (const c of entry.pendingCandidates) {
      try { await entry.pc.addIceCandidate(c) } catch (e) { logWarn('useRtc', 'addIceCandidate', e) }
    }
    entry.pendingCandidates = []
  }

  async function handleSignal(fromPeerId, data) {
    if (!data) return
    if (data.type === 'offer') {
      const { pc } = createPeer(fromPeerId, peerName(fromPeerId), false)
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp))
      await flushCandidates(fromPeerId)
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      signal(fromPeerId, { type: 'answer', sdp: pc.localDescription })
    } else if (data.type === 'answer') {
      const entry = peers.get(fromPeerId)
      if (!entry) return
      await entry.pc.setRemoteDescription(new RTCSessionDescription(data.sdp))
      await flushCandidates(fromPeerId)
    } else if (data.type === 'candidate') {
      const entry = peers.get(fromPeerId)
      if (!entry) return
      const candidate = new RTCIceCandidate(data.candidate)
      // Buffer ICE until the remote description exists, else addIceCandidate throws.
      if (entry.pc.remoteDescription && entry.pc.remoteDescription.type) {
        try { await entry.pc.addIceCandidate(candidate) } catch (e) { logWarn('useRtc', 'addIceCandidate', e) }
      } else {
        entry.pendingCandidates.push(candidate)
      }
    }
  }

  function peerName(peerId) {
    return callParticipants.value.find(p => p.peer_id === peerId)?.name || 'peer'
  }

  async function startCall(channelId) {
    const cid = Number(channelId)
    if (!cid || callChannelId.value) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      callLocalStream.value = stream
      callMicEnabled.value  = true
      callCamEnabled.value  = true
      callChannelId.value   = cid
      // Worker replies rtc/peers with the existing call members; we then offer
      // to each of them (we are the newcomer / offerer).
      workerSocket.send('rtc', 'join', { channel_id: cid })
      logInfo('useRtc', 'joined call on channel', cid)
    } catch (e) {
      error.value = e.name === 'NotAllowedError'
        ? 'Camera/microphone permission denied.'
        : (e.message || 'Could not start call')
      reset()
    }
  }

  function leaveCall() {
    if (callChannelId.value) {
      workerSocket.send('rtc', 'leave', { channel_id: callChannelId.value })
    }
    reset()
  }

  function toggleMic() {
    if (!callLocalStream.value) return
    const next = !callMicEnabled.value
    callLocalStream.value.getAudioTracks().forEach(t => { t.enabled = next })
    callMicEnabled.value = next
  }

  function toggleCam() {
    if (!callLocalStream.value) return
    const next = !callCamEnabled.value
    callLocalStream.value.getVideoTracks().forEach(t => { t.enabled = next })
    callCamEnabled.value = next
  }

  function registerHandlers(offHandlers) {
    offHandlers.push(
      // Existing call members — we offer to each (we joined last).
      workerSocket.on('rtc', 'peers', (p) => {
        if (Number(p.channel_id) !== callChannelId.value) return
        ;(p.peers || []).forEach(peer => createPeer(peer.peer_id, peer.name, true))
      }),
      // A newcomer joined after us — they will offer; just show a placeholder.
      workerSocket.on('rtc', 'peer_join', (p) => {
        if (Number(p.channel_id) !== callChannelId.value) return
        addParticipant(p.peer_id, p.name)
      }),
      workerSocket.on('rtc', 'peer_leave', (p) => {
        if (Number(p.channel_id) !== callChannelId.value) return
        dropParticipant(p.peer_id)
      }),
      workerSocket.on('rtc', 'signal', (p) => {
        if (Number(p.channel_id) !== callChannelId.value) return
        handleSignal(p.from, p.data)
      }),
      // A reconnect invalidates every peer connection; tear the call down so
      // the user can rejoin cleanly rather than staring at frozen tiles.
      workerSocket.on('system', 'connected', () => {
        if (callChannelId.value) reset()
      })
    )
  }

  function cleanup() {
    reset()
  }

  return {
    startCall,
    leaveCall,
    toggleMic,
    toggleCam,
    registerHandlers,
    cleanup,
  }
}
