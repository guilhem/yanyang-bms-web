# Protocole de lecture YYBMS B

Le lecteur utilise le profil `yybms-b`, identifié par la signature `0x4d444253`. Le modèle observé est YY-BCU13-NIU-N. La cartographie décrit le contrat du lecteur ; elle ne garantit pas la compatibilité avec toute la gamme Yanyang.

Seules les cinq requêtes ci-dessous sont autorisées. Elles lisent des registres ; aucune opération de modification des paramètres, de réinitialisation ou de mise à jour du micrologiciel n’est prévue.

## Requêtes et réponses

Chaque requête contient huit octets :

```text
01 03 adresse_H adresse_L nombre_H nombre_L CRC_L CRC_H
```

L’adresse du BMS est `01`, la fonction est `03`. L’adresse du registre et le nombre de registres sont encodés sur 16 bits, octet fort en premier. Chaque registre fournit deux octets de données.

| Bloc | Adresse | Registres | Requête hexadécimale exacte | Charge utile | Réponse complète |
| --- | ---: | ---: | --- | ---: | ---: |
| `profile` | 63 | 4 | `01 03 00 3f 00 04 74 05` | 8 octets | 13 octets |
| `summary` | 1 | 79 | `01 03 00 01 00 4f 55 fe` | 158 octets | 163 octets |
| `status` | 80 | 80 | `01 03 00 50 00 50 45 e7` | 160 octets | 165 octets |
| `balance` | 160 | 81 | `01 03 00 a0 00 51 84 14` | 162 octets | 167 octets |
| `identity` | 240 | 20 | `01 03 00 f0 00 14 45 f6` | 40 octets | 45 octets |

Une réponse normale suit cette forme :

```text
01 03 nombre_octets données… CRC_L CRC_H
```

Les octets de longueur attendus sont respectivement `08`, `9e`, `a0`, `a2` et `28`. Une exception suit la forme `01 83 code CRC_L CRC_H`, sur cinq octets.

Le CRC-16 Modbus utilise une valeur initiale de `0xffff` et le polynôme réfléchi `0xa001`. Il couvre tous les octets précédant le CRC ; son octet faible est transmis en premier.

La réponse est assemblée selon la requête en attente, indépendamment des limites des notifications Bluetooth. Le lecteur vérifie l’adresse, la fonction, la longueur exacte et le CRC. Une réponse tronquée, supplémentaire ou incohérente est rejetée.

## Cartographie des données

Les offsets ci-dessous sont exprimés en octets depuis le début de la charge utile, après les trois octets d’en-tête. Les valeurs numériques multioctets sont en **little-endian**. `u8`, `u16` et `u32` désignent des entiers non signés ; `i8`, `i16` et `i32`, des entiers signés.

| Bloc | Champs principaux et conversions |
| --- | --- |
| `profile` | Signature `u32` à l’offset 0, attendue à `0x4d444253` : octets `53 42 44 4d`. |
| `summary` | Numéro de série : octets 2–9 ; modèle : texte à 12, longueur 26 ; nom produit : texte à 38, longueur 36. Signature `u32` à 124. Nombre de sondes batterie à 103, MOS à 104, équilibrage à 105 ; nombre de cellules à 148. Tension : `i32(150) / 1000` V ; courant **signé** : `i32(154) / 100` A. |
| `status` | 25 tensions de cellule `u16` à partir de 2 ; indices maximum/minimum à 62/63. Températures MOS/équilibrage à 64/65 ; huit sondes batterie à 66–73. Capacités nominale/restante : `u16(76) / 10` et `u16(78) / 10` Ah. SOC brut à 80, santé batterie à 81. Masque d’équilibrage `u32(118)`, états `u32(144)` et `u32(148)`, alarmes `u32(152)`. |
| `balance` | Seuils de cellule : `i16` à 18/20 pour surtension/récupération, 24/26 pour sous-tension/récupération, en mV. Seuils batterie : `u16` à 36/38 et 42/44, divisés par 100 pour obtenir des V. Surintensités charge/décharge à 62/68. Seuils thermiques : `i8` à 80–87, moins 40 °C. Numéro de série du pack : texte à 94, longueur 8. |
| `identity` | Champ fabricant brut : texte à 20, longueur 16. Lectures conservées brutes : indicateur basse tension `i16(20)`, délai d’équilibrage `u8(22)`, second délai de décharge `u8(24)`. Ces champs chevauchent le texte ; leur interprétation reste incertaine. |

