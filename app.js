const SIGNALING_URL = "wss://inai-col3.fishrungames.com/signaling/";
const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

const elements = {
  status: document.querySelector("#call-status"),
  statusLabel: document.querySelector("#status-label"),
  duration: document.querySelector("#call-duration"),
  nameInput: document.querySelector("#name-input"),
  localName: document.querySelector("#local-name-label"),
  localAvatar: document.querySelector("#local-avatar"),
  youMiniAvatar: document.querySelector("#you-mini-avatar"),
  remoteAvatar: document.querySelector("#remote-avatar"),
  remoteTitle: document.querySelector("#remote-title"),
  remoteCopy: document.querySelector("#remote-copy"),
  remotePlaceholder: document.querySelector("#remote-placeholder"),
  remoteVideo: document.querySelector("#remote-video"),
  remoteLabel: document.querySelector("#remote-label"),
  remoteName: document.querySelector("#remote-name"),
  localVideo: document.querySelector("#local-video"),
  localPlaceholder: document.querySelector("#local-placeholder"),
  localMicIndicator: document.querySelector("#local-mic-indicator"),
  participantCount: document.querySelector("#participant-count"),
  participantHint: document.querySelector("#participant-hint"),
  participantStatus: document.querySelector("#participant-status"),
  peerMiniAvatar: document.querySelector("#peer-mini-avatar"),
  micButton: document.querySelector("#mic-button"),
  micLabel: document.querySelector("#mic-label"),
  cameraButton: document.querySelector("#camera-button"),
  cameraLabel: document.querySelector("#camera-label"),
  joinButton: document.querySelector("#join-button"),
  joinLabel: document.querySelector("#join-label"),
  leaveButton: document.querySelector("#leave-button"),
  fullscreenButton: document.querySelector("#fullscreen-button"),
  toast: document.querySelector("#toast"),
};

let localStream;
let peerConnection;
let socket;
let localId;
let peerId;
let peerName = "Собеседник";
let sessionStartedAt;
let timerInterval;
let toastTimeout;
let pendingCandidates = [];

function showToast(message, isError = false) {
  elements.toast.textContent = message;
  elements.toast.classList.toggle("error", isError);
  elements.toast.classList.add("visible");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => elements.toast.classList.remove("visible"), 4200);
}

function setStatus(label, state = "idle") {
  elements.statusLabel.textContent = label;
  elements.status.classList.toggle("connecting", state === "connecting");
  elements.status.classList.toggle("connected", state === "connected");
  elements.status.classList.toggle("error", state === "error");
}

function setJoining(isJoining) {
  elements.joinButton.disabled = isJoining;
  elements.joinLabel.textContent = isJoining ? "Подключаемся…" : "Подключиться";
}

function getDisplayName() {
  return elements.nameInput.value.trim().slice(0, 32) || "Гость";
}

function initials(name) {
  return [...name.trim()][0]?.toLocaleUpperCase("ru-RU") || "Г";
}

function sendSignal(message) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

async function connect() {
  if (socket || localStream) return;
  setJoining(true);
  localId = crypto.randomUUID();
  const displayName = getDisplayName();

  elements.localName.textContent = displayName;
  elements.localAvatar.textContent = initials(displayName);
  elements.youMiniAvatar.textContent = initials(displayName);
  setStatus("Запрашиваем доступ к камере…", "connecting");

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    elements.localVideo.srcObject = localStream;
    elements.localVideo.hidden = false;
    elements.localPlaceholder.hidden = true;
    elements.micButton.classList.add("active");
    elements.micButton.classList.remove("off");
    elements.cameraButton.classList.add("active");
    elements.cameraButton.classList.remove("off");
    elements.micButton.disabled = false;
    elements.cameraButton.disabled = false;
    elements.micButton.setAttribute("aria-pressed", "true");
    elements.cameraButton.setAttribute("aria-pressed", "true");
    elements.micLabel.textContent = "Микрофон";
    elements.cameraLabel.textContent = "Камера";
    elements.localMicIndicator.hidden = true;

    setStatus("Подключаемся к собеседнику…", "connecting");
    socket = new WebSocket(SIGNALING_URL);
    socket.addEventListener("open", () => {
      sendSignal({ type: "hello", id: localId, name: displayName });
      setJoining(false);
      elements.joinButton.hidden = true;
      elements.leaveButton.hidden = false;
      elements.nameInput.disabled = true;
      elements.participantHint.textContent = "Ожидаем собеседника";
      setStatus("Ожидаем собеседника", "connecting");
    });
    socket.addEventListener("message", handleSignal);
    socket.addEventListener("close", handleSocketClose);
    socket.addEventListener("error", (event) => {
      if (event.currentTarget === socket) showToast("Не удалось подключиться к серверу. Проверьте соединение и попробуйте снова.", true);
    });
  } catch (error) {
    setJoining(false);
    cleanupMedia();
    setStatus("Вы пока одни");
    if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
      showToast("Разрешите доступ к камере и микрофону в настройках браузера.", true);
    } else if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
      showToast("Камера или микрофон не найдены. Подключите устройство и попробуйте снова.", true);
    } else if (error.name === "NotReadableError" || error.name === "TrackStartError") {
      showToast("Камера или микрофон уже используются другим приложением.", true);
    } else {
      showToast(`Не удалось включить камеру и микрофон: ${error.message}`, true);
    }
  }
}

