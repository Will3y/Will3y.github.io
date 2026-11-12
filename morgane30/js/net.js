// Liaison entre le PC hôte et les téléphones.
//  - Mode normal : PeerJS (WebRTC), le PC hôte sert d'arbitre.
//  - Mode test (?local=1) : BroadcastChannel, pour tester avec plusieurs onglets du même navigateur.
//
// Un "conn" exposé au reste de l'appli : { id, send(obj), onData(fn), onClose(fn), close(), open }

const PREFIX = 'morgane30-blindtest-';

export const isLocalMode = () => new URLSearchParams(location.search).has('local');
const peerIdFor = (code) => PREFIX + code.toUpperCase();

function makeConn(id, sendRaw, closeRaw) {
  const dataFns = [];
  const closeFns = [];
  let open = true;
  return {
    id,
    get open() { return open; },
    send(obj) { if (open) { try { sendRaw(obj); } catch (e) { console.warn('send failed', e); } } },
    onData(fn) { dataFns.push(fn); },
    onClose(fn) { closeFns.push(fn); },
    close() { if (!open) return; try { closeRaw(); } catch (e) { /* ignore */ } this._closed(); },
    _data(msg) { if (open) dataFns.forEach((fn) => fn(msg)); },
    _closed() { if (!open) return; open = false; closeFns.splice(0).forEach((fn) => fn()); },
  };
}

/* ------------------------------------------------------------------ */
/* Hôte                                                                */
/* ------------------------------------------------------------------ */

/**
 * @param {string} code  code du salon
 * @param {{onConnect:(conn)=>void, onStatus:(s:string)=>void}} h
 *   statuts : 'connecting' | 'online' | 'reconnecting' | 'waiting-id' | 'id-taken'
 */
export function createHost(code, h) {
  return isLocalMode() ? localHost(code, h) : peerHost(code, h);
}

function peerHost(code, h) {
  let peer = null;
  let stopped = false;
  let takenRetries = 0;
  let watchdog = null;

  const start = () => {
    if (stopped) return;
    h.onStatus('connecting');
    peer = new window.Peer(peerIdFor(code), { debug: 1 });

    peer.on('open', () => { takenRetries = 0; h.onStatus('online'); });

    peer.on('connection', (dc) => {
      const conn = makeConn(dc.peer, (o) => dc.send(o), () => dc.close());
      dc.on('data', (d) => conn._data(typeof d === 'string' ? safeParse(d) : d));
      dc.on('close', () => conn._closed());
      dc.on('error', () => conn._closed());
      dc.on('open', () => h.onConnect(conn));
    });

    peer.on('disconnected', () => { if (!stopped) h.onStatus('reconnecting'); });

    peer.on('error', (err) => {
      if (err.type === 'unavailable-id') {
        // Après un rechargement de la page, le serveur garde l'ancien identifiant quelques secondes.
        peer.destroy();
        if (takenRetries++ < 8) {
          h.onStatus('waiting-id');
          setTimeout(start, 3000);
        } else {
          h.onStatus('id-taken');
        }
      } else {
        console.warn('[peer host]', err.type, err);
      }
    });
  };

  start();

  // Si le serveur de mise en relation décroche, on se reconnecte tout seul.
  watchdog = setInterval(() => {
    if (stopped || !peer) return;
    if (peer.destroyed) {
      if (takenRetries === 0) start();
    } else if (peer.disconnected) {
      try { peer.reconnect(); } catch (e) { /* ignore */ }
    }
  }, 4000);

  return {
    destroy() { stopped = true; clearInterval(watchdog); if (peer) peer.destroy(); },
  };
}

