import { localizedError } from './i18n.js';
// YYBMS B : requêtes de consultation et décodage du protocole.
export const CYCLE_FORMAT = 'yybms-cycle-v2';
export const READ_BLOCKS = Object.freeze([
  Object.freeze({ key: 'profile', address: 63, count: 4 }),
  Object.freeze({ key: 'summary', address: 1, count: 79 }),
  Object.freeze({ key: 'status', address: 80, count: 80 }),
  Object.freeze({ key: 'balance', address: 160, count: 81 }),
  Object.freeze({ key: 'identity', address: 240, count: 20 }),
]);

function blockFor(key) {
  const block = READ_BLOCKS.find(block => block.key === key);
  if (!block) throw localizedError("Bloc de lecture inconnu.");
  return block;
}

export function crc16(bytes) {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xa001 : 0);
  }
  return crc;
}

export function buildReadRequest(key) {
  const { address, count } = blockFor(key);
  const bytes = Uint8Array.of(1, 3, address >>> 8, address & 255, count >>> 8, count & 255, 0, 0);
  const crc = crc16(bytes.subarray(0, 6));
  bytes[6] = crc & 255;
  bytes[7] = crc >>> 8;
  return bytes;
}

export function bytesToHex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join(' ');
}

export function hexToBytes(text) {
  if (typeof text !== 'string' || text.length > 1024 || !/^(?:[\da-fA-F]{2}\s*)+$/.test(text.trim())) {
    throw localizedError("Trame hexadécimale invalide.");
  }
  return Uint8Array.from(text.match(/[\da-fA-F]{2}/g), byte => Number.parseInt(byte, 16));
}

function validateResponse(key, bytes) {
  const { count } = blockFor(key);
  if (!(bytes instanceof Uint8Array)) throw localizedError("Trame binaire attendue.");
  if (bytes.length < 5) throw localizedError("Trame tronquée.");
  if (bytes[0] !== 1) throw localizedError("Adresse BMS inattendue.");
  const last = bytes.length - 2;
  if (crc16(bytes.subarray(0, last)) !== (bytes[last] | (bytes[last + 1] << 8))) {
    throw localizedError("CRC invalide.");
  }
  if (bytes[1] === 0x83 && bytes.length === 5) {
    throw localizedError("Exception Modbus {{code}}.", { code: `0x${bytes[2].toString(16).padStart(2, '0')}` });
  }
  if (bytes[1] !== 3) throw localizedError("Fonction de réponse inattendue.");
  if (bytes[2] !== count * 2 || bytes.length !== count * 2 + 5) {
    throw localizedError("Longueur de réponse incompatible avec le bloc demandé.");
  }
}

// Bound by the pending request, independently of ATT MTU / notification boundaries.
export class ReadResponseBuffer {
  constructor(key) {
    this.key = key;
    this.expected = blockFor(key).count * 2 + 5;
    this.bytes = new Uint8Array(this.expected);
    this.length = 0;
    this.complete = false;
  }

  push(chunk) {
    if (!(chunk instanceof Uint8Array)) throw localizedError("Notification binaire attendue.");
    if (this.complete || this.length + chunk.length > this.expected) throw localizedError("Réponse trop longue ou supplémentaire.");
    this.bytes.set(chunk, this.length);
    this.length += chunk.length;
    if (this.length >= 1 && this.bytes[0] !== 1) throw localizedError("Adresse BMS inattendue.");
    if (this.length >= 2 && this.bytes[1] !== 3 && this.bytes[1] !== 0x83) throw localizedError("Fonction de réponse inattendue.");
    if (this.length >= 3 && this.bytes[1] === 3 && this.bytes[2] !== this.expected - 5) {
      throw localizedError("Longueur de réponse incompatible avec le bloc demandé.");
    }
    if (this.length >= 5 && this.bytes[1] === 0x83) {
      validateResponse(this.key, this.bytes.slice(0, this.length));
    }
    if (this.length !== this.expected) return null;
    const frame = this.bytes.slice();
    validateResponse(this.key, frame);
    this.complete = true;
    return frame;
  }
}

