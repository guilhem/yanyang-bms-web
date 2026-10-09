import { localizedError } from './i18n.js';
import { CYCLE_FORMAT, READ_BLOCKS, ReadResponseBuffer, buildReadRequest, bytesToHex, decodeReadResponse, decodeSnapshot } from './protocol.js?v=yybms-b-2';

export const RX_UUID = '0000ffe1-0000-1000-8000-00805f9b34fb';
export const TX_UUID = '0000ffe2-0000-1000-8000-00805f9b34fb';
// FFE0 observé sur YY-NiuN-FEC2 ; la signature du protocole reste vérifiée avant les autres lectures.
export const DEFAULT_SERVICE_UUID = '0000ffe0-0000-1000-8000-00805f9b34fb';

export function validateServiceUuid(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim())) {
    throw localizedError("Renseignez un UUID de service complet, relevé sur votre appareil.");
  }
  return value.trim().toLowerCase();
}

const propertiesOf = characteristic => Object.fromEntries(
  ['read', 'write', 'writeWithoutResponse', 'notify', 'indicate'].map(key => [key, Boolean(characteristic.properties[key])]),
);

export class BmsBluetooth {
  #bluetooth;
  #timeoutMs;
  #onState;
  #onEvent;
  #session = null;
  #connecting = false;
  #sequence = 0;
  #state = 'disconnected';
  #events = [];

  constructor({ bluetooth = globalThis.navigator?.bluetooth, timeoutMs = 3000, onState = () => {}, onEvent = () => {} } = {}) {
    this.#bluetooth = bluetooth;
    this.#timeoutMs = timeoutMs;
    this.#onState = onState;
    this.#onEvent = onEvent;
  }

  get state() { return this.#state; }
  get events() { return this.#events.map(event => ({ ...event })); }

  #log(event, details = {}, session = this.#session) {
    const entry = { timestamp: new Date().toISOString(), session: session?.id ?? null, event, ...details };
    this.#events.push(entry);
    if (this.#events.length > 500) this.#events.shift();
    this.#onEvent(entry);
  }

  #setState(state) {
    this.#state = state;
    this.#onState(state);
  }

  #cleanup(session) {
    session.device?.removeEventListener('gattserverdisconnected', session.onDisconnect);
    session.rx?.removeEventListener('characteristicvaluechanged', session.onNotification);
    if (session.device?.gatt?.connected && (!this.#session || this.#session === session || this.#session.device !== session.device)) {
      try { session.device.gatt.disconnect(); }
      catch (error) { this.#log('cleanup-error', { message: error.message }, session); }
    }
  }

  #assertCurrent(session) {
    if (session.closed || this.#session !== session) {
      this.#cleanup(session);
      throw localizedError("Session Bluetooth interrompue.");
    }
  }

  #rejectPending(session, error) {
    const pending = session.pending;
    if (!pending) return;
    session.pending = null;
    clearTimeout(pending.timer);
    pending.reject(error);
  }

