import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { BmsBluetooth, DEFAULT_SERVICE_UUID, RX_UUID, TX_UUID, validateServiceUuid } from '../web/ble.js';
import { MAX_IMPORT_BYTES, parseCycleText } from '../web/app.js';
import { READ_BLOCKS, buildReadRequest, bytesToHex, hexToBytes, crc16 } from '../web/protocol.js';

const SERVICE = '12345678-1234-1234-1234-123456789abc';
const demo = JSON.parse(readFileSync(new URL('./fixtures/cycle-synthetic.json', import.meta.url)));
const frames = Object.fromEntries(READ_BLOCKS.map(({ key }) => [key, hexToBytes(demo.frames[key])]));
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

class Target extends EventTarget {
  listeners = new Map();
  addEventListener(type, listener) {
    super.addEventListener(type, listener);
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) {
    super.removeEventListener(type, listener);
    this.listeners.get(type)?.delete(listener);
  }
  listenerCount(type) { return this.listeners.get(type)?.size ?? 0; }
}

function rig({ serviceUuid = SERVICE, includeTx = true, txProperties = { write: true }, rxProperties = { notify: true, write: true }, hooks = {}, onWrite } = {}) {
  const calls = [], states = [], writes = [], gate = {};
  class Characteristic extends Target {
    constructor(uuid, properties) { super(); this.uuid = uuid; this.properties = properties; }
    async startNotifications() { calls.push('notify'); await hooks.notify?.(); return this; }
    async writeValueWithResponse(bytes) { return write('response', bytes); }
    async writeValueWithoutResponse(bytes) { return write('without-response', bytes); }
    emit(bytes) {
      const padded = new Uint8Array(bytes.length + 6);
      padded.set(bytes, 3);
      this.value = new DataView(padded.buffer, 3, bytes.length);
      this.dispatchEvent(new Event('characteristicvaluechanged'));
    }
  }
  const rx = new Characteristic(RX_UUID, rxProperties);
  const tx = new Characteristic(TX_UUID, txProperties);
  const service = {
    uuid: serviceUuid,
    async getCharacteristics() { calls.push('characteristics'); await hooks.characteristics?.(); return includeTx ? [rx, tx] : [rx]; },
  };
  const device = new Target();
  device.name = 'BMS simulé'; device.id = 'fake-device';
  device.gatt = {
    connected: false, disconnects: 0,
    async connect() { calls.push('gatt'); await hooks.gatt?.(); this.connected = true; return this; },
    async getPrimaryService(uuid) {
      calls.push(['service', uuid]);
      await hooks.service?.();
      assert.ok(bluetooth.requests.at(-1).optionalServices.includes(uuid));
      if (uuid !== service.uuid) throw new DOMException('Service absent', 'NotFoundError');
      return service;
    },
    disconnect() { this.disconnects++; this.connected = false; device.dispatchEvent(new Event('gattserverdisconnected')); },
  };
  const bluetooth = {
    requests: [],
    async requestDevice(options) { this.requests.push(options); calls.push('picker'); await hooks.picker?.(); return device; },
  };
  const ble = new BmsBluetooth({ bluetooth, timeoutMs: 1000, onState: state => states.push(state) });
  const result = { ble, bluetooth, device, rx, tx, calls, writes, states, service, gate };
  async function write(method, bytes) {
    const block = READ_BLOCKS.find(block => block.address === ((bytes[2] << 8) | bytes[3]));
    writes.push({ method, key: block?.key, bytes: bytes.slice() });
    if (onWrite) return onWrite(result, block, bytes);
    for (let offset = 0; offset < frames[block.key].length; offset += 20) rx.emit(frames[block.key].subarray(offset, offset + 20));
  }
  return result;
}

function assertClean(fake) {
  assert.equal(fake.device.gatt.connected, false);
  assert.equal(fake.device.listenerCount('gattserverdisconnected'), 0);
  assert.equal(fake.rx.listenerCount('characteristicvaluechanged'), 0);
}

