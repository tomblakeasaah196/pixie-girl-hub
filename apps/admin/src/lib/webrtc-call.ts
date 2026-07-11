/**
 * WebRTC engine for answering WhatsApp calls in the browser.
 *
 * Meta's `connect` webhook carries an SDP offer; the backend hands it to
 * exactly one claiming agent (POST /calls/:id/claim). This module builds
 * the RTCPeerConnection around that offer: microphone in, remote audio
 * out, SDP answer back to the backend (POST /calls/:id/accept), after
 * which audio flows browser ⇄ Meta directly — the backend never touches
 * media.
 *
 * One active session per tab. Always call `teardown()` — it releases the
 * microphone (the browser's recording indicator must never linger).
 */

export interface ActiveWebRtcCall {
  pc: RTCPeerConnection;
  micStream: MediaStream;
  audioEl: HTMLAudioElement;
  setMuted: (muted: boolean) => void;
  teardown: () => void;
}

let current: ActiveWebRtcCall | null = null;

/** Ask for the microphone up front so the permission prompt happens before
 *  the SDP dance (a denied mic should fail the answer attempt cleanly). */
export async function getMicrophone(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
    video: false,
  });
}

/**
 * Build the peer connection for a claimed call and produce the SDP answer.
 * The caller sends the answer to the backend; audio starts once Meta
 * completes ICE/DTLS against the candidates baked into the answer.
 */
export async function answerCall({
  sdpOffer,
  iceServers,
  micStream,
}: {
  sdpOffer: string;
  iceServers: { urls: string }[];
  micStream: MediaStream;
}): Promise<{ session: ActiveWebRtcCall; sdpAnswer: string }> {
  teardownActiveCall(); // never two live sessions in one tab

  const pc = new RTCPeerConnection({ iceServers });
  for (const track of micStream.getAudioTracks()) {
    pc.addTrack(track, micStream);
  }

  // Remote audio → hidden <audio> element. Autoplay is safe: answering is
  // always a user gesture (the Answer button), so the tab has audio rights.
  const audioEl = document.createElement("audio");
  audioEl.autoplay = true;
  audioEl.style.display = "none";
  document.body.appendChild(audioEl);
  pc.ontrack = (e) => {
    if (e.streams && e.streams[0]) audioEl.srcObject = e.streams[0];
  };

  await pc.setRemoteDescription({ type: "offer", sdp: sdpOffer });
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  // Wait for ICE gathering so the answer we relay carries our candidates —
  // Meta's edge does not support trickle ICE over the /calls action.
  await waitForIceGathering(pc, 3000);

  const sdpAnswer = pc.localDescription?.sdp;
  if (!sdpAnswer) {
    pc.close();
    throw new Error("Could not build the WebRTC answer");
  }

  const session: ActiveWebRtcCall = {
    pc,
    micStream,
    audioEl,
    setMuted: (muted: boolean) => {
      for (const t of micStream.getAudioTracks()) t.enabled = !muted;
    },
    teardown: () => {
      try {
        pc.close();
      } catch {}
      for (const t of micStream.getTracks()) t.stop();
      audioEl.srcObject = null;
      audioEl.remove();
      if (current === session) current = null;
    },
  };
  current = session;
  return { session, sdpAnswer };
}

function waitForIceGathering(pc: RTCPeerConnection, timeoutMs: number) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, timeoutMs);
    function done() {
      clearTimeout(timer);
      pc.removeEventListener("icegatheringstatechange", check);
      resolve();
    }
    function check() {
      if (pc.iceGatheringState === "complete") done();
    }
    pc.addEventListener("icegatheringstatechange", check);
  });
}

export function getActiveWebRtcCall(): ActiveWebRtcCall | null {
  return current;
}

export function teardownActiveCall() {
  if (current) current.teardown();
  current = null;
}
