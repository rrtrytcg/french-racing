// Classroom multiplayer transport for APEX / French Racing.
//
// The teacher's browser is the authoritative host: it runs the race engine and
// relays every game message over a Supabase Realtime Broadcast channel (one
// channel per room, no database tables, no RLS policies to configure).
// Learners join from their own devices through a QR code or a room code plus
// a 4-digit password.
//
// A transport is a tiny interface so tests and demos can swap the real
// Supabase channel for an in-memory loopback pair:
//
//   send(payload)  broadcast one plain-JSON payload to every peer (not self)
//   close()        leave the channel and release listeners
//
// Incoming payloads arrive through the onMessage callback given at creation.
export const PARTY_CHANNEL_PREFIX = 'apex-party-';
export const MAX_PLAYERS = 16;
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CONFIG_STORAGE_KEY = 'apex.supabase.v1';
export const SUPABASE_MODULE_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
const BROADCAST_EVENT = 'party';

export function makeRoomCode(random = Math.random) {
  let code = '';
  for (let i = 0; i < 4; i += 1) code += ROOM_CODE_ALPHABET[Math.floor(random() * ROOM_CODE_ALPHABET.length)];
  return code;
}

export function makeRoomPassword(random = Math.random) {
  return String(Math.floor(random() * 9000) + 1000);
}

export function isRoomCode(value) {
  return typeof value === 'string' && /^[A-Z0-9]{4}$/.test(value) && [...value].every((ch) => ROOM_CODE_ALPHABET.includes(ch));
}

export function isRoomPassword(value) {
  return typeof value === 'string' && /^[0-9]{4}$/.test(value);
}

export function channelName(roomCode) {
  if (!isRoomCode(roomCode)) throw new Error('Invalid room code');
  return `${PARTY_CHANNEL_PREFIX}${roomCode}`;
}

// Learner display names: trimmed, single-spaced, at most 18 characters.
// Returns '' when nothing usable remains; rendering must still escape output.
export function sanitizeName(value) {
  const clean = String(value ?? '').replace(/\s+/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 18);
  return clean;
}

