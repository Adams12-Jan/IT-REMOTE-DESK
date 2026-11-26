import { useCallback, useEffect, useRef, useState } from 'react';
import { Socket } from 'socket.io-client';
import { toast } from 'sonner';
import { IceServerConfig, SessionPermissions } from '../types/remoteDesk';

export interface RemoteInputEvent {
  eventType: 'mousemove' | 'mousedown' | 'mouseup' | 'keydown' | 'wheel';
  x?: number;
  y?: number;
  button?: number;
  key?: string;
  deltaY?: number;
}

interface UseWebRTCOptions {
  sessionId: string | null;
  role: 'host' | 'technician';
  socket: Socket | null;
  iceServers: IceServerConfig[];
  localStream: MediaStream | null;
  permissions: SessionPermissions | null;
  isActiveSession: boolean;
  onRemoteClipboard?: (text: string, senderName: string) => void;
  onRemoteInputReceived?: (event: RemoteInputEvent) => void;
}

export function useWebRTCSession({
  sessionId,
  role,
  socket,
  iceServers,
  localStream,
  permissions,
  isActiveSession,
  onRemoteClipboard,
  onRemoteInputReceived,
}: UseWebRTCOptions) {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const isOfferingRef = useRef(false);

  const iceServersRef = useRef(iceServers);
  const localStreamRef = useRef(localStream);
  const latencyMsRef = useRef(0);
  const isActiveSessionRef = useRef(isActiveSession);
  const onRemoteClipboardRef = useRef(onRemoteClipboard);
  const onRemoteInputRef = useRef(onRemoteInputReceived);

  useEffect(() => {
    iceServersRef.current = iceServers;
  }, [iceServers]);

  useEffect(() => {
    localStreamRef.current = localStream;
  }, [localStream]);

  useEffect(() => {
    isActiveSessionRef.current = isActiveSession;
  }, [isActiveSession]);

  useEffect(() => {
    onRemoteClipboardRef.current = onRemoteClipboard;
  }, [onRemoteClipboard]);

  useEffect(() => {
    onRemoteInputRef.current = onRemoteInputReceived;
  }, [onRemoteInputReceived]);

  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [peerState, setPeerState] = useState<RTCPeerConnectionState>('new');
  const [latencyMs, setLatencyMs] = useState<number>(0);
  const [resolutionLabel, setResolutionLabel] = useState<string>('');
  const [isRecording, setIsRecording] = useState(false);
  const [dataChannelOpen, setDataChannelOpen] = useState(false);

  useEffect(() => {
    latencyMsRef.current = latencyMs;
  }, [latencyMs]);

  const cleanupPeer = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try {
        recorderRef.current.stop();
      } catch {
        // Ignore stop errors during teardown
      }
    }
    recorderRef.current = null;
    if (dataChannelRef.current) {
      dataChannelRef.current.close();
      dataChannelRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    pendingIceRef.current = [];
    isOfferingRef.current = false;
    setRemoteStream(null);
    setDataChannelOpen(false);
    setPeerState('closed');
  }, []);

  useEffect(() => {
    return () => {
      cleanupPeer();
    };
  }, [cleanupPeer]);

  const wireDataChannel = useCallback((channel: RTCDataChannel) => {
    dataChannelRef.current = channel;
    channel.onopen = () => setDataChannelOpen(true);
    channel.onclose = () => setDataChannelOpen(false);
    channel.onmessage = (evt) => {
      try {
        const parsed = JSON.parse(evt.data);
        if (parsed.type === 'clipboard' && typeof parsed.text === 'string') {
          onRemoteClipboardRef.current?.(
            parsed.text,
            parsed.senderName || 'Remote Peer'
          );
        } else if (parsed.type === 'input' && parsed.payload) {
          onRemoteInputRef.current?.(parsed.payload);
        }
      } catch {
        // Ignore malformed control packet
      }
    };
  }, []);

  const createPeerConnection = useCallback(() => {
    if (pcRef.current) {
      pcRef.current.close();
    }
    const pc = new RTCPeerConnection({ iceServers: iceServersRef.current });
    pcRef.current = pc;
    setPeerState(pc.connectionState);

    pc.onicecandidate = (event) => {
      if (event.candidate && socket && sessionId) {
        socket.emit('session:ice-candidate', {
          sessionId,
          candidate: event.candidate.toJSON(),
        });
      }
    };

    pc.onconnectionstatechange = () => {
      setPeerState(pc.connectionState);
      if (pc.connectionState === 'connected' && socket && sessionId) {
        socket.emit('session:connected', {
          sessionId,
          latencyMs: latencyMsRef.current,
        });
      }
    };

    pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (stream) {
        setRemoteStream(stream);
      } else {
        const synthetic = new MediaStream([event.track]);
        setRemoteStream(synthetic);
      }
    };

    pc.ondatachannel = (event) => {
      wireDataChannel(event.channel);
    };

    const currentStream = localStreamRef.current;
    if (role === 'host' && currentStream) {
      for (const track of currentStream.getTracks()) {
        pc.addTrack(track, currentStream);
      }
      const channel = pc.createDataChannel('vetiva-control', { ordered: true });
      wireDataChannel(channel);
    }

    return pc;
  }, [role, sessionId, socket, wireDataChannel]);

  const initiateOffer = useCallback(async () => {
    if (
      !socket ||
      !sessionId ||
      role !== 'host' ||
      !localStreamRef.current ||
      isOfferingRef.current
    ) {
      return;
    }
    isOfferingRef.current = true;
    try {
      const pc = createPeerConnection();
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('session:offer', {
        sessionId,
        sdp: pc.localDescription,
      });
    } catch {
      // Offer failed or superseded by teardown
    } finally {
      isOfferingRef.current = false;
    }
  }, [createPeerConnection, role, sessionId, socket]);

  const replaceVideoTrack = useCallback(async (newStream: MediaStream) => {
    const pc = pcRef.current;
    if (!pc) return;
    const newVideoTrack = newStream.getVideoTracks()[0];
    if (!newVideoTrack) return;
    const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
    if (sender) {
      await sender.replaceTrack(newVideoTrack);
    } else {
      pc.addTrack(newVideoTrack, newStream);
    }
  }, []);

  useEffect(() => {
    if (!socket || !sessionId) return;

    socket.emit('session:join', { sessionId });

    const handleOffer = async (payload: {
      sessionId: string;
      sdp: RTCSessionDescriptionInit;
    }) => {
      if (payload.sessionId !== sessionId || role !== 'technician') return;
      try {
        const pc = createPeerConnection();
        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        for (const candidate of pendingIceRef.current) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
        }
        pendingIceRef.current = [];
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('session:answer', {
          sessionId,
          sdp: pc.localDescription,
        });
      } catch {
        // Ignore stale offer errors during rapid renegotiation
      }
    };

    const handleAnswer = async (payload: {
      sessionId: string;
      sdp: RTCSessionDescriptionInit;
    }) => {
      if (payload.sessionId !== sessionId || role !== 'host') return;
      const pc = pcRef.current;
      if (!pc || pc.signalingState !== 'have-local-offer') return;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        for (const candidate of pendingIceRef.current) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
        }
        pendingIceRef.current = [];
      } catch {
        // Ignore stale answer errors
      }
    };

    const handleIce = async (payload: {
      sessionId: string;
      candidate: RTCIceCandidateInit;
    }) => {
      if (payload.sessionId !== sessionId || !payload.candidate) return;
      const pc = pcRef.current;
      if (!pc || !pc.remoteDescription) {
        pendingIceRef.current.push(payload.candidate);
        return;
      }
      await pc.addIceCandidate(new RTCIceCandidate(payload.candidate)).catch(() => {});
    };

    const handleParticipantJoined = (payload: { sessionId: string }) => {
      if (
        payload.sessionId === sessionId &&
        role === 'host' &&
        isActiveSessionRef.current
      ) {
        void initiateOffer();
      }
    };

    socket.on('session:offer', handleOffer);
    socket.on('session:answer', handleAnswer);
    socket.on('session:ice-candidate', handleIce);
    socket.on('session:participant-joined', handleParticipantJoined);

    return () => {
      socket.off('session:offer', handleOffer);
      socket.off('session:answer', handleAnswer);
      socket.off('session:ice-candidate', handleIce);
      socket.off('session:participant-joined', handleParticipantJoined);
      socket.emit('session:leave', { sessionId });
    };
  }, [createPeerConnection, initiateOffer, role, sessionId, socket]);

  const hasLocalStream = Boolean(localStream);
  useEffect(() => {
    if (
      role === 'host' &&
      isActiveSession &&
      hasLocalStream &&
      sessionId &&
      socket &&
      (!pcRef.current || pcRef.current.connectionState === 'closed')
    ) {
      void initiateOffer();
    }
  }, [hasLocalStream, initiateOffer, isActiveSession, role, sessionId, socket]);

  useEffect(() => {
    if (!sessionId || !socket || !isActiveSession) return;
    const timer = setInterval(async () => {
      let measuredRtt = 0;
      const pc = pcRef.current;
      if (pc) {
        try {
          const stats = await pc.getStats();
          stats.forEach((report) => {
            if (
              report.type === 'candidate-pair' &&
              report.state === 'succeeded' &&
              typeof report.currentRoundTripTime === 'number'
            ) {
              measuredRtt = Math.round(report.currentRoundTripTime * 1000);
            }
            if (
              report.type === 'inbound-rtp' &&
              report.kind === 'video' &&
              report.frameWidth &&
              report.frameHeight
            ) {
              setResolutionLabel(`${report.frameWidth}×${report.frameHeight}`);
            }
          });
        } catch {
          // Ignore stats polling hiccup
        }
      }

      if (measuredRtt > 0) {
        setLatencyMs(measuredRtt);
        socket.emit('session:connected', { sessionId, latencyMs: measuredRtt });
      } else {
        const sentAt = Date.now();
        socket.emit('session:quality-ping', { sessionId, sentAt }, () => {
          const rtt = Math.max(1, Date.now() - sentAt);
          setLatencyMs(rtt);
          socket.emit('session:connected', { sessionId, latencyMs: rtt });
        });
      }
    }, 5000);

    return () => clearInterval(timer);
  }, [isActiveSession, sessionId, socket]);

  const sendRemoteInput = useCallback(
    (event: RemoteInputEvent) => {
      if (!permissions?.canControlInput || !sessionId) return;
      const dc = dataChannelRef.current;
      if (dc && dc.readyState === 'open') {
        dc.send(JSON.stringify({ type: 'input', payload: event }));
      } else if (socket) {
        socket.emit('session:remote-input', { sessionId, ...event });
      }
    },
    [permissions?.canControlInput, sessionId, socket]
  );

  const sendClipboardText = useCallback(
    (text: string, senderName: string) => {
      if (!permissions?.canShareClipboard || !sessionId) return false;
      const dc = dataChannelRef.current;
      if (dc && dc.readyState === 'open') {
        dc.send(JSON.stringify({ type: 'clipboard', text, senderName }));
        return true;
      }
      if (socket) {
        socket.emit('session:clipboard-sync', { sessionId, text });
        return true;
      }
      return false;
    },
    [permissions?.canShareClipboard, sessionId, socket]
  );

  const toggleRecording = useCallback(() => {
    const streamToRecord = role === 'host' ? localStream : remoteStream;
    if (!permissions?.canRecordSession) return;

    if (isRecording && recorderRef.current) {
      if (recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop();
      }
      setIsRecording(false);
      return;
    }

    if (typeof MediaRecorder === 'undefined') {
      toast.error('Session recording is not supported in this browser.');
      return;
    }

    if (!streamToRecord || streamToRecord.getTracks().length === 0) {
      toast.error('Waiting for active video stream before recording can start.');
      return;
    }

    try {
      recordedChunksRef.current = [];
      const preferredMime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : MediaRecorder.isTypeSupported('video/webm')
          ? 'video/webm'
          : undefined;
      const recorder = preferredMime
        ? new MediaRecorder(streamToRecord, { mimeType: preferredMime })
        : new MediaRecorder(streamToRecord);

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, {
          type: preferredMime || 'video/webm',
        });
        if (blob.size > 0) {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `vetiva-session-${sessionId}-${Date.now()}.webm`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
        recorderRef.current = null;
        setIsRecording(false);
      };

      recorder.start(1000);
      recorderRef.current = recorder;
      setIsRecording(true);
    } catch {
      toast.error('Unable to start session recording in this browser.');
      setIsRecording(false);
    }
  }, [isRecording, localStream, permissions?.canRecordSession, remoteStream, role, sessionId]);

  useEffect(() => {
    if (!permissions?.canRecordSession && isRecording && recorderRef.current) {
      if (recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop();
      }
      setIsRecording(false);
    }
  }, [isRecording, permissions?.canRecordSession]);

  return {
    remoteStream,
    peerState,
    latencyMs,
    resolutionLabel,
    dataChannelOpen,
    isRecording,
    initiateOffer,
    replaceVideoTrack,
    sendRemoteInput,
    sendClipboardText,
    toggleRecording,
    cleanupPeer,
  };
}
