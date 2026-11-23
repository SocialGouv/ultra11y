// True positive: an invalid literal language tag stays an invalid language tag.
export function BrokenLangShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="xx-invalid!">
      <head>
        <title>Broken</title>
      </head>
      <body>{children}</body>
    </html>
  );
}