  #close(session, error, state) {
    if (session.closed) return;
    session.closed = true;
    this.#rejectPending(session, error);
    this.#cleanup(session);
    this.#log(state, { message: error.message }, session);
    if (this.#session === session) {
      this.#session = null;
      this.#setState(state);
    }
  }

  disconnect() {
    if (this.#session) this.#close(this.#session, localizedError("Connexion Bluetooth fermée."), 'disconnected');
  }

  async connect(serviceUuid = DEFAULT_SERVICE_UUID) {
    const uuid = validateServiceUuid(typeof serviceUuid === 'string' && !serviceUuid.trim() ? DEFAULT_SERVICE_UUID : serviceUuid);
    if (!this.#bluetooth) throw localizedError("Web Bluetooth est indisponible dans ce navigateur.");
    if (this.#session || this.#connecting) throw localizedError("Une session Bluetooth est déjà ouverte ou en cours de fermeture.");
    const session = { id: ++this.#sequence, serviceUuid: uuid, closed: false, busy: false, pending: null };
    this.#session = session;
    this.#connecting = true;
    this.#setState('connecting');
    this.#log('request-device', { serviceUuid: uuid }, session);
    try {
      session.device = await this.#bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: [uuid] });
      this.#assertCurrent(session);
      session.onDisconnect = () => this.#close(session, localizedError("L’appareil s’est déconnecté."), 'disconnected');
      session.device.addEventListener('gattserverdisconnected', session.onDisconnect);
      this.#log('device', { name: session.device.name ?? null, id: session.device.id }, session);
      session.server = await session.device.gatt.connect();
      this.#assertCurrent(session);
      let service;
      try { service = await session.server.getPrimaryService(uuid); }
      catch (error) {
        if (error.name === 'NotFoundError') {
          throw localizedError("Service BLE {{uuid}} introuvable. Renseignez le service de votre BMS dans « Service personnalisé », puis choisissez à nouveau l’appareil.", { uuid }, Error, error);
        }
        throw error;
      }
      this.#assertCurrent(session);
      this.#log('service', { uuid: service.uuid }, session);
      const characteristics = await service.getCharacteristics();
      this.#assertCurrent(session);
      for (const characteristic of characteristics) {
        this.#log('characteristic', { uuid: characteristic.uuid, properties: propertiesOf(characteristic) }, session);
      }
      session.rx = characteristics.find(characteristic => characteristic.uuid.toLowerCase() === RX_UUID);
      session.tx = characteristics.find(characteristic => characteristic.uuid.toLowerCase() === TX_UUID) ?? session.rx;
      if (!session.rx?.properties.notify) throw localizedError("La caractéristique RX FFE1 doit annoncer notify.");
      if (session.tx?.properties.write) session.writeMethod = 'writeValueWithResponse';
      else if (session.tx?.properties.writeWithoutResponse) session.writeMethod = 'writeValueWithoutResponse';
      else throw localizedError("La caractéristique TX sélectionnée n’annonce aucune écriture compatible.");
      if (typeof session.tx[session.writeMethod] !== 'function') throw localizedError("Cette méthode d’écriture GATT est indisponible dans le navigateur.");
      this.#log('transport', { rx: session.rx.uuid, tx: session.tx.uuid, writeMethod: session.writeMethod }, session);
      session.onNotification = event => this.#notification(session, event);
      session.rx.addEventListener('characteristicvaluechanged', session.onNotification);
      await session.rx.startNotifications();
      this.#assertCurrent(session);
      this.#setState('connected');
      this.#log('connected', {}, session);
      return { device: { name: session.device.name ?? null, id: session.device.id }, service: uuid };
    } catch (error) {
      this.#close(session, error, 'error');
      throw error;
    } finally {
      this.#connecting = false;
    }
  }

  #complete(session, pending) {
    if (this.#session !== session || session.closed || session.pending !== pending || !pending.writeSucceeded || !pending.frame) return;
    session.pending = null;
    clearTimeout(pending.timer);
    this.#log('response', { key: pending.key, hex: bytesToHex(pending.frame) }, session);
    pending.resolve(pending.frame);
  }

  #notification(session, event) {
    if (session.closed || this.#session !== session) return;
    try {
      const value = event.target.value;
      const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      const pending = session.pending;
      this.#log(pending ? 'notification' : 'unexpected-notification', {
        uuid: session.rx.uuid, key: pending?.key ?? null, byteLength: bytes.length,
        hex: bytesToHex(bytes.subarray(0, 256)), truncated: bytes.length > 256,
      }, session);
      if (!pending) return;
      if (pending.frame) throw localizedError("Notification supplémentaire avant la fin de l’écriture.");
      pending.frame = pending.buffer.push(bytes);
      this.#complete(session, pending);
    } catch (error) {
      this.#close(session, error, 'error');
    }
  }

  #readBlock(session, key) {
    this.#assertCurrent(session);
    const request = buildReadRequest(key);
    const pending = { key, buffer: new ReadResponseBuffer(key), frame: null, writeSucceeded: false };
    const response = new Promise((resolve, reject) => Object.assign(pending, { resolve, reject }));
    session.pending = pending;
    pending.timer = setTimeout(() => {
      this.#close(session, localizedError("Délai de réponse dépassé pour {{key}} ({{ms}} ms). Connexion fermée.", { key, ms: this.#timeoutMs }), 'error');
    }, this.#timeoutMs);
    this.#log('request', { key, uuid: session.tx.uuid, hex: bytesToHex(request) }, session);
    // Le pending précède l’écriture : une notification peut arriver avant sa résolution.
    Promise.resolve().then(() => {
      this.#assertCurrent(session);
      return session.tx[session.writeMethod](request);
    }).then(() => {
      if (session.closed || this.#session !== session || session.pending !== pending) return;
      pending.writeSucceeded = true;
      this.#log('write-complete', { key }, session);
      this.#complete(session, pending);
    }, error => this.#close(session, error, 'error'));
    return response;
  }

  async readCycle() {
    const session = this.#session;
    if (session?.busy) throw localizedError("Une lecture est déjà en cours.");
    if (!session || this.#state !== 'connected') throw localizedError("Connectez un appareil avant la lecture.");
    session.busy = true;
    this.#setState('reading');
    const frames = {};
    try {
      for (const block of READ_BLOCKS) {
        frames[block.key] = await this.#readBlock(session, block.key);
        this.#assertCurrent(session);
        if (block.key === 'profile' || block.key === 'summary') decodeReadResponse(block.key, frames[block.key]);
      }
      const snapshot = decodeSnapshot(frames);
      this.#assertCurrent(session);
      const capture = {
        format: CYCLE_FORMAT, evidence: 'capture', timestamp: new Date().toISOString(),
        device: { name: session.device.name ?? null, id: session.device.id }, service: session.serviceUuid,
        frames: Object.fromEntries(READ_BLOCKS.map(({ key }) => [key, bytesToHex(frames[key])])),
      };
      this.#log('cycle-complete', {}, session);
      return { snapshot, capture };
    } catch (error) {
      this.#close(session, error, 'error');
      throw error;
    } finally {
      session.busy = false;
      if (!session.closed && this.#session === session) this.#setState('connected');
    }
  }

  exportDiagnostics() {
    return { format: 'yybms-diagnostics-v1', timestamp: new Date().toISOString(), events: this.events };
  }
}