test('service personnalisé validé avant requestDevice et aucune lecture à la connexion', async () => {
  const fake = rig();
  for (const uuid of [null, 'ffe0', '0000ffe0', 'invalid', `${SERVICE}0`]) {
    await assert.rejects(fake.ble.connect(uuid), /UUID/);
  }
  assert.equal(fake.bluetooth.requests.length, 0);
  assert.equal(validateServiceUuid(` ${SERVICE.toUpperCase()} `), SERVICE);
  await fake.ble.connect(SERVICE);
  assert.deepEqual(fake.bluetooth.requests, [{ acceptAllDevices: true, optionalServices: [SERVICE] }]);
  assert.deepEqual(fake.calls, ['picker', 'gatt', ['service', SERVICE], 'characteristics', 'notify']);
  assert.equal(fake.writes.length, 0);
  assert.equal(fake.ble.state, 'connected');
  fake.ble.disconnect();
  assertClean(fake);
  await assert.rejects(new BmsBluetooth({ bluetooth: null }).connect(SERVICE), /indisponible/);
});

test('sélecteur Chrome sans saisie : FFE0 candidat, aucun filtre ni lecture automatique', async () => {
  assert.equal(DEFAULT_SERVICE_UUID, '0000ffe0-0000-1000-8000-00805f9b34fb');
  for (const input of [undefined, '', ' \t\n']) {
    const fake = rig({ serviceUuid: DEFAULT_SERVICE_UUID });
    const result = await fake.ble.connect(input);
    assert.deepEqual(fake.bluetooth.requests, [{ acceptAllDevices: true, optionalServices: [DEFAULT_SERVICE_UUID] }]);
    assert.equal(result.service, DEFAULT_SERVICE_UUID);
    assert.equal(fake.ble.events.find(event => event.event === 'service').uuid, DEFAULT_SERVICE_UUID);
    assert.equal(fake.writes.length, 0);
    assert.equal(fake.ble.state, 'connected');
    const cycle = await fake.ble.readCycle();
    assert.equal(cycle.capture.service, DEFAULT_SERVICE_UUID);
    assert.equal(fake.writes.length, READ_BLOCKS.length);
    fake.ble.disconnect();
    assertClean(fake);
  }
  for (const input of ['', undefined, null]) assert.throws(() => validateServiceUuid(input), /UUID/);
});

test('service FFE0 absent : diagnostic, fermeture et nouvelle sélection avec service personnalisé', async () => {
  const fake = rig();
  await assert.rejects(fake.ble.connect(), error => /Service.*introuvable.*Service personnalisé/.test(error.message) && error.cause?.name === 'NotFoundError');
  assert.equal(fake.ble.state, 'error');
  assert.equal(fake.writes.length, 0);
  assertClean(fake);
  const result = await fake.ble.connect(SERVICE);
  assert.equal(result.service, SERVICE);
  const cycle = await fake.ble.readCycle();
  assert.equal(cycle.capture.service, SERVICE);
  assert.equal(fake.writes.length, READ_BLOCKS.length);
  fake.ble.disconnect();
  assertClean(fake);
});

test('annulation du sélecteur : erreur conservée et aucun accès GATT', async () => {
  const cancellation = new DOMException('User cancelled', 'NotFoundError');
  const fake = rig({ hooks: { picker: () => { throw cancellation; } } });
  await assert.rejects(fake.ble.connect(), error => error === cancellation);
  assert.deepEqual(fake.calls, ['picker']);
  assert.equal(fake.writes.length, 0);
  assertClean(fake);
});

