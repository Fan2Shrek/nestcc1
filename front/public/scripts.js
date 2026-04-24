const appShell = document.querySelector(".app-shell");
const API_BASE_URL = appShell?.dataset.apiBaseUrl || "http://localhost:3000";
const REACTION_OPTIONS = ["👍", "❤️", "😂", "🔥", "🎉"];

const registerForm = document.getElementById("register-form");
const loginForm = document.getElementById("login-form");
const profileForm = document.getElementById("profile-form");
const createRoomForm = document.getElementById("create-room-form");
const inviteForm = document.getElementById("invite-form");
const messageForm = document.getElementById("message-form");
const messageInput = document.getElementById("message-content");
const refreshRoomsButton = document.getElementById("refresh-rooms");
const logoutButton = document.getElementById("logout-button");

const roomsListEl = document.getElementById("rooms-list");
const messagesListEl = document.getElementById("messages-list");
const activeRoomNameEl = document.getElementById("active-room-name");
const activeRoomMetaEl = document.getElementById("active-room-meta");
const typingIndicatorEl = document.getElementById("typing-indicator");
const sessionEmailEl = document.getElementById("session-email");
const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");

const profileUsernameInput = document.getElementById("profile-username");
const profileColorInput = document.getElementById("profile-color");

const state = {
  token: localStorage.getItem("authToken") || "",
  user: localStorage.getItem("authUser") ? JSON.parse(localStorage.getItem("authUser")) : null,
  socket: null,
  rooms: [],
  messagesByRoomId: {},
  typingByRoomId: {},
  activeRoomId: "",
  typingDebounceTimer: null,
};

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.className = `status ${isError ? "error" : "success"}`;
}

function setResult(data) {
  resultEl.textContent = typeof data === "string" ? data : JSON.stringify(data, null, 2);
}

function setDisconnectedChatState() {
  activeRoomNameEl.textContent = "Aucun salon selectionne";
  activeRoomMetaEl.textContent = "Selectionne un salon pour lire et envoyer des messages.";
  typingIndicatorEl.textContent = "";
  messagesListEl.innerHTML = "";
}

function updateSessionUi() {
  const isConnected = Boolean(state.token && state.user);
  sessionEmailEl.textContent = isConnected ? `${state.user.username} (${state.user.email})` : "Non connecte";
  sessionEmailEl.style.color = isConnected ? state.user.color : "#616161";

  logoutButton.disabled = !isConnected;
  profileForm.querySelector("button").disabled = !isConnected;
  createRoomForm.querySelector("button").disabled = !isConnected;
  refreshRoomsButton.disabled = !isConnected;

  const roomActionEnabled = isConnected && Boolean(state.activeRoomId);
  inviteForm.querySelector("button").disabled = !roomActionEnabled;
  messageForm.querySelector("button").disabled = !roomActionEnabled;
  messageInput.disabled = !roomActionEnabled;
}

async function request(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = body.message || `Erreur HTTP ${response.status}`;
    throw new Error(Array.isArray(message) ? message.join(", ") : message);
  }

  return body;
}

function normalizeSocketPayload(payload) {
  if (!payload) {
    return { ok: false, error: "No response" };
  }

  if (typeof payload.ok === "boolean") {
    return payload;
  }

  return { ok: true, data: payload };
}

function socketCall(eventName, payload = {}) {
  return new Promise((resolve, reject) => {
    if (!state.socket || !state.socket.connected) {
      reject(new Error("Socket non connecte"));
      return;
    }

    state.socket.emit(eventName, payload, (ackPayload) => {
      const ack = normalizeSocketPayload(ackPayload);
      if (!ack.ok) {
        reject(new Error(ack.error || "Erreur WebSocket"));
        return;
      }

      resolve(ack.data);
    });
  });
}

function setTypingIndicator(roomId, typingState) {
  if (!roomId) {
    typingIndicatorEl.textContent = "";
    return;
  }

  state.typingByRoomId[roomId] = typingState;

  if (state.activeRoomId !== roomId) {
    return;
  }

  const users = (typingState?.users || []).filter((entry) => entry.id !== state.user?.id);

  if (!users.length) {
    typingIndicatorEl.textContent = "";
    return;
  }

  if (users.length === 1) {
    typingIndicatorEl.textContent = `${users[0].username} est en train d'ecrire...`;
    return;
  }

  typingIndicatorEl.textContent = `${users.map((entry) => entry.username).join(", ")} sont en train d'ecrire...`;
}

