import { Button } from "./Button";

export function ContactForm() {
  return (
    <form>
      <label htmlFor="email">Courriel</label>
      <input id="email" type="email" />
      <Button>Envoyer</Button>
    </form>
  );
}