test('un cycle manuel strict, FFE2 avec réponse, notifications fragmentées avant fin du write', async () => {
  const fake = rig({ txProperties: { write: true, writeWithoutResponse: true } });
  await fake.ble.connect(SERVICE);
  const result = await fake.ble.readCycle();
  assert.equal(fake.writes.length, READ_BLOCKS.length);
  assert.deepEqual(fake.writes.map(write => bytesToHex(write.bytes)), READ_BLOCKS.map(block => bytesToHex(buildReadRequest(block.key))));
  assert.deepEqual(fake.writes.map(write => write.method), READ_BLOCKS.map(() => 'response'));
  assert.equal(result.snapshot.voltageV, 74);
  assert.equal(result.capture.evidence, 'capture');
  assert.equal(result.capture.service, SERVICE);
  assert.equal(result.capture.device.name, 'BMS simulé');
  assert.ok(Number.isFinite(Date.parse(result.capture.timestamp)));
  assert.deepEqual(result.capture.frames, demo.frames);
  assert.equal(parseCycleText(JSON.stringify(result.capture)).snapshot.currentA, -5.25);
  assert.equal(fake.ble.state, 'connected');
  const events = fake.ble.events;
  assert.deepEqual(events.filter(event => event.event === 'characteristic').map(event => event.uuid), [RX_UUID, TX_UUID]);
  assert.equal(events.find(event => event.event === 'characteristic' && event.uuid === TX_UUID).properties.write, true);
  for (const { key } of READ_BLOCKS) {
    assert.ok(events.findIndex(event => event.event === 'write-complete' && event.key === key) < events.findIndex(event => event.event === 'response' && event.key === key));
  }
  fake.ble.disconnect();
});

test('FFE1 seulement si FFE2 absente ; withoutResponse seulement si propriété annoncée', async () => {
  for (const options of [
    { includeTx: false },
    { txProperties: { writeWithoutResponse: true } },
    { includeTx: false, rxProperties: { notify: true, writeWithoutResponse: true } },
  ]) {
    const fake = rig(options);
    await fake.ble.connect(SERVICE);
    await fake.ble.readCycle();
    assert.equal(fake.ble.events.find(event => event.event === 'transport').tx, options.includeTx === false ? RX_UUID : TX_UUID);
    assert.equal(fake.writes[0].method, options.txProperties?.writeWithoutResponse || options.rxProperties?.writeWithoutResponse ? 'without-response' : 'response');
    fake.ble.disconnect();
  }
  for (const options of [
    { txProperties: {} },
    { includeTx: false, rxProperties: { notify: true } },
    { rxProperties: { indicate: true, write: true } },
  ]) {
    const fake = rig(options);
    await assert.rejects(fake.ble.connect(SERVICE), /TX|RX/);
    assert.equal(fake.writes.length, 0);
    assertClean(fake);
  }
  const fake = rig({ txProperties: { write: true, writeWithoutResponse: true } });
  fake.tx.writeValueWithResponse = undefined;
  await assert.rejects(fake.ble.connect(SERVICE), /méthode/);
  assertClean(fake);
});

test('aucun commit ni commande suivante avant succès write ; lectures concurrentes bloquées', async () => {
  const writing = deferred();
  const fake = rig({ onWrite(fake, block) {
    fake.rx.emit(frames[block.key]);
    if (block.key === 'profile') return writing.promise;
  } });
  await fake.ble.connect(SERVICE);
  const reading = fake.ble.readCycle();
  let settled = false;
  reading.then(() => { settled = true; });
  await tick();
  assert.equal(settled, false);
  assert.equal(fake.writes.length, 1);
  assert.equal(fake.ble.events.some(event => event.event === 'response'), false);
  await assert.rejects(fake.ble.readCycle(), /déjà en cours/);
  writing.resolve();
  const result = await reading;
  assert.equal(result.snapshot.cellCount, 20);
  assert.equal(fake.writes.length, READ_BLOCKS.length);
  fake.ble.disconnect();
});

test('échec write après notification valide propagé sans résultat ni fallback ni retry', async () => {
  const error = new Error('échec GATT write');
  const fake = rig({ txProperties: { write: true, writeWithoutResponse: true }, onWrite(fake, block) {
    fake.rx.emit(frames[block.key]);
    throw error;
  } });
  await fake.ble.connect(SERVICE);
  await assert.rejects(fake.ble.readCycle(), caught => caught === error);
  assert.equal(fake.writes.length, 1);
  assert.equal(fake.ble.events.some(event => event.event === 'response' || event.event === 'cycle-complete'), false);
  assert.equal(fake.ble.state, 'error');
  assertClean(fake);
});

