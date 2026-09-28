import { Component } from 'react'
import Button from '../components/ui/Button.jsx'
import styles from './ErrorBoundary.module.css'

/**
 * Last-resort boundary for render errors.
 *
 * Phase 1 keeps it deliberately plain: a plain-language message, the error text
 * for support, and a way to recover without a full reload. Route-level errors get
 * a boundary with that route as its reset target in a later phase.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    if (import.meta.env.DEV) {
      console.error('Ruchita Interiors render error', error, info)
    }
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <main id="main-content" className={styles.page}>
        <h1 className={styles.title}>Something went wrong</h1>
        <p className={styles.message}>
          The screen could not be drawn. Reloading usually clears it; if it keeps happening, the message below
          identifies the problem.
        </p>
        <pre className={styles.detail}>{String(error?.message || error)}</pre>
        <div className={styles.actions}>
          <Button variant="primary" onClick={() => window.location.reload()}>
            Reload
          </Button>
          <Button variant="ghost" onClick={() => this.setState({ error: null })}>
            Try again
          </Button>
        </div>
      </main>
    )
  }
}
