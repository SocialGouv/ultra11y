interface Props {
  user: { name: string };
}

// Needs a prop it is not given.
export function Greeting({ user }: Props) {
  return <p>Hello {user.name}</p>;
}
