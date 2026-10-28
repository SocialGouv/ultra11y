REFUGE — BANC DE TEST RGAA LOCAL

Point d’entrée : http://127.0.0.1:8765/
Catalogue opérateur : ouvrir catalogue.html dans un navigateur.

Périmètre
---------
Ce site prolonge la démo Microsoft Edge « devtools-a11y-testing ». Il reprend
ses photographies, sa palette bleue et jaune et son thème de refuge animalier.
La copie Microsoft d’origine reste intacte dans ../microsoft-edge-a11y, avec
son manifeste de provenance, son commit amont et sa licence MIT.

Les 59 critères déclarés non applicables dans l’audit du 28 octobre 2026
possèdent chacun un scénario négatif et un témoin distinct. Les témoins visent
le critère identifié, pas la conformité complète de chaque page. Pour 1.8,
le témoin remplace l’image-texte par du texte HTML et peut donc être NA.
Le site contient aussi des pages auxiliaires : navigation, alternatives,
transcriptions et documents.

Le fichier expected-results.json est l’oracle de test. Il contient les critères,
les tests normatifs, les défauts attendus, les actions et les préconditions.
Le champ observedVerdict est volontairement null. Un scénario construit n’est
pas une détection observée d’ultra11y et ne doit pas être présenté comme tel.

Lancer et reconstruire
---------------------
Depuis la racine du dépôt ultra11y :

  pnpm run demo:refuge

Python 3 suffit pour servir les fichiers déjà fournis. Sans pnpm :

  python3 demos/refuge-rgaa/serve.py

Le serveur écoute uniquement sur 127.0.0.1, port 8765. Si ce port sert déjà le
refuge, réutiliser le serveur. Ne pas arrêter un processus inconnu pour le libérer.
Un autre port peut être choisi avec --port 8768.

Les fichiers publics sont déjà fournis. Pour reconstruire le HTML :

  pnpm run demo:refuge:build

Pour régénérer les médias originaux :

  python3 demos/refuge-rgaa/build-assets.py
  pnpm run demo:refuge:build

Cette étape exige Python avec Pillow, ffmpeg (libvpx-vp9 et libopus),
espeak-ng et fontconfig (fc-match). Les médias générés sont locaux, sans appel
à un service externe. Leur texte source et leurs empreintes sont conservés
au niveau de asset-provenance.json. Le PDF contient volontairement une image
sans couche textuelle ; ses alternatives accessibles sont en HTML.

Vérifications
-------------
Les vérifications de navigateur utilisent @playwright/test déjà présent dans
le dépôt, avec son Chromium installé. Depuis la racine du dépôt :

  pnpm install
  pnpm exec playwright install chromium
  pnpm run demo:refuge:check
  pnpm run demo:refuge:test

Laisser le serveur lancé dans un autre terminal pendant les tests navigateur.
Le contrôle des fichiers utilise uniquement Python 3 et les données RGAA du
dépôt ; il peut aussi être lancé par python3 demos/refuge-rgaa/verify-files.py.

Pour un port différent :

  REFUGE_URL=http://127.0.0.1:8768 node demos/refuge-rgaa/verify-browser.mjs

Les résultats et captures vont dans audits/refuge-rgaa-build/. Les tests
vérifient les ressources, les 118 pages principales, les interactions ciblées,
la séparation entre cas et témoins, et la préservation des fichiers Microsoft.
Ils ne remplacent pas une adjudication complète RGAA.

Auditer sans contaminer les résultats
------------------------------------
Serveur lancé, depuis la racine du dépôt :

  node scripts/ultra11y.mjs audit "demos/refuge-rgaa/public/**/*.html" --exclude "**/temoins/**" --standard rgaa --lang fr --out audits/refuge-rgaa/static
  node scripts/ultra11y.mjs scan --crawl http://127.0.0.1:8765/ --depth 0 --max 0 --runtime local --cwd . --root audits/refuge-rgaa --merge audits/refuge-rgaa/static/audit-latest.json --out audits/refuge-rgaa/rendered --standard rgaa --lang fr
  node scripts/ultra11y.mjs verify --manual --in audits/refuge-rgaa/rendered/audit-latest.json --out audits/refuge-rgaa/adjudication --standard rgaa --lang fr

Ces commandes produisent les résultats automatiques, les captures et une
liste de critères à juger, pas un audit entièrement décidé. Suivre ensuite
skills/ultra11y/references/runbook.md pour l’adjudication et la réfutation.
Utiliser un nouveau dossier audits/ pour conserver une campagne antérieure.
Les rapports, captures et journaux sous audits/ ne sont pas versionnés.
La référence baseline du manifeste désigne l’audit historique local ; elle
n’est pas nécessaire pour reconstruire ou exécuter cette démo depuis un clone.

Le parcours depuis l’accueil ne contient que les cas négatifs, pas les témoins.
Le catalogue et l’oracle restent hors de public/ et ne doivent pas être fournis
au juge LLM avant son audit. Les variantes témoins vivent sous /temoins/ mais
aucun lien du parcours négatif ne les présente comme alternative accessible.

Les critères 12.1 à 12.5 doivent être évalués sur leur sous-ensemble de pages
respectif, identifié par auditScope dans le manifeste. Les guides 12.1 ont
17 pages avec deux niveaux ; la recherche générale ne les indexe pas et le
catalogue opérateur ne fait pas partie de leur navigation. Ne pas extrapoler
leur verdict à tous les autres sous-sites.

L’audit du code seul ne déclenche pas les défauts interactifs. Exécuter les
actions du manifeste avant de capturer les états concernés : validation,
révélation, raccourci, suppression, expiration, média ou changement de page.
Les résultats doivent rester distincts par page, variante et état, puis être
comparés aux attentes. Ne pas fusionner les témoins et cas négatifs en une
unique décision censée mesurer les faux positifs.

Conditions particulières
------------------------
4.10 : le navigateur peut bloquer la lecture automatique sonore. Dans ce cas,
le défaut attendu n’est pas observé. Le test utilise un profil Chromium isolé
avec --autoplay-policy=no-user-gesture-required et vérifie plus de 3 secondes
de lecture effective, non muette. Le fichier dure environ 5,8 secondes.

13.12 : un événement devicemotion synthétique contrôle le branchement logiciel.
La validation sur un vrai capteur et les permissions du terminal restent à
faire. Un bouton d’autorisation du capteur n’est pas une commande alternative
de la fonctionnalité. Le témoin possède un vrai bouton de choix et un réglage
qui désactive le mouvement.

Les messages et commandes peuvent être inspectés dans le DOM et l’arbre
accessible. Leur restitution effective avec lecteur d’écran n’a pas été
certifiée. Les médias sont synthétiques et leur sémantique est définie dans
asset-provenance.json ; une écoute indépendante reste une autre mesure.

Les données de notes sont fictives et enregistrées uniquement dans localStorage,
avec une clé préfixée refuge-rgaa:note: et isolée par URL. Aucun paiement,
envoi de demande ou accès à des données personnelles réelles n’est effectué.
