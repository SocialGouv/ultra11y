// True positive: an <html> that nothing gives a language to.
export function NoLangShell({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <head>
        <title>No lang</title>
      </head>
      <body>{children}</body>
    </html>
  );
}
