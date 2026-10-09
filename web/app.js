import { i18n, t, translatePage, initialLanguage, localizedError, errorDetails } from './i18n.js';
import { BmsBluetooth, validateServiceUuid } from './ble.js?v=yybms-b-2';
import { READ_BLOCKS, bytesToHex, decodeCapture } from './protocol.js?v=yybms-b-2';

export const MAX_IMPORT_BYTES = 1024 * 1024;

function number(value, digits = 1, unit = '') {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${value.toLocaleString(i18n.language, { minimumFractionDigits: digits, maximumFractionDigits: digits })}${unit ? ` ${unit}` : ''}`
    : t("Non disponible");
}

function codeLabel(value, labels) {
  if (!Number.isInteger(value)) return t("Non disponible");
  return t("{{label}} (code {{code}})", { label: labels[value] ?? t("Inconnu"), code: value });
}

const hex = (value, digits = 2) => Number.isInteger(value) ? `0x${value.toString(16).padStart(digits, '0')}` : t("Non disponible");
const remainingTime = value => typeof value !== 'number' || !Number.isFinite(value) ? t("Non disponible")
  : value > 0 ? number(value, 0, 'min') : t("Non estimé (brut : {{value}})", { value: number(value, 0, 'min') });
const contactState = value => typeof value === 'boolean' ? value ? t("Actif") : t("Inactif") : t("Non disponible");

// Les registres dont l’unité est incertaine restent signalés dans l’affichage.
export function informationGroups(snapshot) {
  const thresholds = snapshot.thresholds ?? {};
  const c = snapshot.calibration ?? {};
  return {
    'capacity-details': [
      [t("Capacité nominale"), number(snapshot.ratedCapacityAh, 1, 'Ah')],
      [t("Capacité restante"), number(snapshot.remainingCapacityAh, 1, 'Ah')],
      [t("Énergie restante · registre brut"), number(snapshot.remainingEnergyRaw, 0)],
      [t("Électricité cumulée · registre brut"), number(snapshot.accumulatedElectricityRaw, 0)],
      [t("Puissance rapportée · registre brut"), number(snapshot.powerReportedRaw, 0)],
      [t("Temps de charge restant"), remainingTime(snapshot.remainingChargeMinutes)],
      [t("Temps de décharge restant"), remainingTime(snapshot.remainingDischargeMinutes)],
      [t("Cycles de la batterie"), number(snapshot.cycles, 0)],
      [t("Capacité apprise"), number(snapshot.learnedCapacityAh, 1, 'Ah')],
      [t("Apprentissages réussis"), number(snapshot.learnedCycles, 0)],
      [t("État de l’apprentissage"), codeLabel(snapshot.learningState, [t("Attente de décharge complète"), t("Attente de charge"), t("Attente de charge complète"), t("Attente de décharge")])],
      [t("SOC par comptage coulombique · brut"), number(snapshot.coulombSocRaw, 0)],
      [t("SOC · conversion secondaire"), number(snapshot.convertedSocPercent, 1, '%')],
      [t("Santé batterie · valeur brute"), number(snapshot.batteryHealthPercent, 0)],
    ],
    'protection-details': [
      [t("Surtension cellule"), number(thresholds.cellOvervoltageMv, 0, 'mV')],
      [t("Reprise après surtension cellule"), number(thresholds.cellOvervoltageRecoveryMv, 0, 'mV')],
      [t("Sous-tension cellule"), number(thresholds.cellUndervoltageMv, 0, 'mV')],
      [t("Reprise après sous-tension cellule"), number(thresholds.cellUndervoltageRecoveryMv, 0, 'mV')],
      [t("Surtension du pack"), number(thresholds.packOvervoltageV, 3, 'V')],
      [t("Reprise après surtension du pack"), number(thresholds.packOvervoltageRecoveryV, 3, 'V')],
      [t("Sous-tension du pack"), number(thresholds.packUndervoltageV, 3, 'V')],
      [t("Reprise après sous-tension du pack"), number(thresholds.packUndervoltageRecoveryV, 3, 'V')],
      [t("Seuil pack haut secondaire · registre brut"), number(snapshot.packOvervoltage2Raw, 0)],
      [t("Seuil pack bas secondaire · registre brut"), number(snapshot.packUndervoltage2Raw, 0)],
      [t("Surintensité en décharge"), number(thresholds.dischargeOvercurrentA, 2, 'A')],
      [t("Surintensité en décharge · registre brut"), number(thresholds.dischargeOvercurrentRaw, 0)],
      [t("Surintensité secondaire en décharge · valeur convertie"), number(thresholds.dischargeOvercurrent2Raw, 0)],
      [t("Surintensité en charge · valeur convertie"), number(thresholds.chargeOvercurrentConvertedA, 2, 'A')],
      [t("Surintensité en charge · registre brut"), number(thresholds.chargeOvercurrentRaw, 0)],
      [t("Température haute en charge"), number(thresholds.chargeOvertemperatureC, 0, '°C')],
      [t("Reprise après température haute en charge"), number(thresholds.chargeOvertemperatureRecoveryC, 0, '°C')],
      [t("Température basse en charge"), number(thresholds.chargeUndertemperatureC, 0, '°C')],
      [t("Reprise après température basse en charge"), number(thresholds.chargeUndertemperatureRecoveryC, 0, '°C')],
      [t("Température haute en décharge"), number(thresholds.dischargeOvertemperatureC, 0, '°C')],
      [t("Reprise après température haute en décharge"), number(thresholds.dischargeOvertemperatureRecoveryC, 0, '°C')],
      [t("Température basse en décharge"), number(thresholds.dischargeUndertemperatureC, 0, '°C')],
      [t("Reprise après température basse en décharge"), number(thresholds.dischargeUndertemperatureRecoveryC, 0, '°C')],
      [t("Seuil MOS · registre brut (interprétation incertaine)"), number(thresholds.mosOvertemperatureRaw, 0)],
    ],
    'balancing-details': [
      [t("Tension d’activation"), number(thresholds.balancingVoltageMv, 0, 'mV')],
      [t("Différence d’activation"), number(thresholds.balancingDifferenceMv, 0, 'mV')],
      [t("Équilibrage R143 · registre brut (interprétation incertaine)"), number(thresholds.balancingRegister143Raw, 0)],
      [t("Cellules signalées en équilibrage"), number(snapshot.balanced?.filter(Boolean).length, 0)],
      [t("Masque d’équilibrage · brut"), hex(snapshot.balanceMask, 8)],
    ],
    'calibration-details': [
      [t("Gain shunt 1 · brut"), number(c.shuntGain, 0)],
      [t("Offset shunt 1 · brut"), number(c.shuntOffset, 0)],
      [t("Gain shunt 2 · brut"), number(c.shuntGain2, 0)],
      [t("Offset shunt 2 · brut"), number(c.shuntOffset2, 0)],
    ],
    'communication-details': [
      [t("Délai de veille au repos · brut"), number(snapshot.idleSleepRaw, 0)],
      [t("Délai de veille automatique · brut"), number(snapshot.autoSleepRaw, 0)],
      [t("Seuil de veille sous-tension"), number(snapshot.undervoltageSleepMv, 0, 'mV')],
      [t("Réveil manuel · code brut"), number(snapshot.manualWakeupRaw, 0)],
      [t("Type de panneau · code brut"), number(snapshot.panelType, 0)],
      [t("Protocole RS485 · code brut"), number(snapshot.rs485Protocol, 0)],
      [t("Débit RS485 · code brut"), number(snapshot.rs485BaudCode, 0)],
      [t("Protocole CAN · code brut"), number(snapshot.canProtocol, 0)],
      [t("Débit CAN · code brut"), number(snapshot.canBaudCode, 0)],
    ],
    'system-details': [
      [t("Redémarrages du microcontrôleur"), number(snapshot.resetCount, 0)],
      [t("Version du protocole · brute"), hex(snapshot.protocolVersionRaw, 4)],
      [t("Type de commutation · code brut"), number(snapshot.switchType, 0)],
      [t("État système 1 · masque brut"), hex(snapshot.runState1, 8)],
      [t("État système 2 · masque brut"), hex(snapshot.runState2, 8)],
      [t("Alarmes · masque brut"), hex(snapshot.alarmBits, 8)],
      [t("Configuration système · registre brut"), hex(snapshot.systemConfigRaw, 4)],
    ],
  };
}

export function parseCycleText(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_IMPORT_BYTES) throw localizedError("Le fichier JSON dépasse la limite de 1 Mo.");
  let input;
  try { input = JSON.parse(text); }
  catch { throw localizedError("Le fichier ne contient pas un JSON valide.", {}, SyntaxError); }
  const { snapshot, frames } = decodeCapture(input);
  const capture = {
    format: 'yybms-cycle-v2', evidence: input.evidence,
    frames: Object.fromEntries(READ_BLOCKS.map(({ key }) => [key, bytesToHex(frames[key])])),
  };
  if (typeof input.timestamp === 'string' && input.timestamp.length < 100 && Number.isFinite(Date.parse(input.timestamp))) capture.timestamp = input.timestamp;
  if (typeof input.service === 'string') {
    try { capture.service = validateServiceUuid(input.service); } catch { /* Métadonnée facultative, jamais utilisée pour une connexion. */ }
  }
  if (input.device && typeof input.device === 'object') {
    capture.device = {};
    for (const key of ['name', 'id']) if (typeof input.device[key] === 'string') capture.device[key] = input.device[key].slice(0, 300);
  }
  if (input.stale === true) capture.stale = true;
  return { snapshot, capture };
}

function startApp() {
  const elements = Object.fromEntries([
    'language', 'import', 'import-options', 'dashboard', 'export-cycle', 'export-log', 'connect-form', 'service-options', 'service-uuid', 'connect', 'read', 'disconnect',
    'connection-state', 'bluetooth-support', 'message', 'source-badge', 'provenance', 'empty', 'measurements',
    'soc', 'soc-meter', 'capacity', 'voltage', 'energy', 'current', 'power', 'spread', 'cell-range',
    'cell-count', 'cells', 'temperatures', 'temperature-range', 'status', 'warnings', 'identity', 'journal', 'event-count',
    'capacity-details', 'protection-details', 'balancing-details', 'calibration-details', 'communication-details', 'system-details',
  ].map(id => [id, document.getElementById(id)]));
  let data = null;
  let generation = 0;
  let operation = null;
  const bluetoothAvailable = Boolean(navigator.bluetooth && globalThis.isSecureContext);
  const states = { disconnected: 'Déconnecté', connecting: 'Connexion en cours', connected: 'Connecté', reading: 'Lecture du cycle', error: 'Connexion interrompue' };
  const ble = new BmsBluetooth({
    onState(state) {
      if (data?.source === 'live' && ['disconnected', 'error', 'reading'].includes(state)) data.stale = true;
      if (['disconnected', 'error'].includes(state)) message(data?.source === 'live'
        ? "Connexion interrompue. Le relevé affiché est ancien ; reconnectez-vous pour le relire."
        : "Connexion interrompue. Choisissez à nouveau un appareil pour lire la batterie.", state === 'error');
      renderControls();
      renderProvenance();
    },
    onEvent() {
      const events = ble.events;
      elements['event-count'].textContent = t("{{count}} / 500 événements", { count: events.length });
      elements.journal.textContent = events.map(event => JSON.stringify(event)).join('\n');
    },
  });

  if (!bluetoothAvailable) elements['import-options'].open = true;

  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(([entry]) => {
    document.documentElement.style.setProperty('--controls-height', `${entry.target.getBoundingClientRect().height}px`);
  }).observe(document.querySelector('.connection-controls'));

  let lastMessage = { key: "Choisissez un appareil, puis lisez la batterie. Vous pouvez aussi importer un relevé." };
  function message(key, error = false, values = {}) {
    lastMessage = { key, error, values };
    elements.message.textContent = t(key, values.defaultDevice ? { ...values, device: values.device || t("l’appareil sélectionné") } : values);
    elements.message.classList.toggle('error', error);
  }

  function renderControls() {
    const focused = document.activeElement;
    const connected = ['connected', 'reading'].includes(ble.state);
    elements['connection-state'].textContent = bluetoothAvailable ? t(states[ble.state]) : t("Bluetooth indisponible");
    elements['connection-state'].className = `badge${connected ? '' : ' muted'}`;
    elements['connect-form'].hidden = connected || !bluetoothAvailable;
    elements.connect.disabled = !bluetoothAvailable || Boolean(operation) || connected;
    elements.connect.textContent = operation?.kind === 'connect' ? t("Connexion en cours…") : t("Choisir un appareil");
    elements.read.hidden = !connected;
    elements.disconnect.hidden = !['connecting', 'connected', 'reading'].includes(ble.state);
    elements['service-options'].hidden = connected || !bluetoothAvailable;
    elements.read.disabled = Boolean(operation) || ble.state !== 'connected';
    elements.disconnect.disabled = !['connecting', 'connected', 'reading'].includes(ble.state);
    elements['service-uuid'].disabled = Boolean(operation) || connected;
    elements.import.disabled = Boolean(operation);
    elements['export-cycle'].disabled = !data;
    elements['export-cycle'].hidden = !data;
    elements.read.textContent = operation?.kind === 'read' ? t("Lecture en cours…")
      : data?.source === 'live' ? t("Actualiser le relevé") : t("Lire la batterie");
    if (focused && (focused.disabled || focused.closest('[hidden]'))) elements['connection-state'].focus({ preventScroll: true });
  }

  function renderProvenance() {
    elements.empty.hidden = Boolean(data);
    elements.measurements.hidden = !data;
    if (!data) {
      elements['source-badge'].textContent = t("Aucune source");
      elements['source-badge'].className = 'badge muted';
      elements.provenance.textContent = t("Aucune donnée chargée.");
      return;
    }
    const synthetic = data.capture.evidence === 'synthetic';
    const label = data.source === 'import' ? t("JSON importé · {{evidence}}", { evidence: t(synthetic ? "données synthétiques" : "capture déclarée") })
      : t("Bluetooth · cycle relevé");
    elements['source-badge'].textContent = data.stale ? t("{{source}} · ancien", { source: label }) : label;
    elements['source-badge'].className = `badge${data.stale ? ' stale' : synthetic ? ' synthetic' : ''}`;
    const time = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(data.capture.timestamp ?? data.loadedAt));
    const device = data.capture.device?.name ? t(" · appareil : {{device}}", { device: data.capture.device.name }) : '';
    const freshness = data.stale ? t(data.source === 'live' ? " · données périmées, relire un cycle après connexion" : " · fichier signalé comme ancien") : '';
    const origin = t(data.source === 'import' ? "Décodage hors ligne ; provenance du fichier non vérifiée"
      : "Cinq lectures successives ; mesures relevées par cycle, non atomiques");
    elements.provenance.textContent = t("{{origin}} · {{dateLabel}} : {{time}}{{device}}{{freshness}}", { origin, dateLabel: t(data.capture.timestamp ? "Horodatage du cycle" : "Chargé le"), time, device, freshness });
    elements.measurements.classList.toggle('stale-data', data.stale);
  }

  function facts(target, rows) {
    const fragment = document.createDocumentFragment();
    for (const [label, value] of rows) {
      const row = document.createElement('div');
      const term = document.createElement('dt');
      const detail = document.createElement('dd');
      term.textContent = label;
      detail.textContent = value ?? t("Non disponible");
      row.append(term, detail);
      fragment.append(row);
    }
    target.replaceChildren(fragment);
  }

  function display(result, source) {
    data = { ...result, source, stale: result.capture.stale === true, loadedAt: new Date().toISOString() };
    renderMeasurements();
  }

  function renderMeasurements() {
    const snapshot = data.snapshot;
    const soc = Number.isFinite(snapshot.socPercent) && snapshot.socPercent >= 0 && snapshot.socPercent <= 100 ? snapshot.socPercent : null;
    elements.soc.textContent = number(soc, 1, '%');
    elements['soc-meter'].hidden = soc === null;
    if (soc !== null) elements['soc-meter'].value = soc;
    elements.capacity.textContent = `${number(snapshot.remainingCapacityAh, 1, 'Ah')} / ${number(snapshot.ratedCapacityAh, 1, 'Ah')}`;
    elements.voltage.textContent = number(snapshot.voltageV, 2, 'V');
    elements.energy.textContent = t("Tension du cycle");
    elements.current.textContent = number(snapshot.currentA, 2, 'A');
    elements.power.textContent = t("{{value}} · puissance calculée (tension × courant)", { value: number(snapshot.powerW, 0, 'W') });
    elements.spread.textContent = number(snapshot.cellSpreadMv, 0, 'mV');
    elements['cell-range'].textContent = `${number(snapshot.minCellV, 3, 'V')} → ${number(snapshot.maxCellV, 3, 'V')}`;
    elements['cell-count'].textContent = t("cellules", { count: snapshot.cellCount });
    const cells = document.createDocumentFragment();
    snapshot.cellsV.forEach((voltage, index) => {
      const row = document.createElement('tr');
      const label = document.createElement('th');
      label.scope = 'row';
      label.textContent = String(index + 1).padStart(2, '0');
      const value = document.createElement('td');
      value.textContent = number(voltage, 3, 'V');
      const balancing = document.createElement('td');
      balancing.textContent = snapshot.balanced[index] ? t("Actif") : t("Inactif");
      balancing.className = snapshot.balanced[index] ? 'balancing' : '';
      row.append(label, value, balancing);
      cells.append(row);
    });
    elements.cells.replaceChildren(cells);
    const temperatures = document.createDocumentFragment();
    snapshot.temperaturesC.forEach((temperature, index) => {
      const item = document.createElement('li');
      item.textContent = t("Batterie · sonde {{index}}", { index: index + 1 });
      const value = document.createElement('strong');
      value.textContent = number(temperature, 0, '°C');
      item.append(value);
      temperatures.append(item);
    });
    if (!snapshot.temperaturesC.length) {
      const item = document.createElement('li');
      item.textContent = t("Aucune sonde batterie déclarée");
      temperatures.append(item);
    }
    elements.temperatures.replaceChildren(temperatures);
    facts(elements['temperature-range'], [
      [t("Minimum batterie · calculé"), number(snapshot.minTemperatureC, 0, '°C')],
      [t("Maximum batterie · calculé"), number(snapshot.maxTemperatureC, 0, '°C')],
      ['MOS', number(snapshot.mosTemperatureC, 0, '°C')],
      [t("Équilibrage"), number(snapshot.balanceTemperatureC, 0, '°C')],
    ]);
    facts(elements.status, [
      [t("État du pack"), t(snapshot.status, { code: snapshot.statusCode })], [t("Contact de charge"), contactState(snapshot.chargeEnabled)],
      [t("Contact de décharge"), contactState(snapshot.dischargeEnabled)], [t("Cycles"), number(snapshot.cycles, 0)],
      [t("Durée de fonctionnement"), number(typeof snapshot.uptimeSeconds === 'number' ? snapshot.uptimeSeconds / 3600 : null, 1, 'h')],
    ]);
    elements.warnings.replaceChildren(...(snapshot.warnings.length ? snapshot.warnings : [{ key: "Aucune alarme décodée dans ce cycle." }]).map(warning => {
      const item = document.createElement('li');
      item.textContent = t(warning.key, warning.values);
      return item;
    }));
    facts(elements.identity, [
      [t("Modèle"), snapshot.model || t("Non disponible")], [t("Produit"), snapshot.productName || t("Non disponible")],
      [t("Nom Bluetooth"), snapshot.bluetoothName || t("Non disponible")], [t("N° matériel"), snapshot.serialNumber || t("Non disponible")],
      [t("N° du pack"), snapshot.packSerial || t("Non disponible")],
      [t("Champ fabricant · texte brut"), snapshot.manufacturerSerial || t("Non disponible")],
      [t("Matériel"), number(snapshot.hardwareVersion, 2)], [t("Logiciel"), number(snapshot.softwareVersion, 2)],
      [t("Bootloader"), number(snapshot.bootloaderVersion, 2)],
    ]);
    for (const [id, rows] of Object.entries(informationGroups(snapshot))) facts(elements[id], rows);
    renderControls();
    renderProvenance();
  }

  async function run(kind, action) {
    if (operation) return;
    const token = ++generation;
    operation = { kind, token };
    renderControls();
    const operationFocus = document.activeElement;
    try { await action(token); }
    catch (error) {
      if (token === generation) {
        const { key, values } = errorDetails(error);
        message(key, true, values);
      }
    }
    finally {
      if (operation?.token === token) operation = null;
      renderControls();
      if (token === generation && document.activeElement === operationFocus) {
        if (kind === 'connect' && ble.state === 'connected') elements.read.focus();
        else if ((kind === 'read' && data?.source === 'live' && !data.stale) || (kind === 'import' && data?.source === 'import')) elements.dashboard.focus();
        else elements.message.focus();
      }
    }
  }

  function offline() {
    data = null;
    ble.disconnect();
    renderControls();
    renderProvenance();
  }

  elements.import.addEventListener('change', () => {
    const file = elements.import.files[0];
    if (!file) return;
    run('import', async token => {
      offline();
      message("Décodage local du fichier…");
      if (file.size > MAX_IMPORT_BYTES) throw localizedError("Le fichier JSON dépasse la limite de 1 Mo.");
      const result = parseCycleText(await file.text());
      if (token !== generation) return;
      display(result, 'import');
      message("Cycle importé et validé hors ligne. Aucun octet du fichier n’a été envoyé à la batterie.");
    }).finally(() => { elements.import.value = ''; });
  });

  elements['service-uuid'].addEventListener('input', () => {
    elements['service-uuid'].setCustomValidity('');
    elements['service-uuid'].removeAttribute('aria-invalid');
  });
  elements['connect-form'].addEventListener('submit', event => {
    event.preventDefault();
    const service = elements['service-uuid'];
    try { if (service.value.trim()) validateServiceUuid(service.value); }
    catch (error) {
      elements['service-options'].open = true;
      service.setCustomValidity(t(error.translationKey ?? error.message, error.translationValues));
      service.setAttribute('aria-invalid', 'true');
      message(error.translationKey ?? error.message, true, error.translationValues);
      service.focus();
      service.reportValidity();
      return;
    }
    run('connect', async token => {
      data = null;
      renderControls();
      renderProvenance();
      message("Choisissez votre appareil dans le sélecteur Bluetooth…");
      const connection = await ble.connect(elements['service-uuid'].value || undefined);
      if (token !== generation) return;
      message("Connecté à {{device}}. Choisissez « Lire la batterie » pour relever les mesures.", false, { device: connection.device.name, defaultDevice: true });
    });
  });

  elements.read.addEventListener('click', () => run('read', async token => {
    message("Lecture manuelle des cinq blocs…");
    const result = await ble.readCycle();
    if (token !== generation) return;
    display(result, 'live');
    message("Cycle validé : cinq lectures successives, aucune actualisation automatique.");
  }));

  elements.disconnect.addEventListener('click', () => {
    ++generation;
    ble.disconnect();
    message(data?.source === 'live'
      ? "Vous avez fermé la connexion. Le relevé affiché est ancien ; reconnectez-vous pour l’actualiser."
      : "Vous avez fermé la connexion. Choisissez un appareil pour lire la batterie.");
    elements.message.focus();
  });

  function download(value, name) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  elements['export-cycle'].addEventListener('click', () => {
    if (!data) return;
    download({ ...data.capture, exportedAt: new Date().toISOString(), viewSource: data.source, stale: data.stale }, `yybms-cycle-${data.capture.evidence}.json`);
    message(data.stale ? "Ancien cycle exporté avec son horodatage et la mention stale." : "Cycle exporté avec sa provenance.");
  });
  elements['export-log'].addEventListener('click', () => download({
    ...ble.exportDiagnostics(), browser: navigator.userAgent, secureContext: globalThis.isSecureContext,
    displayedSource: data?.source ?? null, displayedEvidence: data?.capture.evidence ?? null, stale: data?.stale ?? null,
  }, 'yybms-diagnostics.json'));
  window.addEventListener('pagehide', () => ble.disconnect());
  const language = elements.language;
  function renderLanguage() {
    translatePage();
    language.value = i18n.language;
    elements['bluetooth-support'].textContent = t(bluetoothAvailable
      ? "Choisissez le BMS dans le sélecteur du navigateur. La connexion seule ne lance aucune lecture."
      : "Bluetooth indisponible ici. Utilisez Chrome ou Edge avec Web Bluetooth, en HTTPS ou sur localhost. Vous pouvez importer un relevé ci-dessous.");
    if (data) {
      renderMeasurements();
    }
    renderControls();
    renderProvenance();
    elements['event-count'].textContent = t("{{count}} / 500 événements", { count: ble.events.length });
    if (!ble.events.length) elements.journal.textContent = t("Aucun événement Bluetooth.");
    message(lastMessage.key, lastMessage.error, lastMessage.values);
    if (elements['service-uuid'].validity.customError) elements['service-uuid'].setCustomValidity(t("Renseignez un UUID de service complet, relevé sur votre appareil."));
  }
  i18n.on('languageChanged', renderLanguage);
  language.addEventListener('change', () => {
    try { localStorage.setItem('yybms-language', language.value); } catch { /* Storage may be disabled. */ }
    i18n.changeLanguage(language.value);
  });
  i18n.changeLanguage(initialLanguage());
}

if (typeof document !== 'undefined') startApp();