export function uniqueName(wanted, taken) {
  const base = sanitizeName(wanted) || 'Driver';
  const used = new Set((taken || []).map((name) => sanitizeName(name).toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let n = 2; n < 99; n += 1) {
    const candidate = `${base} ${n}`.slice(0, 18);
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return `${base} ${Math.floor(Math.random() * 900 + 100)}`.slice(0, 18);
}

export function joinUrl(base, roomCode, password) {
  if (!isRoomCode(roomCode)) throw new Error('Invalid room code');
  if (!isRoomPassword(password)) throw new Error('Invalid room password');
  const root = String(base || '').replace(/#.*$/, '').replace(/\/+$/, '');
  return `${root}/#/join/${roomCode}/${password}`;
}

export function parseJoinHash(hash) {
  const match = /^#\/join\/([A-Za-z0-9]{4})(?:\/([0-9]{4}))?\/?$/.exec(String(hash || '').trim());
  if (!match) return null;
  const code = match[1].toUpperCase();
  if (!isRoomCode(code)) return null;
  return { code, password: match[2] || '' };
}

export function makeGuestId(random = Math.random) {
  return `g${Date.now().toString(36)}${Math.floor(random() * 0xffffffff).toString(36)}`;
}

export function isPlainMessage(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && typeof value.kind === 'string';
}

// In-memory broadcast bus. Every attached transport receives every payload
// sent by the others (never its own), mirroring Supabase self:false semantics.
// Delivery is synchronous so tests stay deterministic.
export function createLoopbackBus() {
  const peers = new Set();
  return {
    attach(onMessage) {
      const peer = { onMessage, alive: true };
      peers.add(peer);
      return {
        send(payload) {
          if (!peer.alive) return;
          for (const other of peers) {
            if (other === peer || !other.alive) continue;
            other.onMessage(payload);
          }
        },
        close() { peer.alive = false; peers.delete(peer); },
      };
    },
  };
}

// Supabase Realtime Broadcast transport. Payloads are queued until the
// channel reports SUBSCRIBED so early sends (join requests on load) survive.
export async function createSupabaseTransport({ url, key, roomCode, onMessage, onStatus, clientFactory } = {}) {
  if (!url || !key) throw new Error('Supabase URL and anon key are required');
  const name = channelName(roomCode);
  const notify = (status, detail) => { try { onStatus && onStatus(status, detail); } catch {} };
  const makeClient = clientFactory || (async () => {
    const module = await import(SUPABASE_MODULE_URL);
    return module.createClient(url, key, { realtime: { params: { eventsPerSecond: 20 } } });
  });
  const client = await makeClient();
  const queue = [];
  let subscribed = false;
  let closed = false;
  const channel = client.channel(name, { config: { broadcast: { self: false, ack: false } } });
  channel.on('broadcast', { event: BROADCAST_EVENT }, ({ payload }) => {
    if (closed || !isPlainMessage(payload)) return;
    try { onMessage(payload); } catch {}
  });
  const ready = await new Promise((resolve) => {
    channel.subscribe((status, error) => {
      notify(status, error);
      if (status === 'SUBSCRIBED') {
        subscribed = true;
        while (queue.length && !closed) channel.send({ type: 'broadcast', event: BROADCAST_EVENT, payload: queue.shift() });
        resolve(true);
      } else if (status === 'TIMED_OUT' || status === 'CHANNEL_ERROR' || status === 'CLOSED') {
        subscribed = false;
        resolve(false);
      }
    });
  });
  return {
    get subscribed() { return subscribed; },
    ready,
    send(payload) {
      if (closed || !isPlainMessage(payload)) return;
      if (!subscribed) { queue.push(payload); return; }
      try { channel.send({ type: 'broadcast', event: BROADCAST_EVENT, payload }); } catch {}
    },
    close() {
      closed = true;
      try { client.removeChannel(channel); } catch {}
    },
  };
}

// Config resolution order: a supabase-config.js file next to the app (so every
// classroom device inherits it from the same origin), then this browser's
// stored paste, then null (the UI explains the one-time setup).
export async function loadPartyConfig({ storage = null, configModule = null } = {}) {
  if (configModule === null) {
    try {
      configModule = await import('../supabase-config.js');
    } catch {
      configModule = {};
    }
  }
  const fileUrl = String(configModule?.SUPABASE_URL || '').trim();
  const fileKey = String(configModule?.SUPABASE_ANON_KEY || '').trim();
  if (fileUrl && fileKey) return { url: fileUrl, key: fileKey, source: 'file' };
  const store = storage || (typeof localStorage === 'undefined' ? null : localStorage);
  if (store) {
    try {
      const parsed = JSON.parse(store.getItem(CONFIG_STORAGE_KEY) || 'null');
      const url = String(parsed?.url || '').trim(), key = String(parsed?.key || '').trim();
      if (url && key) return { url, key, source: 'browser' };
    } catch {}
  }
  return null;
}

export function savePartyConfig(url, key, storage = null) {
  const cleanUrl = String(url || '').trim().replace(/\/+$/, '');
  const cleanKey = String(key || '').trim();
  if (!/^https:\/\/.+\.supabase\.co$/.test(cleanUrl) || cleanKey.length < 20) {
    return { ok: false, error: 'Paste the https://xyz.supabase.co project URL and the anon public key from Supabase → Project Settings → API.' };
  }
  try {
    const store = storage || localStorage;
    store.setItem(CONFIG_STORAGE_KEY, JSON.stringify({ url: cleanUrl, key: cleanKey }));
    return { ok: true };
  } catch {
    return { ok: false, error: 'This browser refused to store the keys. Keep this tab open: hosting still works until you close it.' };
  }
}
