export function Card({ title, description }: { title: string; description: string }) {
  return (
    <div className="fr-card">
      <h3 className="fr-card__title">{title}</h3>
      <p className="fr-card__desc">{description}</p>
    </div>
  );
}
