import './live-message.css'

// A live region is only announced when it already exists before its text changes, so this element stays
// mounted for the lifetime of its owner and swaps only the message. The caller's styling is applied only
// while there is a message, and live-message.css keeps the empty region out of the layout.
export function LiveMessage({ id, className, message }: { id?: string; className?: string; message?: string | null }) {
  return <p id={id} aria-live="polite" aria-atomic="true" className={message && className ? `live-message ${className}` : 'live-message'}>{message}</p>
}
