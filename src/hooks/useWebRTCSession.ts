import { useCallback, useEffect, useRef, useState } from 'react';
import { Socket } from 'socket.io-client';
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
  sessionId: number | null;
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

  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [peerState, setPeerState] = useState<RTCPeerConnectionState>('new');
  const [latencyMs, setLatencyMs] = useState<number>(0);
  const [resolutionLabel, setResolutionLabel] = useState<string>('');
  const [isRecording, setIsRecording] = useState(false);
  const [dataChannelOpen, setDataChannelOpen] = useState(false);

  const cleanupPeer = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    if (dataChannelRef.current) {
      dataChannelRef.current.close();
      dataChannelRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    pendingIceRef.current = [];
    setRemoteStream(null);
    setDataChannelOpen(false);
    setPeerState('closed');
  }, []);

  const wireDataChannel = useCallback(
    (channel: RTCDataChannel) => {
      dataChannelRef.current = channel;
      channel.onopen = () => setDataChannelOpen(true);
      channel.onclose = () => setDataChannelOpen(false);
      channel.onmessage = (evt) => {
        try {
          const parsed = JSON.parse(evt.data);
          if (parsed.type === 'clipboard' && typeof parsed.text === 'string') {
            onRemoteClipboard?.(parsed.text, parsed.senderName || 'Remote Peer');
          } else if (parsed.type === 'input' && parsed.payload) {
            onRemoteInputReceived?.(parsed.payload);
          }
        } catch {
          // Ignore malformed control packet
        }
      };
    },
    [onRemoteClipboard, onRemoteInputReceived]
  );

  const createPeerConnection = useCallback(() => {
    if (pcRef.current) {
      pcRef.current.close();
    }
    const pc = new RTCPeerConnection({ iceServers });
    pcRef.current = pc;

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
        socket.emit('session:connected', { sessionId, latencyMs });
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

    if (role === 'host' && localStream) {
      for (const track of localStream.getTracks()) {
        pc.addTrack(track, localStream);
      }
      const channel = pc.createDataChannel('vetiva-control', { ordered: true });
      wireDataChannel(channel);
    }

    return pc;
  }, [iceServers, latencyMs, localStream, role, sessionId, socket, wireDataChannel]);

  const initiateOffer = useCallback(async () => {
    if (!socket || !sessionId || role !== 'host' || !localStream) return;
    const pc = createPeerConnection();
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('session:offer', {
      sessionId,
      sdp: pc.localDescription,
    });
  }, [createPeerConnection, localStream, role, sessionId, socket]);

  // Replace video track seamlessly when host switches screen/window
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

  // Join Socket room & attach WebRTC signaling listeners
  useEffect(() => {
    if (!socket || !sessionId) return;

    socket.emit('session:join', { sessionId });

    const handleOffer = async (payload: {
      sessionId: number;
      sdp: RTCSessionDescriptionInit;
    }) => {
      if (payload.sessionId !== sessionId || role !== 'technician') return;
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
    };

    const handleAnswer = async (payload: {
      sessionId: number;
      sdp: RTCSessionDescriptionInit;
    }) => {
      if (payload.sessionId !== sessionId || role !== 'host') return;
      const pc = pcRef.current;
      if (!pc) return;
      await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      for (const candidate of pendingIceRef.current) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
      }
      pendingIceRef.current = [];
    };

    const handleIce = async (payload: {
      sessionId: number;
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

    const handleParticipantJoined = (payload: { sessionId: number }) => {
      if (payload.sessionId === sessionId && role === 'host' && isActiveSession) {
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
  }, [createPeerConnection, initiateOffer, isActiveSession, role, sessionId, socket]);

  // Host triggers initial WebRTC offer as soon as session becomes active with a live stream
  useEffect(() => {
    if (role === 'host' && isActiveSession && localStream && sessionId && socket) {
      void initiateOffer();
    }
  }, [initiateOffer, isActiveSession, localStream, role, sessionId, socket]);

  // Real-time latency measurement via WebRTC getStats + Socket ping fallback
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
    }, 3000);

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
      recorderRef.current.stop();
      setIsRecording(false);
      return;
    }

    if (!streamToRecord) return;
    recordedChunksRef.current = [];
    const recorder = new MediaRecorder(streamToRecord, {
      mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : 'video/webm',
    });

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vetiva-session-${sessionId}-${Date.now()}.webm`;
      a.click();
      URL.revokeObjectURL(url);
      setIsRecording(false);
    };

    recorder.start(1000);
    recorderRef.current = recorder;
    setIsRecording(true);
  }, [isRecording, localStream, permissions?.canRecordSession, remoteStream, role, sessionId]);

  useEffect(() => {
    if (!permissions?.canRecordSession && isRecording && recorderRef.current) {
      recorderRef.current.stop();
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
