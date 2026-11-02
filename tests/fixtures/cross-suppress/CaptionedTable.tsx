// egapro's SelectedFilesTable (#133): the `title` prop is not dropped, it becomes the table's
// <caption> (and its column header). The <a href> it also renders is named by its own dynamic
// text. A name prop the component READS has not been lost at the boundary, so
// cross-prop-drilled-name-lost must stay silent on the usage.
type Props = { title: string; files: { name: string; url: string }[] };

export function CaptionedTable({ title, files }: Props) {
  return (
    <table>
      <caption>{title}</caption>
      <tbody>
        {files.map((file) => (
          <tr key={file.name}>
            <td>
              <a href={file.url}>{file.name}</a>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Same reading through a `props` object: props.title reaches the heading.
export function PropsTitled(props: { title: string; href: string }) {
  return (
    <section>
      <h2>{props.title}</h2>
      <a href={props.href}>
        <svg viewBox="0 0 16 16" />
      </a>
    </section>
  );
}

// The true positive kept: `props` is read, but never `props.title` — the passed name goes nowhere.
export function PropsDropsTitle(props: { href: string }) {
  return (
    <a href={props.href}>
      <svg viewBox="0 0 16 16" />
    </a>
  );
}
