import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { CYCLE_FORMAT, READ_BLOCKS, crc16, buildReadRequest, bytesToHex, hexToBytes, ReadResponseBuffer, decodeCapture, decodeSnapshot, decodeReadResponse } from '../web/protocol.js';

const capture = JSON.parse(readFileSync(new URL('./fixtures/cycle-synthetic.json', import.meta.url)));
const fresh = () => decodeCapture(capture);
function withCrc(bytes) {
  const crc = crc16(bytes.subarray(0, -2));
  bytes[bytes.length - 2] = crc & 255;
  bytes[bytes.length - 1] = crc >>> 8;
  return bytes;
}
function set16(frame, offset, value) { new DataView(frame.buffer, frame.byteOffset).setUint16(offset + 3, value, true); }
function set32(frame, offset, value) { new DataView(frame.buffer, frame.byteOffset).setUint32(offset + 3, value, true); }

test('consultation limitée à la signature et aux quatre requêtes YYBMS B', () => {
  const requests = JSON.parse(readFileSync(new URL('./fixtures/read-requests.json', import.meta.url)));
  for (const { key } of READ_BLOCKS) assert.equal(bytesToHex(buildReadRequest(key)), requests[key]);
  assert.equal(crc16(new TextEncoder().encode('123456789')), 0x4b37);
  assert.throws(() => buildReadRequest('reset'), /inconnu/);
  assert.throws(() => { READ_BLOCKS[0].address = 10; }, TypeError);
  const request = buildReadRequest('profile'); request[1] = 17;
  assert.equal(buildReadRequest('profile')[1], 3);
});

test('fixture synthétique du profil B : little endian, courant signé et sondes séparées', () => {
  const { snapshot } = fresh();
  assert.equal(capture.evidence, 'synthetic');
  assert.equal(capture.format, CYCLE_FORMAT);
  assert.equal(snapshot.profile, 'yybms-b');
  assert.equal(snapshot.voltageV, 74);
  assert.equal(snapshot.currentA, -5.25);
  assert.equal(snapshot.socPercent, 84);
  assert.equal(snapshot.remainingCapacityAh, 35.2);
  assert.equal(snapshot.ratedCapacityAh, 44);
  assert.equal(snapshot.uptimeSeconds, 123456);
  assert.equal(snapshot.model, 'YY-BCU13-NIU-N');
  assert.equal(snapshot.serialNumber, '0102030405060708');
  assert.equal(snapshot.hardwareVersion, 2.01);
  assert.equal(snapshot.softwareVersion, 1.26);
  assert.equal(snapshot.bootloaderVersion, 1);
  assert.deepEqual(snapshot.temperaturesC, [25, 27, 28, 29]);
  assert.equal(snapshot.mosTemperatureC, 31);
  assert.equal(snapshot.balanceTemperatureC, 30);
  assert.equal(snapshot.cellsV.length, 20);
  assert.equal(snapshot.cellsV[0], 3.695);
  assert.equal(snapshot.cellsV[19], 3.705);
  assert.equal(snapshot.cellSpreadMv, 10);
  assert.equal(snapshot.balanced.filter(Boolean).length, 2);
  assert.equal(snapshot.balanced[19], true);
  assert.equal(snapshot.status, 'En décharge');
  assert.equal(snapshot.chargeEnabled, true);
  assert.equal(snapshot.dischargeEnabled, true);
  assert.equal(snapshot.cycles, 123);
  assert.equal(snapshot.powerW, -388.5);
  assert.equal(snapshot.powerReportedRaw, -389);
  assert.equal(snapshot.remainingEnergyRaw, 2600);
  assert.equal(snapshot.remainingEnergyWh, null);
  assert.deepEqual(snapshot.calibration, { shuntGain: 1234, shuntOffset: -100, shuntGain2: 2345, shuntOffset2: -200 });
  assert.equal(snapshot.thresholds.chargeOvercurrentRaw, -1000);
  assert.equal(snapshot.thresholds.chargeOvercurrentConvertedA, 10);
  assert.equal(snapshot.thresholds.mosOvertemperatureRaw, 120);
  assert.equal('mosOvertemperatureC' in snapshot.thresholds, false);
  assert.deepEqual(snapshot.warnings, []);
});

