// JEU D'ESSAI DE RAPPEL — le côté DÉFINITION des deux règles cross-file qui lèvent un constat.
// Voir l'en-tête de index.html.
//
// Ces deux composants ne sont référencés par aucune page HTML du site : ils sont audités comme
// SOURCE, jamais parcourus par le crawl — comme LoginForm.tsx, et pour la même raison.
//
// Les règles cross-file n'existent qu'avec `--graph` : sans lui l'audit lit chaque fichier
// isolément, et le défaut n'est dans aucun des deux fichiers pris séparément. C'est ce que
// tests/fixture-recall.test.ts vérifie, en auditant avec `graph: true`.

/** Un bouton d'icône qui ACCEPTE un nom accessible par diffusion de props et n'en fabrique
 *  aucun lui-même. Une utilisation qui n'en passe pas laisse un bouton muet : c'est
 *  `cross-icon-only-unnamed`, et un fichier lu seul ne peut pas le voir — l'icône est ici,
 *  l'omission est là-bas. */
export function IconButton({ onClick, ...rest }: { onClick?: () => void; [key: string]: unknown }) {
  return (
    <button type="button" onClick={onClick} {...rest}>
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path d="M2 8 L14 8" />
      </svg>
    </button>
  );
}

/** Un bouton qui rend un contrôle, n'accepte AUCUN nom par props, et n'en porte pas non plus
 *  en dur. Une utilisation qui lui passe `aria-label` croit le nommer ; le nom est jeté à la
 *  frontière du composant. C'est `cross-prop-drilled-name-lost`. */
export function CloseButton() {
  return (
    <button type="button">
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path d="M2 2 L14 14 M14 2 L2 14" />
      </svg>
    </button>
  );
}