async function handleSignal(event) {
  let message;
  try {
    message = JSON.parse(event.data);
  } catch {
    showToast("Сервер прислал сообщение в неверном формате.", true);
    return;
  }

  if (!message || typeof message !== "object") return;
  if (message.type === "peer-left") {
    resetPeer();
    setStatus("Собеседник отключился");
    return;
  }
  if (message.type === "hello" && typeof message.id === "string" && message.id !== localId) {
    try {
      peerId = message.id;
      peerName = typeof message.name === "string" && message.name.trim() ? message.name.trim().slice(0, 32) : "Собеседник";
      elements.remoteName.textContent = peerName;
      elements.remoteAvatar.textContent = initials(peerName);
      elements.remoteTitle.textContent = `${peerName} подключился`;
      elements.remoteCopy.textContent = "Устанавливаем видеосвязь…";
      elements.participantCount.textContent = "2 из 2 участников";
      elements.participantHint.textContent = peerName;
      elements.peerMiniAvatar.textContent = initials(peerName);
      elements.peerMiniAvatar.classList.add("mini-avatar-connected");
      elements.participantStatus.classList.add("online");
      setStatus("Подключаем видеосвязь…", "connecting");
      await ensurePeerConnection();
      if (localId < peerId && !peerConnection.localDescription) {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        sendSignal({ type: "offer", description: peerConnection.localDescription });
      }
    } catch (error) {
      showToast(`Не удалось начать видеосвязь: ${error.message}`, true);
    }
    return;
  }

  try {
    if (message.type === "offer" && message.description) {
      await ensurePeerConnection();
      await peerConnection.setRemoteDescription(message.description);
      await applyPendingCandidates();
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      sendSignal({ type: "answer", description: peerConnection.localDescription });
    } else if (message.type === "answer" && message.description && peerConnection) {
      await peerConnection.setRemoteDescription(message.description);
      await applyPendingCandidates();
    } else if (message.type === "ice-candidate" && message.candidate) {
      if (peerId) {
        if (peerConnection?.remoteDescription) await peerConnection.addIceCandidate(message.candidate);
        else pendingCandidates.push(message.candidate);
      }
    }
  } catch (error) {
    showToast(`Не удалось установить видеосвязь: ${error.message}`, true);
  }
}

async function applyPendingCandidates() {
  const candidates = pendingCandidates;
  pendingCandidates = [];
  for (const candidate of candidates) await peerConnection.addIceCandidate(candidate);
}

async function ensurePeerConnection() {
  if (peerConnection) return;
  peerConnection = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  for (const track of localStream.getTracks()) peerConnection.addTrack(track, localStream);
  peerConnection.addEventListener("icecandidate", ({ candidate }) => {
    if (candidate) sendSignal({ type: "ice-candidate", candidate });
  });
  peerConnection.addEventListener("track", ({ streams }) => {
    const [remoteStream] = streams;
    if (!remoteStream) return;
    elements.remoteVideo.srcObject = remoteStream;
    elements.remoteVideo.hidden = false;
    elements.remotePlaceholder.hidden = true;
    elements.remoteLabel.hidden = false;
  });
  peerConnection.addEventListener("connectionstatechange", () => {
    const state = peerConnection?.connectionState;
    if (state === "connected") {
      setStatus("Вы на связи", "connected");
      elements.remoteTitle.textContent = `Вы на связи с ${peerName}`;
      elements.remoteCopy.textContent = "Хорошего разговора";
      elements.participantHint.textContent = "Видеосвязь активна";
      startTimer();
    } else if (state === "failed") {
      setStatus("Не удалось установить связь", "error");
      showToast("Соединение не установлено. Попробуйте подключиться ещё раз.", true);
    } else if (state === "disconnected") {
      setStatus("Соединение прервано", "connecting");
    }
  });
}