function renderRooms() {
  roomsListEl.innerHTML = "";

  if (!state.rooms.length) {
    const emptyItem = document.createElement("li");
    emptyItem.className = "room-item muted-item";
    emptyItem.textContent = state.token ? "Aucun salon. Cree le premier." : "Connecte-toi pour voir tes salons.";
    roomsListEl.appendChild(emptyItem);
    return;
  }

  for (const room of state.rooms) {
    const item = document.createElement("li");
    item.className = `room-item ${room.id === state.activeRoomId ? "active" : ""}`;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "room-button";
    button.textContent = room.isGeneral ? `# ${room.name}` : room.name;
    button.addEventListener("click", async () => {
      await selectRoom(room.id);
    });

    item.appendChild(button);
    roomsListEl.appendChild(item);
  }
}

function createReactionButton(roomId, messageId, emoji, users) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "reaction-chip";
  const usernames = users.map((entry) => entry.username).join(", ");
  button.title = usernames ? `Par: ${usernames}` : "Aucune reaction";
  button.textContent = `${emoji} ${users.length}`;
  button.addEventListener("click", async () => {
    try {
      const updated = await socketCall("reaction:toggle", {
        roomId,
        messageId,
        reaction: { emoji },
      });
      setResult(updated);
      applyMessageUpdate(roomId, updated);
      renderMessages();
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  return button;
}

function createQuickReactionButton(roomId, messageId, emoji) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "reaction-quick";
  button.textContent = emoji;
  button.addEventListener("click", async () => {
    try {
      const updated = await socketCall("reaction:toggle", {
        roomId,
        messageId,
        reaction: { emoji },
      });
      setResult(updated);
      applyMessageUpdate(roomId, updated);
      renderMessages();
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  return button;
}

function renderMessages() {
  messagesListEl.innerHTML = "";

  const room = state.rooms.find((entry) => entry.id === state.activeRoomId);
  if (!room) {
    setDisconnectedChatState();
    updateSessionUi();
    return;
  }

  activeRoomNameEl.textContent = room.name;
  activeRoomMetaEl.textContent = `${room.members.length} membre(s)`;

  const messages = state.messagesByRoomId[room.id] || [];

  if (!messages.length) {
    const empty = document.createElement("p");
    empty.className = "muted-text";
    empty.textContent = "Pas encore de message dans ce salon.";
    messagesListEl.appendChild(empty);
    updateSessionUi();
    setTypingIndicator(room.id, state.typingByRoomId[room.id] || { users: [] });
    return;
  }

  for (const message of messages) {
    const card = document.createElement("article");
    card.className = "message-item";

    const head = document.createElement("div");
    head.className = "message-head";

    const author = document.createElement("strong");
    author.textContent = message.author.username;
    author.style.color = message.author.color;

    const timestamp = document.createElement("span");
    timestamp.textContent = new Date(message.createdAt).toLocaleString("fr-FR");

    head.appendChild(author);
    head.appendChild(timestamp);

    const text = document.createElement("p");
    text.textContent = message.content;

    const reactionLine = document.createElement("div");
    reactionLine.className = "reaction-line";

    for (const reaction of message.reactions || []) {
      reactionLine.appendChild(createReactionButton(room.id, message.id, reaction.emoji, reaction.users));
    }

    const quickLine = document.createElement("div");
    quickLine.className = "reaction-quick-line";
    for (const emoji of REACTION_OPTIONS) {
      quickLine.appendChild(createQuickReactionButton(room.id, message.id, emoji));
    }

    card.appendChild(head);
    card.appendChild(text);
    card.appendChild(reactionLine);
    card.appendChild(quickLine);
    messagesListEl.appendChild(card);
  }

  messagesListEl.scrollTop = messagesListEl.scrollHeight;
  updateSessionUi();
  setTypingIndicator(room.id, state.typingByRoomId[room.id] || { users: [] });
}

function replaceRooms(rooms) {
  state.rooms = Array.isArray(rooms) ? rooms : [];

  if (!state.rooms.some((entry) => entry.id === state.activeRoomId)) {
    state.activeRoomId = state.rooms[0]?.id || "";
  }

  renderRooms();
}

function applyMessageUpdate(roomId, message) {
  if (!roomId || !message) {
    return;
  }

  if (!state.messagesByRoomId[roomId]) {
    state.messagesByRoomId[roomId] = [];
  }

  const existingIndex = state.messagesByRoomId[roomId].findIndex((entry) => entry.id === message.id);

  if (existingIndex === -1) {
    state.messagesByRoomId[roomId].push(message);
  } else {
    state.messagesByRoomId[roomId][existingIndex] = message;
  }
}

async function fetchRoomsViaSocket(selectRoomId = "") {
  const rooms = await socketCall("rooms:list");
  replaceRooms(rooms);

  if (selectRoomId) {
    state.activeRoomId = selectRoomId;
    renderRooms();
  }

  if (state.activeRoomId) {
    await selectRoom(state.activeRoomId);
  } else {
    setDisconnectedChatState();
    updateSessionUi();
  }
}

async function refreshRoomMessages(roomId) {
  if (!state.socket || !state.socket.connected || !roomId) {
    return;
  }

  const messages = await socketCall("room:messages", { roomId });
  state.messagesByRoomId[roomId] = Array.isArray(messages) ? messages : [];

  const typingState = await socketCall("typing:get", { roomId });
  setTypingIndicator(roomId, typingState);

  if (state.activeRoomId === roomId) {
    renderMessages();
  }
}

async function selectRoom(roomId) {
  if (!state.socket || !state.socket.connected || !roomId) {
    return;
  }

  state.activeRoomId = roomId;
  renderRooms();
  updateSessionUi();

  await refreshRoomMessages(roomId);
}

function tearDownSocket() {
  if (!state.socket) {
    return;
  }

  state.socket.off();
  state.socket.disconnect();
  state.socket = null;
}

function connectSocket() {
  tearDownSocket();

  if (!state.token) {
    return;
  }

  state.socket = window.io(API_BASE_URL, {
    transports: ["websocket"],
    auth: {
      token: state.token,
    },
  });

  state.socket.on("connect", async () => {
    setStatus("Connecte au chat temps reel.");
    try {
      await fetchRoomsViaSocket(state.activeRoomId);
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  state.socket.on("disconnect", () => {
    setStatus("Connexion chat interrompue.", true);
  });

  state.socket.on("connect_error", (error) => {
    setStatus(error?.message || "Erreur de connexion WebSocket", true);
  });

  state.socket.on("chat:error", (payload) => {
    const message = payload?.message || "Erreur chat";
    setStatus(message, true);
  });

  state.socket.on("rooms:updated", (rooms) => {
    const previousActiveRoom = state.activeRoomId;
    replaceRooms(rooms);

    if (state.activeRoomId && previousActiveRoom && state.activeRoomId === previousActiveRoom) {
      return;
    }

    if (state.activeRoomId) {
      refreshRoomMessages(state.activeRoomId).catch((error) => {
        setStatus(error.message, true);
      });
    }
  });

  state.socket.on("message:new", (payload) => {
    const roomId = payload?.roomId;
    const message = payload?.message;
    if (!roomId || !message) {
      return;
    }

    applyMessageUpdate(roomId, message);

    if (roomId === state.activeRoomId) {
      refreshRoomMessages(roomId).catch((error) => {
        setStatus(error.message, true);
      });
    }
  });

  state.socket.on("message:updated", (payload) => {
    const roomId = payload?.roomId;
    const message = payload?.message;
    if (!roomId || !message) {
      return;
    }

    applyMessageUpdate(roomId, message);

    if (roomId === state.activeRoomId) {
      refreshRoomMessages(roomId).catch((error) => {
        setStatus(error.message, true);
      });
    }
  });

  state.socket.on("typing:updated", (typingState) => {
    const roomId = typingState?.roomId;
    if (!roomId) {
      return;
    }

    setTypingIndicator(roomId, typingState);
  });
}

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("Creation du compte en cours...");

  const formData = new FormData(registerForm);
  const payload = {
    email: String(formData.get("email") || "").trim(),
    password: String(formData.get("password") || ""),
    username: String(formData.get("username") || "").trim() || undefined,
    color: String(formData.get("color") || "").trim() || undefined,
  };

  try {
    const result = await request("/auth/register", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    setStatus("Compte cree avec succes.");
    setResult(result);
    registerForm.reset();
  } catch (error) {
    setStatus(error.message, true);
  }
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("Connexion en cours...");

  const formData = new FormData(loginForm);
  const payload = {
    email: String(formData.get("email") || "").trim(),
    password: String(formData.get("password") || ""),
  };

  try {
    const result = await request("/auth/login", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    state.token = result.token;
    state.user = result.user;
    localStorage.setItem("authToken", result.token);
    localStorage.setItem("authUser", JSON.stringify(result.user));
    profileUsernameInput.value = result.user.username;
    profileColorInput.value = result.user.color;
    state.messagesByRoomId = {};
    state.typingByRoomId = {};
    state.activeRoomId = "";
    updateSessionUi();
    connectSocket();
    setResult(result);
    setStatus("Connexion reussie.");
    loginForm.reset();
  } catch (error) {
    setStatus(error.message, true);
  }
});

profileForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!state.token) {
    setStatus("Connecte-toi pour modifier ton profil.", true);
    return;
  }

  const formData = new FormData(profileForm);
  const payload = {
    username: String(formData.get("username") || "").trim(),
    color: String(formData.get("color") || "").trim(),
  };

  try {
    const profile = await request("/auth/me", {
      method: "PATCH",
      body: JSON.stringify(payload),
    });

    state.user = profile;
    localStorage.setItem("authUser", JSON.stringify(profile));
    updateSessionUi();
    renderMessages();
    setResult(profile);
    setStatus("Profil mis a jour.");
  } catch (error) {
    setStatus(error.message, true);
  }
});

createRoomForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!state.token) {
    setStatus("Connecte-toi avant de creer un salon.", true);
    return;
  }

  const formData = new FormData(createRoomForm);
  const inviteEmail = String(formData.get("inviteEmail") || "").trim();
  const payload = {
    name: String(formData.get("name") || "").trim(),
    invitees: inviteEmail
      ? [
          {
            email: inviteEmail,
            canAccessHistory: Boolean(formData.get("canAccessHistory")),
          },
        ]
      : [],
  };

  try {
    const room = await socketCall("room:create", payload);
    setResult(room);
    setStatus("Salon cree.");
    createRoomForm.reset();
    await fetchRoomsViaSocket(room.id);
  } catch (error) {
    setStatus(error.message, true);
  }
});

inviteForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!state.token || !state.activeRoomId) {
    setStatus("Selectionne un salon avant d'inviter.", true);
    return;
  }

  const formData = new FormData(inviteForm);
  const payload = {
    roomId: state.activeRoomId,
    invitee: {
      email: String(formData.get("email") || "").trim(),
      canAccessHistory: Boolean(formData.get("canAccessHistory")),
    },
  };

  try {
    const room = await socketCall("room:invite", payload);
    setResult(room);
    setStatus("Invitation envoyee.");
    inviteForm.reset();
    await fetchRoomsViaSocket(state.activeRoomId);
  } catch (error) {
    setStatus(error.message, true);
  }
});

messageForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!state.token || !state.activeRoomId) {
    setStatus("Selectionne un salon avant d'envoyer un message.", true);
    return;
  }

  const formData = new FormData(messageForm);
  const content = String(formData.get("content") || "").trim();

  if (!content) {
    setStatus("Le message est vide.", true);
    return;
  }

  try {
    const message = await socketCall("message:send", {
      roomId: state.activeRoomId,
      message: { content },
    });

    setResult(message);
    setStatus("Message envoye.");
    messageForm.reset();

    await socketCall("typing:set", {
      roomId: state.activeRoomId,
      typing: { isTyping: false },
    });

    applyMessageUpdate(state.activeRoomId, message);
    await refreshRoomMessages(state.activeRoomId);
  } catch (error) {
    setStatus(error.message, true);
  }
});

messageInput.addEventListener("input", async () => {
  if (!state.token || !state.activeRoomId || !state.socket?.connected) {
    return;
  }

  try {
    await socketCall("typing:set", {
      roomId: state.activeRoomId,
      typing: { isTyping: true },
    });
  } catch {
    // Ignore typing errors during input.
  }

  if (state.typingDebounceTimer) {
    window.clearTimeout(state.typingDebounceTimer);
  }

  state.typingDebounceTimer = window.setTimeout(async () => {
    try {
      await socketCall("typing:set", {
        roomId: state.activeRoomId,
        typing: { isTyping: false },
      });
    } catch {
      // Ignore debounce errors.
    }
  }, 1200);
});

