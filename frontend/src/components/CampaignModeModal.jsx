import { useEffect, useRef } from 'react'

/**
 * PR BH — Mode-first campaign creation modal (gated v2).
 *
 * Three-card picker that asks the operator to choose intent before
 * the brief: Cinematic Ad / Spokesperson Ad / Dialogue Scene. The
 * lane-specific builders (PR BI / BJ / BK) consume this choice as
 * a routing input; until those land, the parent surface (PR BH:
 * SpokespersonStudio) just persists the selection to localStorage
 * via uxFlag.setActiveMode and renders a "Mode selected. Lane-
 * specific builder lands next." banner.
 *
 * Backend untouched. Default v1 UX never sees this modal — it's
 * mounted only inside the v2 SpokespersonStudio code path.
 *
 * Dismiss paths:
 *   - click a mode card    → onSelect(mode); modal closes
 *   - click backdrop / X   → onClose(); modal closes without
 *                              persisting a mode
 *   - press Escape         → onClose()
 */
const MODE_CARDS = [
  {
    id: 'cinematic',
    emoji: '🎬',
    label: 'Cinematic Ad',
    summary: 'Silent visual cut + voiced commercial mux',
    detail:
      'Image-to-video for the visual. Real spokesperson narration ' +
      'muxed in via ffmpeg. Best when the brand wants a polished, ' +
      'non-talking-head spot.',
  },
  {
    id: 'spokesperson',
    emoji: '🎙️',
    label: 'Spokesperson Ad',
    summary: 'Lip-synced talking-avatar render',
    detail:
      'Runway avatar_videos generates the spokesperson speaking ' +
      'the saved Commercial Script directly to camera. Captioned ' +
      'reels export ships alongside the horizontal cut.',
  },
  {
    id: 'dialogue',
    emoji: '🎭',
    label: 'Dialogue Scene',
    summary: 'Multi-character stitched skit',
    detail:
      'Plan Hook / Beat / Closer lines across multiple ' +
      'spokespeople; ffmpeg-concat the per-line avatar_videos into ' +
      'one branded skit with per-line captions.',
  },
]

export default function CampaignModeModal({ isOpen, onSelect, onClose }) {
  const dialogRef = useRef(null)

  // Close on Escape; focus the dialog on open so screen readers /
  // keyboard navigation start at the modal rather than the page
  // body underneath.
  useEffect(() => {
    if (!isOpen) return undefined
    const handleKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose?.()
      }
    }
    window.addEventListener('keydown', handleKey)
    if (dialogRef.current) {
      try {
        dialogRef.current.focus()
      } catch {
        // No-op — the modal still renders even if focus throws.
      }
    }
    return () => window.removeEventListener('keydown', handleKey)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      data-testid="campaign-mode-modal-backdrop"
      onClick={(e) => {
        // Click outside the dialog → close. Clicks inside stop
        // propagation below.
        if (e.target === e.currentTarget) onClose?.()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="campaign-mode-modal-title"
        tabIndex={-1}
        data-testid="campaign-mode-modal"
        className="w-full max-w-2xl rounded-2xl ring-1 ring-pink-400/20 bg-studio-900 p-5 space-y-4 shadow-panel outline-none"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1">
            <h3
              id="campaign-mode-modal-title"
              className="text-base font-semibold text-zinc-100"
            >
              Choose campaign type
            </h3>
            <p className="text-xs text-zinc-400 max-w-prose leading-relaxed">
              Each type is purpose-built for a different output shape.
              Pick one to start; you can always create another
              campaign in a different type later.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            data-testid="campaign-mode-modal-close"
            aria-label="Close"
            className="text-zinc-500 hover:text-zinc-200 text-lg leading-none px-2 py-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-400"
          >
            ×
          </button>
        </div>

        <div
          className="grid grid-cols-1 sm:grid-cols-3 gap-2.5"
          data-testid="campaign-mode-modal-cards"
        >
          {MODE_CARDS.map((card) => (
            <button
              key={card.id}
              type="button"
              onClick={() => onSelect?.(card.id)}
              data-testid={`campaign-mode-card-${card.id}`}
              data-mode={card.id}
              className="text-left rounded-xl ring-1 ring-zinc-800 hover:ring-pink-400/50 hover:bg-pink-500/5 bg-zinc-950/50 p-3 space-y-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-400"
            >
              <div className="flex items-center gap-2">
                <span className="text-xl" aria-hidden="true">
                  {card.emoji}
                </span>
                <span className="text-sm font-semibold text-zinc-100">
                  {card.label}
                </span>
              </div>
              <div className="text-[10px] uppercase tracking-wide text-zinc-500 font-mono">
                {card.summary}
              </div>
              <p className="text-[11px] text-zinc-400 leading-snug">
                {card.detail}
              </p>
            </button>
          ))}
        </div>

        <p className="text-[10px] text-zinc-600 leading-relaxed">
          Your selection is remembered for this spokesperson — the
          matching builder mounts inside the workspace below.
        </p>
      </div>
    </div>
  )
}
