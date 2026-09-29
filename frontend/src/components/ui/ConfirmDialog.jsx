import Button from './Button.jsx'
import Sheet from './Sheet.jsx'
import styles from './ConfirmDialog.module.css'

/**
 * §20 confirmation for a destructive action. A thin wrapper over `Sheet` so the
 * focus-trap / Escape handling stays in one place (§18.3). The caller owns the
 * `open` state and closes via `onClose` (Cancel/backdrop) or after `onConfirm`
 * resolves in its own handler.
 *
 * @param {{
 *   open: boolean,
 *   title: string,
 *   message?: string,
 *   confirmLabel?: string,
 *   cancelLabel?: string,
 *   danger?: boolean,
 *   onConfirm: () => void,
 *   onClose: () => void,
 * }} props
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  onConfirm,
  onClose,
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title} description={message}>
      <div className={styles.actions}>
        <Button variant="ghost" onClick={onClose}>
          {cancelLabel}
        </Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Sheet>
  )
}
