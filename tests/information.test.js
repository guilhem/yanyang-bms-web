import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { informationGroups } from '../web/app.js';

const snapshot = () => ({
  ratedCapacityAh: 45, remainingCapacityAh: 38.2, remainingEnergyRaw: 0xffff8001,
  accumulatedElectricityRaw: 0x80000000, powerReportedRaw: -321,
  remainingChargeMinutes: 42, remainingDischargeMinutes: 180,
  cycles: 12, learnedCapacityAh: 43, learnedCycles: 2, learningState: 1,
  coulombSocRaw: 85, convertedSocPercent: 84.8, batteryHealthPercent: 96,
  balanced: [true, false, true], balanceMask: 0x80000005,
  calibration: { shuntGain: 32767, shuntOffset: -32768, shuntGain2: -1, shuntOffset2: 123 },
  idleSleepRaw: 10, autoSleepRaw: -1, undervoltageSleepMv: 2900,
  manualWakeupRaw: 2, panelType: 1, rs485Protocol: 3, rs485BaudCode: 255, canProtocol: 37, canBaudCode: 254,
  resetCount: 65535, protocolVersionRaw: 7, switchType: 99,
  runState1: 0x80000003, runState2: 0xffffffff, alarmBits: 0x80000001,
  packOvervoltage2Raw: 32135, packUndervoltage2Raw: -32768, systemConfigRaw: 0x8010,
  thresholds: {
    cellOvervoltageMv: 4200, cellOvervoltageRecoveryMv: 4100,
    cellUndervoltageMv: 2800, cellUndervoltageRecoveryMv: 3000,
    packOvervoltageV: 84, packOvervoltageRecoveryV: 82,
    packUndervoltageV: 56, packUndervoltageRecoveryV: 60,
    dischargeOvercurrentA: 120, dischargeOvercurrentRaw: 12000, dischargeOvercurrent2Raw: 70000,
    chargeOvercurrentConvertedA: 10, chargeOvercurrentRaw: -1000,
    chargeOvertemperatureC: 45, chargeOvertemperatureRecoveryC: 40,
    chargeUndertemperatureC: 0, chargeUndertemperatureRecoveryC: 5,
    dischargeOvertemperatureC: 60, dischargeOvertemperatureRecoveryC: 55,
    dischargeUndertemperatureC: -20, dischargeUndertemperatureRecoveryC: -15,
    mosOvertemperatureRaw: 32135, balancingVoltageMv: 4000, balancingDifferenceMv: 20, balancingRegister143Raw: -32768,
  },
});
const rows = value => Object.fromEntries(Object.values(informationGroups(value)).flat().map(([key, value]) => [key, value.replace(/\s/g, ' ')]));

test('YYBMS B : six menus, unités confirmées et registres ambigus conservés bruts', () => {
  const value = snapshot();
  assert.equal(Object.keys(informationGroups(value)).length, 6);
  const values = rows(value);
  assert.equal(values['Capacité apprise'], '43,0 Ah');
  assert.equal(values['Temps de charge restant'], '42 min');
  assert.equal(values['État de l’apprentissage'], 'Attente de charge (code 1)');
  assert.equal(values['Énergie restante · registre brut'], '4 294 934 529');
  assert.equal(values['Électricité cumulée · registre brut'], '2 147 483 648');
  assert.equal(values['Puissance rapportée · registre brut'], '-321');
  assert.equal(values['SOC par comptage coulombique · brut'], '85');
  assert.equal(values['SOC · conversion secondaire'], '84,8 %');
  assert.equal(values['Santé batterie · valeur brute'], '96');
  assert.equal(values['Surintensité en charge · valeur convertie'], '10,00 A');
  assert.equal(values['Surintensité en charge · registre brut'], '-1 000');
  assert.equal(values['Surintensité secondaire en décharge · valeur convertie'], '70 000');
  assert.equal(values['Seuil pack haut secondaire · registre brut'], '32 135');
  assert.equal(values['Seuil pack bas secondaire · registre brut'], '-32 768');
  assert.equal(values['Équilibrage R143 · registre brut (interprétation incertaine)'], '-32 768');
  for (const label of ['Seuil pack haut secondaire · registre brut', 'Seuil pack bas secondaire · registre brut', 'Équilibrage R143 · registre brut (interprétation incertaine)']) {
    assert.doesNotMatch(values[label], /V|°C/);
  }
  assert.equal(values['Délai de veille au repos · brut'], '10');
  assert.equal(values['Délai de veille automatique · brut'], '-1');
  assert.ok(!Object.values(values).some(value => /Wh|bit\/s/.test(value)));
});

