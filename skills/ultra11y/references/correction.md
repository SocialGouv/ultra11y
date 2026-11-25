# Phase de correction (mettre les correctifs en place, par priorité)

Corriger sans rien casser ni rien inventer. Doctrine (HTML natif d’abord, changement le plus
petit possible, aucune régression) appliquée par ordre de priorité.

## Ordre de traitement

1. **🔴 Bloquant d’abord**, puis 🟠 majeur, puis 🟡 mineur — l’ordre du backlog `prd` et du
   rapport. Sur un gros dépôt, traiter d’abord les gabarits partagés (layouts, design system) :
   un correctif à cet endroit couvre tout le site.
2. **Trois classes de correctif** (`fix`) :
   - **auto** — codemods déterministes (tabindex positif, ARIA redondant, zoom bloqué) ; sûrs
     à appliquer sans supervision.
   - **placeholder** — insère un attribut valide avec un `TODO` (alt/lang/title/aria-label)
     que vous remplacez par une vraie valeur adaptée au contexte.
   - **proposal** — jugement uniquement ; le moteur n’invente jamais de contenu (texte
     alternatif, fonction du lien, structure de tableau) — l’agent IA le rédige et arbitre le
     critère (`verify --manual`, soumis au garde-fou).
3. **Exemples conformes / non conformes** : pour chaque motif, partir du plus petit changement
   qui rend le HTML **rendu** conforme (pas seulement la source). Si un composant de
   bibliothèque ne s’instancie pas correctement (p. ex. un bouton DSFR icône seule sans
   `title`), corriger au point d’utilisation et revérifier sur le rendu.

## Commandes

```
node scripts/ultra11y.mjs fix "src/**/*.html"            # dry-run: proposed diff
node scripts/ultra11y.mjs fix "src/**/*.html" --write     # apply (auto+placeholder)
node scripts/ultra11y.mjs fix "src/**/*.tsx"  --write     # real JSX: jsxSafe codemods only
node scripts/ultra11y.mjs fix "src/**" --write --iterate   # re-audit + re-apply to a fixpoint
node scripts/ultra11y.mjs fix "src/**" --only img-alt-missing,positive-tabindex
node scripts/ultra11y.mjs prd  --in audits/audit-latest.json   # prioritized backlog of remaining fixes
```

- **Garde-fou anti-régression** : `--write` n’applique que si un nouvel audit prouve
  qu’aucune nouvelle non-conformité n’est introduite (y compris aucun nouveau type de constat).
  Un placeholder invalide est donc bloqué.
- **JSX/TSX** : `fix --write` n’applique que les codemods sûrs (retirer de l’ARIA, insérer
  des attributs React valides) ; il ne réécrit jamais un nom d’attribut (pas de
  `tabIndex={5}` → `tabindex="0"`). Le reste demeure une proposition.
- Après correction, **boucler** : nouvel audit, nouveau jugement des `proposal`, jusqu’à ce
  que `check`/`verify` repassent au vert (voir la section « boucle » du SKILL).