test('réassemblage indépendant du MTU pour chacune des cinq réponses', () => {
  const { frames } = fresh();
  for (const { key } of READ_BLOCKS) {
    const frame = frames[key];
    for (const size of [1, 2, 3, 7, 20, frame.length]) {
      const buffer = new ReadResponseBuffer(key);
      for (let offset = 0; offset < frame.length; offset += size) {
        const result = buffer.push(frame.subarray(offset, offset + size));
        if (offset + size < frame.length) assert.equal(result, null);
        else assert.deepEqual(result, frame);
      }
      assert.throws(() => buffer.push(Uint8Array.of(0)), /supplémentaire/);
    }
    const buffer = new ReadResponseBuffer(key);
    assert.equal(buffer.push(frame.subarray(0, -1)), null);
    assert.deepEqual(buffer.push(frame.subarray(-1)), frame);
  }
});

test('rejet CRC, adresse, fonction, longueur, exceptions et cycle incomplet', () => {
  const { frames } = fresh();
  assert.throws(() => decodeReadResponse('summary', frames.summary.subarray(0, -1)), /CRC|Longueur/);
  frames.summary[25] ^= 1;
  assert.throws(() => decodeReadResponse('summary', frames.summary), /CRC/);
  assert.throws(() => new ReadResponseBuffer('profile').push(frames.status), /longue/);
  assert.throws(() => new ReadResponseBuffer('profile').push(Uint8Array.of(2)), /Adresse/);
  assert.throws(() => new ReadResponseBuffer('profile').push(Uint8Array.of(1, 17)), /Fonction/);
  assert.throws(() => new ReadResponseBuffer('profile').push(Uint8Array.of(1, 3, 1)), /Longueur/);
  const exception = withCrc(Uint8Array.of(1, 0x83, 2, 0, 0));
  assert.throws(() => new ReadResponseBuffer('profile').push(exception), /Exception Modbus 0x02/);
  exception[4] ^= 1;
  assert.throws(() => new ReadResponseBuffer('profile').push(exception), /CRC/);
  assert.throws(() => decodeSnapshot({ profile: fresh().frames.profile }), /binaire/);
});

test('signatures, nombre de cellules et nombre de sondes ne sont jamais devinés', () => {
  const { frames } = fresh();
  frames.profile[3] ^= 1;
  assert.throws(() => decodeSnapshot({ ...frames, profile: withCrc(frames.profile) }), /Profil.*non pris en charge/);
  frames.profile = fresh().frames.profile;
  frames.summary[127] ^= 1;
  assert.throws(() => decodeSnapshot({ ...frames, summary: withCrc(frames.summary) }), /Signature/);
  for (const [offset, value] of [[148, 0], [148, 26], [103, 9], [104, 2], [105, 2]]) {
    const current = fresh().frames;
    current.summary[offset + 3] = value;
    assert.throws(() => decodeSnapshot({ ...current, summary: withCrc(current.summary) }), /profil/);
  }
});

test('cellule et température invalides indisponibles ; index erroné signalé sans clamp', () => {
  const { frames } = fresh();
  frames.summary[151] = 25;
  frames.summary[106] = 8;
  set16(frames.status, 2, 35);
  frames.status[69] = 166;
  frames.status[65] = 250;
  frames.status[66] = 250;
  frames.status[83] = 110;
  const snapshot = decodeSnapshot({ ...frames, summary: withCrc(frames.summary), status: withCrc(frames.status) });
  assert.equal(snapshot.cellsV.length, 25);
  assert.equal(snapshot.cellsV[0], null);
  assert.equal(snapshot.cellSpreadMv, null);
  assert.equal(snapshot.temperaturesC.length, 8);
  assert.equal(snapshot.temperaturesC[0], null);
  assert.equal(snapshot.socPercent, 110);
  assert.ok(snapshot.warnings.some(value => value.key.includes('Index min/max')));
  assert.ok(snapshot.warnings.some(value => value.key.includes('températures')));
});