function handleSocketClose(event) {
  if (event.currentTarget !== socket) return;
  socket = null;

  cleanupMedia();
  resetPeer();
  elements.joinButton.hidden = false;
  elements.leaveButton.hidden = true;
  elements.nameInput.disabled = false;
  setJoining(false);
  setStatus("Соединение с сервером потеряно", "error");
  elements.participantHint.textContent = "Нет соединения с сервером";
  showToast("Соединение с сервером завершено. Подключитесь снова.", true);
}

function cleanupMedia() {
  if (localStream) {
    for (const track of localStream.getTracks()) track.stop();
    localStream = null;
  }
  elements.localVideo.srcObject = null;
  elements.localVideo.hidden = true;
  elements.localPlaceholder.hidden = false;
  elements.micButton.classList.remove("active", "off");
  elements.cameraButton.classList.remove("active", "off");
  elements.micButton.disabled = true;
  elements.cameraButton.disabled = true;
  elements.micButton.setAttribute("aria-pressed", "false");
  elements.cameraButton.setAttribute("aria-pressed", "false");
  elements.micLabel.textContent = "Микрофон";
  elements.cameraLabel.textContent = "Камера";
  elements.localMicIndicator.hidden = true;
}

function resetPeer() {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  pendingCandidates = [];
  peerId = null;
  elements.remoteVideo.srcObject = null;
  elements.remoteVideo.hidden = true;
  elements.remotePlaceholder.hidden = false;
  elements.remoteLabel.hidden = true;
  elements.remoteTitle.textContent = "Здесь будет ваш собеседник";
  elements.remoteCopy.textContent = "Подключитесь — и мы сообщим, когда он появится";
  elements.remoteAvatar.textContent = "?";
  elements.participantCount.textContent = "1 из 2 участников";
  elements.participantHint.textContent = socket ? "Ожидаем собеседника" : "Ожидаем собеседника";
  elements.peerMiniAvatar.textContent = "+";
  elements.peerMiniAvatar.classList.remove("mini-avatar-connected");
  elements.participantStatus.classList.remove("online");
  stopTimer();
}

function startTimer() {
  if (timerInterval) return;
  sessionStartedAt = Date.now();
  elements.duration.hidden = false;
  timerInterval = setInterval(() => {
    const seconds = Math.floor((Date.now() - sessionStartedAt) / 1000);
    elements.duration.textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  }, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
  elements.duration.hidden = true;
  elements.duration.textContent = "00:00";
}

function toggleTrack(kind) {
  const trackKind = kind === "mic" ? "audio" : "video";
  const track = localStream?.getTracks().find((item) => item.kind === trackKind);
  if (!track) return;
  track.enabled = !track.enabled;
  const enabled = track.enabled;
  const button = kind === "mic" ? elements.micButton : elements.cameraButton;
  const label = kind === "mic" ? elements.micLabel : elements.cameraLabel;
  button.classList.toggle("active", enabled);
  button.classList.toggle("off", !enabled);
  button.setAttribute("aria-pressed", String(enabled));
  label.textContent = enabled ? (kind === "mic" ? "Микрофон" : "Камера") : "Выключено";
  if (kind === "mic") elements.localMicIndicator.hidden = enabled;
  else {
    elements.localVideo.hidden = !enabled;
    elements.localPlaceholder.hidden = enabled;
  }
}

async function leaveCall() {
  const activeSocket = socket;
  socket = null;
  activeSocket?.close();
  resetPeer();
  cleanupMedia();
  elements.joinButton.hidden = false;
  elements.leaveButton.hidden = true;
  elements.nameInput.disabled = false;
  setJoining(false);
  setStatus("Вы пока одни");
}

elements.joinButton.addEventListener("click", connect);
elements.leaveButton.addEventListener("click", leaveCall);
elements.micButton.addEventListener("click", () => toggleTrack("mic"));
elements.cameraButton.addEventListener("click", () => toggleTrack("camera"));
elements.nameInput.addEventListener("input", () => {
  const displayName = getDisplayName();
  elements.localName.textContent = displayName;
  elements.localAvatar.textContent = initials(displayName);
  elements.youMiniAvatar.textContent = initials(displayName);
});
elements.fullscreenButton.addEventListener("click", async () => {
  const target = document.querySelector("#video-stage");
  try {
    if (!document.fullscreenElement) await target.requestFullscreen();
    else await document.exitFullscreen();
  } catch (error) {
    showToast(`Не удалось развернуть видео: ${error.message}`, true);
  }
});

elements.localPlaceholder.hidden = false;
elements.remoteVideo.hidden = true;
elements.joinButton.hidden = false;
elements.leaveButton.hidden = true;