const alarmLabels = [
  [0, 'Surtension cellule'], [1, 'Sous-tension cellule'], [2, 'Coupure pour sous-tension'],
  [3, 'Surtension batterie'], [4, 'Sous-tension batterie'], [5, 'Surintensité en charge'],
  [6, 'Surintensité en décharge'], [7, 'Surintensité matérielle'], [8, 'Court-circuit'],
  [9, 'Température de charge trop élevée'], [10, 'Température de charge trop basse'],
  [11, 'Température de décharge trop élevée'], [12, 'Température de décharge trop basse'],
  [13, 'Température MOS trop élevée'], [14, 'SOC trop faible'], [15, 'Batterie pleine'],
  [16, 'Batterie vide'], [17, 'Surtension matérielle'], [18, 'Sous-tension matérielle'],
  [25, 'Défaut du circuit de mesure'], [26, 'Défaut mémoire'], [27, 'Défaut de mesure tension'],
  [28, 'Défaut de température'], [29, 'Défaut de mesure courant'],
  [30, 'Défaut de sortie décharge'], [31, 'Défaut de sortie charge'],
];
const knownAlarmMask = alarmLabels.reduce((mask, [bit]) => mask | (1 << bit), 0) >>> 0;
const cellV = value => [0, 20, 35, 36].includes(value) || value > 5000 ? null : value / 1000;
const temperatureC = value => value === 0 || value === 166 ? null : value - 40;

