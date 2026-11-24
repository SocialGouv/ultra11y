import styles from "./Logo.module.css";
import logo from "./logo.png";

// An image with no text alternative.
export default function Logo() {
  return <img className={styles.logo} src={String(logo)} width={120} height={40} />;
}
