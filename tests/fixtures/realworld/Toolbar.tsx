// JEU D'ESSAI DE RAPPEL — le côté UTILISATION des deux règles cross-file qui lèvent un
// constat. La définition est dans IconButton.tsx ; voir l'en-tête de index.html.
import { CloseButton, IconButton } from "./IconButton";

export default function Toolbar() {
  return (
    <div className="barre-outils">
      {/* cross-icon-only-unnamed · RGAA 11.9 · WCAG 4.1.2 — le composant diffuse ses props sur
          un bouton d'icône, et cette utilisation ne lui en passe aucune : le bouton d'icône arrive sans nom accessible. Le défaut
          n'est visible qu'en croisant les deux fichiers. */}
      <IconButton />

      {/* Une utilisation correcte du même composant, juste à côté : la règle doit distinguer
          les deux, et un moteur qui les confondrait se signalerait ici. */}
      <IconButton aria-label="Déployer le site" />

      {/* cross-prop-drilled-name-lost · RGAA 7.1 · WCAG 4.1.2 — `aria-label` est passé à un
          composant qui ne le transmet à rien : le nom est perdu à la frontière, et l'auteur
          de cette ligne croit avoir nommé le bouton. */}
      <CloseButton aria-label="Fermer le panneau" />
    </div>
  );
}
