// egapro#4919's fix: the shared FileUpload names its hidden file input with the caller's
// visible label (aria-labelledby={labelId}) and receives its id from the caller, whose
// <label htmlFor={inputId}> labels it. Neither name is visible to a source parse of this file.
export function FileUpload({ inputId, labelId }: { inputId: string; labelId: string }) {
	return (
		<div>
			<button aria-describedby={labelId} type="button">
				Sélectionner un fichier
			</button>
			<input aria-labelledby={labelId} className="fr-sr-only" id={inputId} tabIndex={-1} type="file" />
		</div>
	);
}

export function OtherUpload({ inputId }: { inputId: string }) {
	return <input id={inputId} type="file" />;
}