test('YYBMS B : quatre paires de protections thermiques distinctes, zéro valide', () => {
  const values = rows(snapshot());
  assert.equal(values['Seuil MOS · registre brut (interprétation incertaine)'], '32 135');
  assert.doesNotMatch(values['Seuil MOS · registre brut (interprétation incertaine)'], /°C/);
  for (const [label, expected] of [
    ['Température haute en charge', '45 °C'], ['Reprise après température haute en charge', '40 °C'],
    ['Température basse en charge', '0 °C'], ['Reprise après température basse en charge', '5 °C'],
    ['Température haute en décharge', '60 °C'], ['Reprise après température haute en décharge', '55 °C'],
    ['Température basse en décharge', '-20 °C'], ['Reprise après température basse en décharge', '-15 °C'],
  ]) assert.equal(values[label], expected);
  const missing = rows({ thresholds: { chargeUndertemperatureC: null } });
  assert.equal(missing['Température basse en charge'], 'Non disponible');
  assert.equal(missing['Température basse en décharge'], 'Non disponible');
});

test('YYBMS B : quatre shunts signés, masques de 32 bits et codes sans ancienne table', () => {
  const value = snapshot();
  const values = rows(value);
  assert.equal(values['Gain shunt 1 · brut'], '32 767');
  assert.equal(values['Offset shunt 1 · brut'], '-32 768');
  assert.equal(values['Gain shunt 2 · brut'], '-1');
  assert.equal(values['Offset shunt 2 · brut'], '123');
  assert.equal(values['État système 1 · masque brut'], '0x80000003');
  assert.equal(values['État système 2 · masque brut'], '0xffffffff');
  assert.equal(values['Alarmes · masque brut'], '0x80000001');
  assert.ok(!Object.keys(values).some(key => /Préalertes|Delta d’équilibrage/.test(key)));
  assert.equal(values['Configuration système · registre brut'], '0x8010');
  assert.equal(values['Masque d’équilibrage · brut'], '0x80000005');
  assert.equal(values['Débit RS485 · code brut'], '255');
  assert.equal(values['Débit CAN · code brut'], '254');
  assert.equal(values['Type de commutation · code brut'], '99');
  assert.ok(!Object.keys(values).some(key => /Hall|DO[12]|Phase de charge|profil de tension|Contrôle du SOC|Identité · indicateurs/.test(key)));
});

test('informations absentes ou invalides : aucune valeur, unité ou état inventé', () => {
  const values = rows({
    remainingChargeMinutes: null, remainingDischargeMinutes: 0, learningState: 255,
    idleSleepRaw: undefined, autoSleepRaw: NaN, alarmBits: null, packOvervoltage2Raw: undefined, packUndervoltage2Raw: null,
  });
  assert.equal(values['Temps de charge restant'], 'Non disponible');
  assert.equal(values['Temps de décharge restant'], 'Non estimé (brut : 0 min)');
  assert.equal(values['État de l’apprentissage'], 'Inconnu (code 255)');
  assert.equal(values['Délai de veille au repos · brut'], 'Non disponible');
  assert.equal(values['Délai de veille automatique · brut'], 'Non disponible');
  assert.equal(values['Alarmes · masque brut'], 'Non disponible');
  assert.equal(values['Seuil pack haut secondaire · registre brut'], 'Non disponible');
  assert.equal(values['Seuil pack bas secondaire · registre brut'], 'Non disponible');
  assert.equal(values['Équilibrage R143 · registre brut (interprétation incertaine)'], 'Non disponible');
  assert.equal(values['Gain shunt 1 · brut'], 'Non disponible');
  assert.equal(values['Cellules signalées en équilibrage'], 'Non disponible');
});

test('page YYBMS B : six groupes techniques de consultation et ressources actualisées', () => {
  const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  assert.equal((html.match(/<details class="card info-panel">/g) ?? []).length, 6);
  for (const id of Object.keys(informationGroups({}))) assert.match(html, new RegExp(`<dl id="${id}"`));
  assert.match(html, /id="information-title"[^>]*>Détails techniques/);
  assert.match(html, /app\.js\?v=yybms-b-2/);
  assert.match(html, /styles\.css\?v=yybms-b-2/);
  assert.match(html, /YYBMS B/);
  assert.match(html, /cinq blocs/);
  assert.doesNotMatch(html, /trois blocs|Diagnostic système et sorties/);
});
