import { formatDate } from "@/lib/format";

export default function Actualite() {
  return <p>{formatDate(new Date(0))}</p>;
}