refreshRoomsButton.addEventListener("click", async () => {
  if (!state.token) {
    setStatus("Connecte-toi avant de rafraichir les salons.", true);
    return;
  }

  try {
    await fetchRoomsViaSocket(state.activeRoomId);
    setStatus("Salons rafraichis.");
  } catch (error) {
    setStatus(error.message, true);
  }
});

logoutButton.addEventListener("click", async () => {
  if (state.socket?.connected && state.activeRoomId) {
    try {
      await socketCall("typing:set", {
        roomId: state.activeRoomId,
        typing: { isTyping: false },
      });
    } catch {
      // Continue logout even if typing reset fails.
    }
  }

  if (state.typingDebounceTimer) {
    window.clearTimeout(state.typingDebounceTimer);
    state.typingDebounceTimer = null;
  }

  tearDownSocket();

  state.token = "";
  state.user = null;
  state.rooms = [];
  state.messagesByRoomId = {};
  state.typingByRoomId = {};
  state.activeRoomId = "";
  localStorage.removeItem("authToken");
  localStorage.removeItem("authUser");

  profileUsernameInput.value = "";
  profileColorInput.value = "#e06c2f";

  renderRooms();
  setDisconnectedChatState();
  updateSessionUi();
  setStatus("Deconnecte.");
  setResult("Aucune action effectuee.");
});

updateSessionUi();
renderRooms();
setDisconnectedChatState();

if (state.token && state.user) {
  profileUsernameInput.value = state.user.username;
  profileColorInput.value = state.user.color;
  connectSocket();
}
