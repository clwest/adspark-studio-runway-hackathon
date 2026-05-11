import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

/**
 * PR DQ — Toast surface for completion feedback.
 *
 * Render-completion events (spokesperson ads, long ads, dialogue
 * stitches, reels exports) used to land silently — the campaign
 * slice refreshed and the new card appeared in the Videos tab, but
 * the operator got no announce-y feedback during a recording take.
 *
 * The toast surface is a fixed top-right stack of dismissible
 * banners. Each toast has a kind (`success` / `error` / `info`)
 * that maps to a colour band, a 4-second auto-dismiss, and a
 * click-to-dismiss affordance. Up to ~5 toasts can stack before
 * the screen feels crowded; we don't cap programmatically — the
 * 4s TTL keeps the stack thin in practice.
 *
 * Usage:
 *
 *     // Wrap the surface that needs toasts:
 *     <ToastProvider>
 *       <SpokespersonWorkspace />
 *     </ToastProvider>
 *
 *     // Inside any descendant:
 *     const { push } = useToast()
 *     push('Spokesperson Ad rendered', { kind: 'success' })
 *     push('Render failed — retry from Step 3', { kind: 'error' })
 *
 * No external state, no portals — toasts render inside the
 * Provider's own DOM subtree.
 */

const ToastContext = createContext({
  /* eslint-disable-next-line no-unused-vars */
  push: (_message, _opts) => {},
})

let _seq = 0

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  // Track timers per toast id so dismiss-on-click cancels the
  // scheduled auto-dismiss cleanly.
  const timersRef = useRef(new Map())

  const dismiss = useCallback((id) => {
    setToasts((cur) => cur.filter((t) => t.id !== id))
    const timer = timersRef.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timersRef.current.delete(id)
    }
  }, [])

  const push = useCallback((message, opts = {}) => {
    const id = ++_seq
    const kind = opts.kind === 'error' || opts.kind === 'info' ? opts.kind : 'success'
    const ttl = typeof opts.ttl === 'number' ? opts.ttl : (kind === 'error' ? 6000 : 4000)
    setToasts((cur) => [...cur, { id, message: String(message || ''), kind }])
    const timer = setTimeout(() => {
      setToasts((cur) => cur.filter((t) => t.id !== id))
      timersRef.current.delete(id)
    }, ttl)
    timersRef.current.set(id, timer)
    return id
  }, [])

  // Clean up timers on unmount.
  useEffect(() => () => {
    for (const timer of timersRef.current.values()) clearTimeout(timer)
    timersRef.current.clear()
  }, [])

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div
        data-testid="toast-stack"
        aria-live="polite"
        aria-atomic="true"
        className="fixed top-4 right-4 z-50 flex flex-col gap-1.5 items-end pointer-events-none"
      >
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}

const KIND_STYLES = {
  success: {
    ring: 'ring-emerald-400/60',
    bg: 'bg-emerald-500/95',
    text: 'text-emerald-50',
    icon: '✓',
  },
  error: {
    ring: 'ring-rose-400/60',
    bg: 'bg-rose-500/95',
    text: 'text-rose-50',
    icon: '⚠',
  },
  info: {
    ring: 'ring-sky-400/60',
    bg: 'bg-sky-500/95',
    text: 'text-sky-50',
    icon: 'ⓘ',
  },
}

function ToastItem({ toast, onDismiss }) {
  const style = KIND_STYLES[toast.kind] || KIND_STYLES.success
  return (
    <button
      type="button"
      data-testid="toast-item"
      data-kind={toast.kind}
      onClick={onDismiss}
      title="Click to dismiss"
      className={
        'pointer-events-auto min-w-[16rem] max-w-[24rem] rounded-lg shadow-lg ring-1 px-3 py-2 ' +
        'text-[11px] font-medium text-left transition-all hover:opacity-90 cursor-pointer ' +
        style.ring + ' ' + style.bg + ' ' + style.text
      }
    >
      <span aria-hidden="true" className="mr-1.5 font-mono">
        {style.icon}
      </span>
      <span>{toast.message}</span>
    </button>
  )
}