function localHost(code, h) {
  const bc = new BroadcastChannel('bt-local-' + code.toUpperCase());
  const conns = new Map();
  bc.onmessage = ({ data: m }) => {
    if (!m || m.to) return;
    if (m.kind === 'open') {
      conns.get(m.from)?._closed();
      const conn = makeConn(m.from,
        (o) => bc.postMessage({ kind: 'data', to: m.from, data: o }),
        () => bc.postMessage({ kind: 'close', to: m.from }));
      conns.set(m.from, conn);
      conn.onClose(() => conns.delete(m.from));
      bc.postMessage({ kind: 'accept', to: m.from });
      h.onConnect(conn);
    } else if (m.kind === 'data') {
      conns.get(m.from)?._data(m.data);
    } else if (m.kind === 'close') {
      conns.get(m.from)?._closed();
    }
  };
  setTimeout(() => h.onStatus('online'), 50);
  return { destroy() { conns.forEach((c) => c.close()); bc.close(); } };
}

/* ------------------------------------------------------------------ */
/* Téléphone                                                           */
/* ------------------------------------------------------------------ */

/**
 * Client téléphone : client.connect(code) ouvre (ou rouvre) la connexion vers l'hôte.
 * @param {{onOpen:(conn)=>void, onClose:()=>void, onError:(type:string)=>void}} h
 */
export function createClient(h) {
  return isLocalMode() ? localClient(h) : peerClient(h);
}

function peerClient(h) {
  let peer = null;
  let current = null;
  let token = 0;

  const ensurePeer = () => new Promise((resolve) => {
    if (peer && !peer.destroyed && !peer.disconnected && peer.open) return resolve(peer);
    if (peer && !peer.destroyed && peer.disconnected) {
      try { peer.reconnect(); } catch (e) { /* ignore */ }
    } else {
      if (peer) peer.destroy();
      peer = new window.Peer({ debug: 1 });
      peer.on('error', (err) => {
        console.warn('[peer client]', err.type, err);
        if (err.type === 'peer-unavailable') h.onError('host-not-found');
        else if (['network', 'server-error', 'socket-error', 'socket-closed', 'browser-incompatible'].includes(err.type)) h.onError(err.type);
      });
    }
    const p = peer;
    if (p.open && !p.disconnected) return resolve(p);
    const onOpen = () => { p.off('open', onOpen); resolve(p); };
    p.on('open', onOpen);
  });

  return {
    async connect(code) {
      const mine = ++token;
      if (current) { current.close(); current = null; }
      const p = await ensurePeer();
      if (mine !== token) return; // une tentative plus récente a pris le relais
      const dc = p.connect(peerIdFor(code), { serialization: 'json', reliable: true });
      const conn = makeConn(dc.peer, (o) => dc.send(o), () => dc.close());
      current = conn;
      dc.on('open', () => h.onOpen(conn));
      dc.on('data', (d) => conn._data(typeof d === 'string' ? safeParse(d) : d));
      const closed = () => { const was = conn.open; conn._closed(); if (was && current === conn) h.onClose(); };
      dc.on('close', closed);
      dc.on('error', closed);
    },
    disconnect() { token++; if (current) current.close(); current = null; },
  };
}

function localClient(h) {
  const myId = 'local-' + Math.random().toString(36).slice(2, 10);
  let bc = null;
  let current = null;
  return {
    connect(code) {
      if (current) current.close();
      if (bc) bc.close();
      bc = new BroadcastChannel('bt-local-' + code.toUpperCase());
      const conn = makeConn(myId,
        (o) => bc.postMessage({ kind: 'data', from: myId, data: o }),
        () => bc.postMessage({ kind: 'close', from: myId }));
      current = conn;
      let accepted = false;
      bc.onmessage = ({ data: m }) => {
        if (!m || m.to !== myId) return;
        if (m.kind === 'accept') { accepted = true; h.onOpen(conn); }
        else if (m.kind === 'data') conn._data(m.data);
        else if (m.kind === 'close') { conn._closed(); h.onClose(); }
      };
      bc.postMessage({ kind: 'open', from: myId });
      setTimeout(() => { if (!accepted && current === conn) h.onError('host-not-found'); }, 2500);
    },
    disconnect() { if (current) current.close(); current = null; },
  };
}

function safeParse(s) { try { return JSON.parse(s); } catch (e) { return null; } }
