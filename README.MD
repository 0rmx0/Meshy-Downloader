# Meshy Downloader

[English](#english) • [Français](#français)

---

# English

A browser extension for Chrome, Edge, Brave and Firefox that allows you to download and decrypt your generated 3D models from [Meshy.ai](https://www.meshy.ai?utm_source=chatgpt.com).

## Why this project exists

Meshy allows users to generate 3D models with AI, but downloading generated assets may require a paid subscription.

However, Meshy-generated models are distributed under a CC0 license.
This project was created from the idea that users should still be able to access the 3D assets they generated themselves.

This extension intercepts the encrypted 3D model data directly from the browser, decrypts it locally, and downloads the final model file.

## Features

* Download generated 3D models from Meshy
* Automatically decrypt encrypted model files
* Works directly inside Chrome and Firefox
* Lightweight and easy to use
* Fully client-side processing

## Supported Browsers

* [Mozilla Firefox](https://www.mozilla.org/firefox/) 128 or newer — use the [`firefox/`](firefox/) folder
* [Google Chrome](https://www.google.com/chrome/?utm_source=chatgpt.com)
* [Microsoft Edge](https://www.microsoft.com/edge?utm_source=chatgpt.com)
* [Brave Browser](https://brave.com/?utm_source=chatgpt.com)
* Other Chromium-compatible browsers

## Project structure

* Repository root: the Chrome/Chromium build (`manifest.json` + shared files)
* [`firefox/`](firefox/): the Firefox build — the same shared files plus a Firefox-specific `manifest.json` (`browser_specific_settings.gecko`)

`content.js`, `popup.js`, `popup.html` and `icon.png` are shared by both builds and live at the repository root. After editing them, sync the Firefox build with:

```bash
cp content.js popup.js popup.html icon.png firefox/
```

## Installation

### Chrome, Edge, Brave and other Chromium browsers

```bash id="9z28p0"
git clone https://github.com/0rmx0/Meshy-Downloader.git
```

1. Open your Chromium browser
2. Go to:

```text id="5y9t4q"
chrome://extensions
```

3. Enable **Developer mode**
4. Click **Load unpacked**
5. Select the project root folder

### Firefox (128+)

```bash
git clone https://github.com/0rmx0/Meshy-Downloader.git
```

1. Open Firefox and go to:

```text
about:debugging#/runtime/this-firefox
```

2. Click **Load Temporary Add-on...**
3. Select the `firefox/manifest.json` file

The add-on stays loaded until Firefox restarts. For a permanent install, zip the `firefox/` folder (e.g. `cd firefox && zip -r ../meshy-downloader.xpi .`) and install the archive from `about:addons` → gear icon → **Install Add-on From File...**. A signed version published on [addons.mozilla.org](https://addons.mozilla.org/) installs the same way.

## Usage

1. Open [Meshy.ai](https://www.meshy.ai?utm_source=chatgpt.com)
2. Generate a 3D model
3. Open the generated model page
4. Use the extension download button
5. The encrypted model will be retrieved, decrypted, and downloaded automatically

## How it works

The extension:

1. Detects requests containing generated 3D assets
2. Retrieves the encrypted model data
3. Decrypts the file locally
4. Downloads the usable 3D model

No external server is used.

## Disclaimer

This project is intended for educational and interoperability purposes only.

Users are responsible for complying with:

* Meshy's Terms of Service
* applicable copyright laws
* platform usage policies

This project does not bypass authentication or access content belonging to other users.

## Contributing

Pull requests, issues, and suggestions are welcome.

## License

This project is released under the Unlicense. You are free to use, modify, distribute, and reproduce this software without restriction. For more information, see the LICENSE file or visit: https://unlicense.org/

---

# Français

Une extension de navigateur pour Chrome, Edge, Brave et Firefox permettant de télécharger et déchiffrer les modèles 3D générés sur [Meshy.ai](https://www.meshy.ai?utm_source=chatgpt.com).

## Pourquoi ce projet existe

Meshy permet de générer des modèles 3D avec l’IA, mais le téléchargement des fichiers générés peut nécessiter un abonnement payant.

Cependant, les modèles générés par Meshy sont distribués sous licence CC0.
Je suis donc parti du principe que les utilisateurs devraient pouvoir accéder aux modèles qu’ils ont eux-mêmes générés.

Cette extension récupère le modèle 3D chiffré directement depuis le navigateur, le déchiffre localement puis télécharge le fichier final.

## Fonctionnalités

* Téléchargement des modèles 3D générés sur Meshy
* Déchiffrement automatique des fichiers
* Compatible Chrome et Firefox
* Léger et simple à utiliser
* Fonctionnement 100% local côté client

## Navigateurs compatibles

* [Mozilla Firefox](https://www.mozilla.org/fr/firefox/) 128 ou ultérieur — utiliser le dossier [`firefox/`](firefox/)
* [Google Chrome](https://www.google.com/chrome/?utm_source=chatgpt.com)
* [Microsoft Edge](https://www.microsoft.com/edge?utm_source=chatgpt.com)
* [Brave Browser](https://brave.com/?utm_source=chatgpt.com)
* Autres navigateurs compatibles Chromium

## Structure du projet

* Racine du dépôt : build Chrome/Chromium (`manifest.json` + fichiers partagés)
* [`firefox/`](firefox/) : build Firefox — les mêmes fichiers partagés plus un `manifest.json` spécifique à Firefox (`browser_specific_settings.gecko`)

`content.js`, `popup.js`, `popup.html` et `icon.png` sont communs aux deux builds et vivent à la racine du dépôt. Après les avoir modifiés, synchroniser le build Firefox avec :

```bash
cp content.js popup.js popup.html icon.png firefox/
```

## Installation

### Chrome, Edge, Brave et autres navigateurs Chromium

```bash id="v4l8ke"
git clone https://github.com/0rmx0/Meshy-Downloader.git
```

1. Ouvrir votre navigateur Chromium
2. Aller sur :

```text id="vpkd6m"
chrome://extensions
```

3. Activer le **Mode développeur**
4. Cliquer sur **Charger l’extension non empaquetée**
5. Sélectionner la racine du projet

### Firefox (128+)

```bash
git clone https://github.com/0rmx0/Meshy-Downloader.git
```

1. Ouvrir Firefox et aller sur :

```text
about:debugging#/runtime/this-firefox
```

2. Cliquer sur **Charger un module temporaire...**
3. Sélectionner le fichier `firefox/manifest.json`

Le module reste chargé jusqu’au redémarrage de Firefox. Pour une installation permanente, zipper le dossier `firefox/` (ex. `cd firefox && zip -r ../meshy-downloader.xpi .`) puis installer l’archive depuis `about:addons` → icône engrenage → **Installer un module à partir d’un fichier...**. Une version signée publiée sur [addons.mozilla.org](https://addons.mozilla.org/) s’installe de la même manière.

## Utilisation

1. Ouvrir [Meshy.ai](https://www.meshy.ai?utm_source=chatgpt.com)
2. Générer un modèle 3D
3. Ouvrir la page du modèle généré
4. Utiliser le bouton de téléchargement de l’extension
5. Le modèle chiffré sera récupéré, déchiffré puis téléchargé automatiquement

## Fonctionnement

L’extension :

1. Détecte les requêtes contenant les assets 3D
2. Récupère les données chiffrées du modèle
3. Déchiffre le fichier localement
4. Télécharge le modèle 3D utilisable

Aucun serveur externe n’est utilisé.

## Avertissement

Ce projet est fourni à des fins éducatives et d’interopérabilité uniquement.

Les utilisateurs sont responsables du respect :

* des Conditions d’utilisation de Meshy
* des lois applicables
* des règles d’utilisation de la plateforme

Ce projet ne contourne pas l’authentification et ne permet pas d’accéder aux contenus d’autres utilisateurs.

## Contribution

Les pull requests, issues et suggestions sont les bienvenues.

## Licence

Ce projet est distribué sous licence Unlicense. Vous êtes libre d’utiliser, modifier, distribuer et reproduire ce logiciel sans restriction. Pour plus d’informations, consultez le fichier LICENSE ou : https://unlicense.org/

---

Created by [0rmx0](https://github.com/0rmx0?utm_source=chatgpt.com)