Les textes sont décodés en UTF-8, arrêtés au premier octet nul, nettoyés des caractères de contrôle puis des espaces aux extrémités.

## Conversions et garde-fous

Le nombre de cellules doit être compris entre 1 et 25. Le nombre de sondes batterie ne peut dépasser huit ; les sondes MOS et d’équilibrage sont chacune limitées à une. Seules les cellules et sondes déclarées actives sont utilisées.

Une tension de cellule est convertie en volts par division par 1000. Les valeurs brutes `0`, `20`, `35`, `36` et celles supérieures à `5000` sont invalides et deviennent `null`. L’écart entre cellules n’est calculé que si toutes les cellules actives sont valides.

Une température de mesure vaut `u8 - 40` °C ; les valeurs brutes `0` et `166` deviennent `null`. Cette conversion concerne le profil pris en charge. Les sous-variantes thermiques HB/O2 sont rejetées lorsque le numéro de série commence par `0001`, `5948`, `0008`, `0009`, `000A` ou `010A`.

Les conversions suivantes sont conservées explicitement :

- `socPercent` : valeur non signée de l’octet 80 du bloc `status`.
- `convertedSocPercent` : `Math.trunc(i8(80) * 2.5) * 0.4`, avec lecture signée de cet octet.
- `chargeOvercurrentRaw` : `-u16(62)` dans `balance`.
- `chargeOvercurrentConvertedA` : `u16(62) / 100`, en ampères.
- `dischargeOvercurrentA` : `u16(68) / 100`, en ampères.

La puissance calculée est `voltageV * currentA`. `powerReportedRaw` et `remainingEnergyRaw` restent séparés ; aucune conversion en Wh n’est attribuée à l’énergie brute.

## États et alarmes

Dans `runState1`, les bits 0, 1 et 2 indiquent respectivement les sorties décharge, charge et précharge actives. Les bits 26–27 donnent l’état : 0 au repos, 1 en charge, 2 en décharge ; la valeur 3 reste inconnue.

`alarmBits` est un bitmap non signé sur 32 bits :

| Bits | Interprétation |
| --- | --- |
| 0–4 | Surtension cellule, sous-tension cellule, coupure pour sous-tension, surtension batterie, sous-tension batterie. |
| 5–8 | Surintensité en charge, en décharge, matérielle, court-circuit. |
| 9–14 | Température de charge trop élevée/basse, température de décharge trop élevée/basse, température MOS trop élevée, SOC trop faible. |
| 15–18 | Batterie pleine, batterie vide, surtension matérielle, sous-tension matérielle. |
| 25–31 | Défaut du circuit de mesure, mémoire, mesure tension, température, mesure courant, sortie décharge, sortie charge. |

Les bits 19–24 ne sont pas interprétés. Tout bit sans libellé reste présent dans `unknownAlarmBits` et est signalé en hexadécimal.

## Provenance et confiance

Les champs convertis suivent les règles du lecteur ; ils ne constituent pas une comparaison avec des instruments. Les suffixes `Raw` signalent les valeurs conservées avant interprétation ; certains champs héritent néanmoins d’une conversion numérique, comme `dischargeOvercurrent2Raw = u16(70) * 100`, dont l’unité reste inconnue. Les champs inconnus ne doivent pas être présentés comme des mesures confirmées.

Le format de cycle est `yybms-cycle-v2`. La provenance `capture` déclare des réponses capturées ; `synthetic` déclare des données construites. Un fichier importé ne prouve ni son origine ni une validation matérielle.

La stabilité des reconnexions, le fonctionnement sur matériel mobile et la précision face à des instruments restent à qualifier.
