import Button from '../components/ui/Button.jsx'
import styles from './NotFound.module.css'

export default function NotFound() {
  return (
    <div className={styles.page}>
      <p className={styles.code}>404</p>
      <h1 className={styles.title}>That page does not exist</h1>
      <p className={styles.message}>
        The link may be out of date. The dashboard, quotations, invoices, clients and settings pages are all
        reachable from the navigation.
      </p>
      <div className={styles.actions}>
        <Button variant="primary" to="/">
          Go to dashboard
        </Button>
        <Button variant="ghost" to="/settings">
          Settings
        </Button>
      </div>
    </div>
  )
}
