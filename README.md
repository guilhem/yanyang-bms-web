# Yanyang BMS Web

Lecteur autonome de BMS Yanyang/YYBMS via Web Bluetooth, en lecture seule.

**[Ouvrir Yanyang BMS Web](https://yanyang-bms-web.ultimex.chatgpt.site)**

L’interface propose trois langues : français, anglais et chinois simplifié (`FR`, `EN`, `zh-CN`).

## Utilisation

Dans un navigateur compatible avec Web Bluetooth, en HTTPS ou sur localhost :

1. Cliquer sur **Choisir un appareil** pour ouvrir le sélecteur Bluetooth du navigateur.
2. Sélectionner le BMS et attendre la connexion.
3. Cliquer sur **Lire la batterie**, puis **Actualiser le relevé** pour une nouvelle lecture.

Le lecteur affiche notamment la tension, le courant, les cellules, les températures et les alarmes. Il conserve les champs bruts dont l’interprétation reste incertaine. Aucune commande de modification des paramètres, de réinitialisation ou de mise à jour du micrologiciel n’est proposée.

## Profil pris en charge

Le profil **YYBMS B** (`yybms-b`) utilise la signature `0x4d444253`. Le modèle observé est **YY-BCU13-NIU-N** ; cela ne constitue pas une garantie de compatibilité avec d’autres modèles.

Les sous-variantes thermiques HB/O2 sont rejetées. La stabilité des reconnexions, le fonctionnement sur matériel mobile et la comparaison des mesures avec des instruments restent à qualifier.

## Utilisation locale

Prérequis : **Node.js 24 ou supérieur** et **Python 3**.

```sh
npm test
npm start
```

Ouvrir ensuite [http://127.0.0.1:8765](http://127.0.0.1:8765) dans un navigateur compatible.

La bibliothèque i18next est fournie localement dans les fichiers du site : son chargement à l’exécution fonctionne hors ligne, sans CDN. La première ouverture du site public nécessite une connexion réseau.

Pour mettre à jour la copie locale depuis la dépendance verrouillée :

```sh
npm ci
npm run sync-i18next
```

## Documentation technique

Voir la [cartographie du protocole](docs/protocol.md) pour les trames de lecture, les conversions et les limites d’interprétation.
