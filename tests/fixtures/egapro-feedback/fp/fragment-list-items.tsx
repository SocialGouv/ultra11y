// egapro CompliancePathOptions.tsx (#106): components return fragments of <li>s that the
// caller places inside <ul>{children}</ul>. Their parent is the caller's, not this file's.
import type { ReactNode } from "react";

function ObligationsList({ children, heading }: { children: ReactNode; heading: ReactNode }) {
	return (
		<div>
			<p>{heading}</p>
			<ul>{children}</ul>
		</div>
	);
}

function CseJustificationItems() {
	return (
		<>
			<li>Informer et consulter votre CSE sur la justification des écarts</li>
			<li>Transmettre l&apos;avis du CSE</li>
		</>
	);
}

export function JustifyObligations() {
	return (
		<ObligationsList heading="Vous devrez :">
			<CseJustificationItems />
		</ObligationsList>
	);
}