test('déconnexion annule pending même si write ne résout pas, sans réactivation tardive', async () => {
  const writing = deferred();
  const fake = rig({ onWrite: () => writing.promise });
  await fake.ble.connect(SERVICE);
  const reading = fake.ble.readCycle();
  const rejection = assert.rejects(reading, /fermée/);
  await tick();
  fake.ble.disconnect();
  await rejection;
  assertClean(fake);
  writing.resolve();
  await tick();
  assert.equal(fake.ble.state, 'disconnected');
  assert.equal(fake.writes.length, 1);
  assert.equal(fake.ble.events.some(event => event.event === 'cycle-complete'), false);
  await assert.rejects(fake.ble.readCycle(), /Connectez/);
});

test('timeout ferme le GATT, rejette write bloquée, et ignore toute réponse tardive', async () => {
  const writing = deferred();
  const fake = rig({ onWrite: () => writing.promise });
  const ble = new BmsBluetooth({ bluetooth: fake.bluetooth, timeoutMs: 20 });
  await ble.connect(SERVICE);
  await assert.rejects(ble.readCycle(), /Délai.*Connexion fermée/);
  assertClean(fake);
  fake.rx.emit(frames.summary);
  writing.resolve();
  await tick();
  assert.equal(fake.writes.length, 1);
  assert.equal(ble.state, 'error');
  assert.equal(ble.events.some(event => event.event === 'response' || event.event === 'cycle-complete'), false);
  await assert.rejects(ble.readCycle(), /Connectez/);
});

test('déconnexion à chaque étape asynchrone de connexion retire tous les handlers et résultats', async t => {
  for (const stage of ['picker', 'gatt', 'service', 'characteristics', 'notify']) {
    await t.test(stage, async () => {
      const wait = deferred();
      const reached = deferred();
      const fake = rig({ hooks: { [stage]: () => { reached.resolve(); return wait.promise; } } });
      const connecting = fake.ble.connect(SERVICE);
      const rejection = assert.rejects(connecting, /interrompue/);
      await reached.promise;
      fake.ble.disconnect();
      await assert.rejects(fake.ble.connect(SERVICE), /déjà ouverte|fermeture/);
      wait.resolve();
      await rejection;
      assertClean(fake);
      assert.equal(fake.ble.state, 'disconnected');
      assert.equal(fake.states.includes('connected'), false);
      assert.equal(fake.writes.length, 0);
      await fake.ble.connect(SERVICE);
      assert.equal(fake.ble.state, 'connected');
      fake.ble.disconnect();
    });
  }
});

test('erreurs GATT de découverte et notify remontent telles quelles', async t => {
  for (const stage of ['picker', 'gatt', 'service', 'characteristics', 'notify']) {
    await t.test(stage, async () => {
      const error = new Error(`GATT ${stage}`);
      const fake = rig({ hooks: { [stage]: () => { throw error; } } });
      await assert.rejects(fake.ble.connect(SERVICE), caught => caught === error);
      assertClean(fake);
      assert.equal(fake.ble.state, 'error');
      assert.equal(fake.writes.length, 0);
    });
  }
});

test('notification hors pending seulement journalisée et journal borné à 500 événements', async () => {
  const fake = rig();
  await fake.ble.connect(SERVICE);
  for (let index = 0; index < 510; index++) fake.rx.emit(Uint8Array.of(255, index & 255));
  assert.equal(fake.ble.events.length, 500);
  assert.ok(fake.ble.events.every(event => event.event === 'unexpected-notification'));
  assert.equal(fake.writes.length, 0);
  assert.equal(fake.ble.state, 'connected');
  fake.rx.emit(new Uint8Array(2048));
  assert.equal(fake.ble.events.at(-1).truncated, true);
  assert.equal(fake.ble.events.at(-1).hex.split(' ').length, 256);
  const diagnostics = fake.ble.exportDiagnostics();
  assert.equal(diagnostics.format, 'yybms-diagnostics-v1');
  assert.equal(diagnostics.events.length, 500);
  fake.ble.disconnect();
});