export function decodeReadResponse(key, bytes) {
  validateResponse(key, bytes);
  const payload = bytes.subarray(3, -2);
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const u16 = offset => view.getUint16(offset, true);
  const i16 = offset => view.getInt16(offset, true);
  const u32 = offset => view.getUint32(offset, true);
  const i32 = offset => view.getInt32(offset, true);
  const i8 = offset => view.getInt8(offset);
  const text = (offset, length) => new TextDecoder().decode(payload.subarray(offset, offset + length)).split('\0')[0].replace(/[\x00-\x1f\x7f]/g, '').trim();
  if (key === 'profile') {
    if (u32(0) !== 0x4d444253) throw localizedError("Profil de registres non pris en charge : génération YYBMS B requise.");
    return { profile: 'yybms-b', profileSignature: u32(0) };
  }
  if (key === 'summary') {
    if (u32(124) !== 0x4d444253) throw localizedError("Signature incompatible avec le profil YYBMS B.");
    const cellCount = payload[148];
    const temperatureCount = payload[103];
    const mosSensorCount = payload[104];
    const balanceSensorCount = payload[105];
    if (cellCount < 1 || cellCount > 25 || temperatureCount > 8 || mosSensorCount > 1 || balanceSensorCount > 1) {
      throw localizedError("Nombre de cellules ou de sondes incompatible avec le profil YYBMS B.");
    }
    const serialNumber = bytesToHex(payload.subarray(2, 10)).replaceAll(' ', '').toUpperCase();
    // Ces familles utilisent des conversions thermiques différentes.
    if (['0001', '5948', '0008', '0009', '000A', '010A'].includes(serialNumber.slice(0, 4))) {
      throw localizedError("Sous-variante thermique HB/O2 non prise en charge par le lecteur YYBMS B.");
    }
    return {
      protocolVersionRaw: u16(0), model: text(12, 26), productName: text(38, 36),
      serialNumber,
      bluetoothName: text(80, 12), hardwareVersion: i16(74) / 100,
      bootloaderVersion: payload[122] / 100, softwareVersion: payload[123] / 100,
      firmwareBuildRaw: [...payload.subarray(128, 134)],
      cellCount, temperatureCount, mosSensorCount, balanceSensorCount, switchType: payload[102],
      chemistryCode: payload[149],
      chemistry: ({ 0: 'Lithium ternaire', 1: 'LiFePO₄', 2: 'Lithium titanate', 3: 'Sodium-ion' })[payload[149]] ?? 'Inconnue',
      rs485Protocol: payload[114], rs485BaudCode: payload[115], canProtocol: payload[116], canBaudCode: payload[117],
      maxCellCountRaw: payload[111], maxCurrentRaw: u16(112),
      uptimeSeconds: i32(140), resetCount: u16(144), voltageV: i32(150) / 1000, currentA: i32(154) / 100,
    };
  }
  if (key === 'status') {
    const alarmBits = u32(152);
    const runState1 = u32(144);
    const statusCode = (runState1 >>> 26) & 3;
    return {
      cellsRaw: Array.from({ length: 25 }, (_, index) => u16(2 + index * 2)),
      maxCellIndex: payload[62], minCellIndex: payload[63],
      mosTemperatureRaw: payload[64], balanceTemperatureRaw: payload[65], batteryTemperaturesRaw: [...payload.subarray(66, 74)],
      socPercent: payload[80], convertedSocPercent: Math.trunc(i8(80) * 2.5) * 0.4,
      coulombSocRaw: payload[80], batteryHealthPercent: payload[81],
      ratedCapacityAh: u16(76) / 10, remainingCapacityAh: u16(78) / 10,
      remainingEnergyRaw: u32(82), remainingEnergyWh: null, powerReportedRaw: i16(0),
      remainingChargeMinutes: u16(86), remainingDischargeMinutes: u16(88),
      learnedCycles: u16(90), learnedCapacityAh: i16(92) / 10, learningState: payload[94], cycles: payload[95],
      accumulatedElectricityRaw: u32(96), chargeRequestRaw: payload[98],
      calibration: { shuntGain: i16(100), shuntOffset: i16(102), shuntGain2: i16(104), shuntOffset2: i16(106) },
      balanceMask: u32(118), balancingVoltageMv: i16(122), balancingDifferenceMv: i16(124), balancingRegister143Raw: i16(126),
      manualWakeupRaw: payload[140], panelType: payload[141], systemConfigRaw: u16(142),
      runState1, runState2: u32(148), alarmBits, packOvervoltage2Raw: i16(156), packUndervoltage2Raw: i16(158),
      unknownAlarmBits: (alarmBits & ~knownAlarmMask) >>> 0,
      chargeEnabled: Boolean(runState1 & 2), dischargeEnabled: Boolean(runState1 & 1), prechargeEnabled: Boolean(runState1 & 4),
      statusCode, status: ['Au repos', 'En charge', 'En décharge'][statusCode] ?? 'État inconnu ({{code}})',
      warnings: alarmLabels.filter(([bit]) => alarmBits & (1 << bit)).map(([, key]) => ({ key })),
    };
  }
  if (key === 'balance') {
    return {
      packSerial: text(94, 8), idleSleepRaw: i16(140), autoSleepRaw: i16(142),
      undervoltageSleepMv: u16(30), beepAlarmRaw: payload[0], relayAlarmRaw: payload[1],
      thresholds: {
        cellOvervoltageMv: i16(18), cellOvervoltageRecoveryMv: i16(20),
        cellUndervoltageMv: i16(24), cellUndervoltageRecoveryMv: i16(26),
        packOvervoltageV: u16(36) / 100, packOvervoltageRecoveryV: u16(38) / 100,
        packUndervoltageV: u16(42) / 100, packUndervoltageRecoveryV: u16(44) / 100,
        chargeOvercurrentRaw: -u16(62), chargeOvercurrentConvertedA: u16(62) / 100,
        dischargeOvercurrentRaw: u16(68), dischargeOvercurrentA: u16(68) / 100, dischargeOvercurrent2Raw: u16(70) * 100,
        chargeOvertemperatureC: i8(80) - 40, chargeOvertemperatureRecoveryC: i8(81) - 40,
        chargeUndertemperatureC: i8(82) - 40, chargeUndertemperatureRecoveryC: i8(83) - 40,
        dischargeOvertemperatureC: i8(84) - 40, dischargeOvertemperatureRecoveryC: i8(85) - 40,
        dischargeUndertemperatureC: i8(86) - 40, dischargeUndertemperatureRecoveryC: i8(87) - 40,
        mosOvertemperatureRaw: i16(88), shortCircuitCurrentRaw: i16(92),
      },
    };
  }
  return {
    manufacturerSerial: text(20, 16), lowVoltageIndicatorRaw: i16(20), balancingDelayRaw: payload[22], dischargeDelay2Raw: payload[24],
  };
}