test('sous-variantes thermiques HB/O2 refusées avant toute conversion', () => {
  for (const prefix of ['0001', '5948', '0008', '0009', '000A', '010A']) {
    const { frames } = fresh();
    frames.summary.set(hexToBytes(prefix), 5);
    frames.summary[126] = 112;
    assert.throws(() => decodeSnapshot({ ...frames, summary: withCrc(frames.summary) }), /Sous-variante thermique/);
  }
});

test('R143, R158 et R159 restent distincts et bruts, sans delta ni masque de préalertes', () => {
  const { frames } = fresh();
  set16(frames.status, 126, 4100);
  set16(frames.status, 156, 8400);
  set16(frames.status, 158, 6000);
  const snapshot = decodeSnapshot({ ...frames, status: withCrc(frames.status) });
  assert.equal(snapshot.thresholds.balancingRegister143Raw, 4100);
  assert.equal(snapshot.packOvervoltage2Raw, 8400);
  assert.equal(snapshot.packUndervoltage2Raw, 6000);
  assert.equal('balancingDeltaMv' in snapshot.thresholds, false);
  assert.equal('prealarmBits' in snapshot, false);
});

test('alarm bitmap 32 bits, défauts supérieurs et bits inconnus restent visibles', () => {
  const { frames } = fresh();
  set32(frames.status, 152, 0x90002001);
  const snapshot = decodeSnapshot({ ...frames, status: withCrc(frames.status) });
  assert.equal(snapshot.alarmBits, 0x90002001);
  assert.ok(snapshot.warnings.some(value => value.key === 'Surtension cellule'));
  assert.ok(snapshot.warnings.some(value => value.key === 'Température MOS trop élevée'));
  assert.ok(snapshot.warnings.some(value => value.key === 'Défaut de température'));
  assert.ok(snapshot.warnings.some(value => value.key === 'Défaut de sortie charge'));
  set32(frames.status, 152, 1 << 20);
  assert.equal(decodeSnapshot({ ...frames, status: withCrc(frames.status) }).unknownAlarmBits, 1 << 20);
});

test('SOC converti impair et compteurs 32 bits : provenance et troncatures distinctes', () => {
  const { frames } = fresh();
  frames.status[83] = 85;
  set32(frames.status, 82, 100000);
  set32(frames.status, 96, 200000);
  const snapshot = decodeSnapshot({ ...frames, status: withCrc(frames.status) });
  assert.equal(snapshot.socPercent, 85);
  assert.ok(Math.abs(snapshot.convertedSocPercent - 84.8) < 1e-10);
  assert.equal(snapshot.remainingEnergyRaw, 100000);
  assert.equal(snapshot.remainingEnergyWh, null);
  assert.equal(snapshot.accumulatedElectricityRaw, 200000);
});

test('import strict : nouveau profil explicite, format ancien rejeté et cinq réponses vérifiées', () => {
  assert.deepEqual(hexToBytes('01 03\n00FF'), Uint8Array.of(1, 3, 0, 255));
  for (const value of ['', '01 0', '01 03 GG', '01,03', []]) assert.throws(() => hexToBytes(value), /invalide/);
  assert.throws(() => decodeCapture({ ...capture, format: 'yybms-cycle-v1' }), /v2/);
  assert.throws(() => decodeCapture({ ...capture, evidence: 'hardware-tested' }), /Format/);
  assert.throws(() => decodeCapture({ ...capture, frames: {} }), /invalide/);
  assert.equal(decodeCapture(JSON.parse(JSON.stringify(capture))).snapshot.voltageV, 74);
});
