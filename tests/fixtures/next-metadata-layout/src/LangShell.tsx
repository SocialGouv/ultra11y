const lang = "fr";

export function LangShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang={lang}>
      <head />
      <body>{children}</body>
    </html>
  );
}
