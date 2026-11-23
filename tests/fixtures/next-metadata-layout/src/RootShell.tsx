export default function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <head>{/* scripts, fonts… no <title>: Next injects it from the layout's metadata */}</head>
      <body>{children}</body>
    </html>
  );
}
