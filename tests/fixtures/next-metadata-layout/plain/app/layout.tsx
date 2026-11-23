import { PlainShell } from "../../src/PlainShell";

// No metadata export: nothing gives the document a <title>.
export default function PlainLayout({ children }: { children: React.ReactNode }) {
  return <PlainShell>{children}</PlainShell>;
}
