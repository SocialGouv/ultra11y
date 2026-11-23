// An icon-only button with no accessible name.
export function IconButton() {
  return (
    <button type="button" className="icon-btn">
      <svg aria-hidden="true" viewBox="0 0 16 16">
        <path d="M2 2h12v12H2z" />
      </svg>
    </button>
  );
}