export function decodeSnapshot(frames) {
  if (!frames || typeof frames !== 'object') throw localizedError("La signature et quatre réponses sont nécessaires.");
  const decoded = Object.fromEntries(READ_BLOCKS.map(({ key }) => [key, decodeReadResponse(key, frames[key])]));
  const { profile, summary, status, balance, identity } = decoded;
  const warnings = [...status.warnings];
  if (status.unknownAlarmBits) warnings.push({ key: "Alarmes inconnues : {{bits}}", values: { bits: `0x${status.unknownAlarmBits.toString(16)}` } });
  const cellsV = status.cellsRaw.slice(0, summary.cellCount).map(cellV);
  if (cellsV.some(value => value === null)) warnings.push({ key: "Une ou plusieurs tensions de cellule sont invalides ; écart non calculé." });
  if (status.maxCellIndex >= summary.cellCount || status.minCellIndex >= summary.cellCount) warnings.push({ key: "Index min/max cellule hors du nombre de cellules actif." });
  const validCells = cellsV.every(value => value !== null);
  const minCellV = validCells ? Math.min(...cellsV) : null;
  const maxCellV = validCells ? Math.max(...cellsV) : null;
  const temperaturesC = status.batteryTemperaturesRaw.slice(0, summary.temperatureCount).map(temperatureC);
  const validTemperatures = temperaturesC.filter(value => value !== null);
  if (temperaturesC.some(value => value === null)) warnings.push({ key: "Une ou plusieurs températures de batterie sont invalides." });
  return {
    ...profile, ...summary, ...status, ...balance, ...identity, cellsV, temperaturesC, warnings, minCellV, maxCellV,
    thresholds: { ...balance.thresholds, balancingVoltageMv: status.balancingVoltageMv, balancingDifferenceMv: status.balancingDifferenceMv, balancingRegister143Raw: status.balancingRegister143Raw },
    mosTemperatureC: summary.mosSensorCount ? temperatureC(status.mosTemperatureRaw) : null,
    balanceTemperatureC: summary.balanceSensorCount ? temperatureC(status.balanceTemperatureRaw) : null,
    minTemperatureC: validTemperatures.length ? Math.min(...validTemperatures) : null,
    maxTemperatureC: validTemperatures.length ? Math.max(...validTemperatures) : null,
    powerW: summary.voltageV * summary.currentA,
    cellSpreadMv: validCells ? Math.round((maxCellV - minCellV) * 1000) : null,
    balanced: cellsV.map((_, index) => Boolean(status.balanceMask & (1 << index))),
  };
}

export function decodeCapture(capture) {
  if (!capture || capture.format !== CYCLE_FORMAT || !['capture', 'synthetic'].includes(capture.evidence)) {
    throw localizedError("Format attendu : yybms-cycle-v2 pour YYBMS B, provenance capture ou synthetic.");
  }
  const frames = {};
  for (const { key } of READ_BLOCKS) frames[key] = hexToBytes(capture.frames?.[key]);
  return { frames, snapshot: decodeSnapshot(frames) };
}
