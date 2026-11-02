import { CaptionedTable, PropsTitled, PropsDropsTitle } from "./CaptionedTable";

export default function UsesCaptioned() {
  return (
    <>
      <CaptionedTable title="Fichiers sélectionnés" files={[]} />
      <PropsTitled title="Documents" href="/docs" />
      <PropsDropsTitle title="Télécharger" href="/dl" />
    </>
  );
}