test('CRC, longueur, adresse, fonction, exception et excès invalident le cycle et ferment le lien', async t => {
  const corrupt = frames.profile.slice(); corrupt[10] ^= 1;
  for (const bytes of [corrupt, Uint8Array.of(2), Uint8Array.of(1, 17), Uint8Array.of(1, 3, 2), new Uint8Array(1000), Uint8Array.of(1, 0x83, 2, 0xc0, 0xf1)]) {
    await t.test(bytesToHex(bytes.subarray(0, 6)), async () => {
      const fake = rig({ onWrite: fake => fake.rx.emit(bytes) });
      await fake.ble.connect(SERVICE);
      await assert.rejects(fake.ble.readCycle(), /CRC|Adresse|Fonction|Longueur|longue|Exception/);
      assert.equal(fake.writes.length, 1);
      assertClean(fake);
      assert.equal(fake.ble.events.some(event => event.event === 'cycle-complete'), false);
    });
  }
});

test('signature inconnue : une seule consultation, aucune lecture des blocs B ni cycle validé', async () => {
  const frame = frames.profile.slice();
  frame[3] ^= 1;
  const crc = crc16(frame.subarray(0, -2));
  frame[frame.length - 2] = crc & 255;
  frame[frame.length - 1] = crc >>> 8;
  const fake = rig({ onWrite: fake => fake.rx.emit(frame) });
  await fake.ble.connect(SERVICE);
  await assert.rejects(fake.ble.readCycle(), /Profil.*non pris en charge/);
  assert.equal(fake.writes.length, 1);
  assert.equal(fake.writes[0].key, 'profile');
  assert.equal(fake.ble.events.some(event => event.event === 'cycle-complete'), false);
  assertClean(fake);
});

test('sous-variante thermique non prise en charge : arrêt après summary et fermeture du lien', async () => {
  const summary = frames.summary.slice();
  summary.set(Uint8Array.of(0x59, 0x48), 5);
  summary[126] = 112;
  const crc = crc16(summary.subarray(0, -2));
  summary[summary.length - 2] = crc & 255;
  summary[summary.length - 1] = crc >>> 8;
  const fake = rig({ onWrite: (fake, block) => fake.rx.emit(block.key === 'summary' ? summary : frames[block.key]) });
  await fake.ble.connect(SERVICE);
  await assert.rejects(fake.ble.readCycle(), /Sous-variante thermique/);
  assert.deepEqual(fake.writes.map(write => write.key), ['profile', 'summary']);
  assert.equal(fake.ble.events.some(event => event.event === 'cycle-complete'), false);
  assertClean(fake);
});

test('import strict borné en octets, export réimportable, métadonnées jamais utilisées comme commandes', () => {
  const result = parseCycleText(JSON.stringify(demo));
  assert.equal(result.capture.evidence, 'synthetic');
  assert.equal(result.snapshot.voltageV, 74);
  assert.deepEqual(result.capture.frames, demo.frames);
  assert.equal(parseCycleText(JSON.stringify(result.capture)).snapshot.cellsV.length, 20);
  assert.throws(() => parseCycleText(' '.repeat(MAX_IMPORT_BYTES + 1)), /1 Mo/);
  assert.throws(() => parseCycleText('é'.repeat(MAX_IMPORT_BYTES / 2 + 1)), /1 Mo/);
  assert.throws(() => parseCycleText('{'), SyntaxError);
  assert.throws(() => parseCycleText(JSON.stringify({ ...demo, frames: { ...demo.frames, balance: '01 03 00' } })), /tronquée/);
  const input = { ...demo, service: 'not-a-service', timestamp: 'bad-date', device: { name: '<script>alert(1)</script>' }, commands: ['reset'], events: [{ event: 'request' }] };
  const parsed = parseCycleText(JSON.stringify(input));
  assert.equal(parsed.capture.service, undefined);
  assert.equal(parsed.capture.timestamp, undefined);
  assert.equal(parsed.capture.commands, undefined);
  assert.equal(parsed.capture.events, undefined);
  assert.equal(parsed.capture.device.name, input.device.name);
  assert.equal(parseCycleText(JSON.stringify({ ...demo, stale: true })).capture.stale, true);
});
