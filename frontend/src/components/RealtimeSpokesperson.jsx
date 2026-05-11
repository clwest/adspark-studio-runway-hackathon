import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { friendlyError, ERROR_HINTS } from '../errors'
// PR EE — realtime tool dispatch. Single onClientEvent handler routes
// `client_event` messages to per-tool logic. Toast surfaces what the
// avatar just did so the operator can SEE the agent's actions land.
import { dispatchRealtimeToolEvent } from '../realtimeTools'
import { useToast } from './Toast.jsx'

// Lazy-load the SDK so any package-level error stays isolated and
// CampaignGallery keeps rendering even if @runwayml/avatars-react
// fails to initialize. The component is only mounted while a session
// is active.
const AvatarCall = lazy(() =>
  import('@runwayml/avatars-react').then((m) => ({ default: m.AvatarCall })),
)

/** Minimal MM:SS countdown until ISO timestamp. */
function fmtRemaining(expiresAtIso) {
  if (!expiresAtIso) return ''
  const ms = new Date(expiresAtIso).getTime() - Date.now()
  if (Number.isNaN(ms)) return ''
  const sec = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(sec / 60)
  const s = String(sec % 60).padStart(2, '0')
  return `${m}:${s}`
}

// Suggested prompt chips (PR M / P1 #6).
//
// The realtime broker does NOT pass campaign context to Runway today
// (verified in docs/research/FLOW_INTEGRATION_AUDIT.md §"Flow 5"). The
// avatar genuinely doesn't know the campaign. These chips give the
// user campaign-grounded questions to read aloud (or copy and paste
// into a voice tool of choice). Chips are populated from campaign
// fields so each saved card surfaces a tailored set.
function buildPromptChips(campaign) {
  const concept = campaign?.selected_concept || {}
  const subject =
    (campaign?.product && campaign.product.trim()) ||
    (campaign?.business && campaign.business.trim()) ||
    'this product'
  const audience = (campaign?.audience && campaign.audience.trim()) || ''
  const hook = (concept?.hook && concept.hook.trim()) || ''

  const chips = [
    hook
      ? `Pitch ${subject} in one sentence — the hook is "${hook}".`
      : `Pitch ${subject} in one sentence.`,
    audience
      ? `Who is this campaign for? It's ${audience}.`
      : 'Who is this campaign for?',
    `Give me three stronger ad angles for ${subject}.`,
    `How should this spokesperson sell the offer?`,
    `Make this pitch funnier.`,
    `Make this pitch more premium.`,
  ]
  return chips
}

/**
 * "Talk to your Brand Spokesperson" — Phase I V1.
 *
 * Renders three states:
 *   - **gated**: avatar not ready in real mode → disabled button + reason
 *   - **idle**: ready to start; Start Conversation button
 *   - **live**: <AvatarCall> mounted, mic on, webcam off, countdown shown
 *   - **failed**: error surfaced with retry
 *
 * Mic permission is requested by the SDK on mount.  The component
 * does not auto-start; user must click Start.  No realtime work is
 * triggered for normal campaign flows.
 */
export default function RealtimeSpokesperson({
  campaign,
  character,
  gateReason,
  autostart,
  onAutostartConsumed,
}) {
  // PR EE — useToast may be null if this component is mounted outside
  // a ToastProvider (the CampaignGallery legacy path doesn't wrap).
  // Soft-fall to noop so the realtime path stays operational either way.
  const toast = useToast()
  const announce = toast?.push || (() => {})

  const handleClientEvent = useCallback(
    (event) => {
      // SDK has already validated shape; dispatcher silently drops
      // unknown tool names so future avatar-side experiments don't
      // crash the session.
      dispatchRealtimeToolEvent(event, { campaign, character, announce })
    },
    [campaign, character, announce],
  )

  const [phase, setPhase] = useState('idle') // 'idle' | 'creating' | 'live' | 'ending' | 'failed'
  const [session, setSession] = useState(null)
  const [errMsg, setErrMsg] = useState('')
  const [tick, setTick] = useState(0)
  const [copiedChipIdx, setCopiedChipIdx] = useState(null)
  const tickRef = useRef(null)

  const promptChips = buildPromptChips(campaign)

  const handleCopyChip = useCallback(async (text, idx) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      }
    } catch {
      // Clipboard API unavailable (insecure context, permission denied) —
      // chip still acts as a read-aloud cue, no error path needed.
    }
    setCopiedChipIdx(idx)
    setTimeout(() => {
      setCopiedChipIdx((cur) => (cur === idx ? null : cur))
    }, 1200)
  }, [])

  // Update the countdown once a second while live.
  useEffect(() => {
    if (phase !== 'live' || !session?.expires_at) return undefined
    tickRef.current = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(tickRef.current)
  }, [phase, session?.expires_at])

  const handleEnd = useCallback(async () => {
    setPhase('ending')
    const sid = session?.session_id
    if (sid) {
      try {
        await api.endSpokespersonSession(campaign.id, sid)
      } catch {
        // best-effort; backend handler is forgiving
      }
    }
    setSession(null)
    setPhase('idle')
  }, [campaign.id, session?.session_id])

  const handleStart = useCallback(async () => {
    setErrMsg('')
    setPhase('creating')
    try {
      const resp = await api.startSpokespersonSession(campaign.id)
      setSession(resp)
      setPhase('live')
    } catch (e) {
      setErrMsg(friendlyError(e, ERROR_HINTS.realtime || 'Realtime session'))
      setPhase('failed')
    }
  }, [campaign.id])

  // PR EM-g — auto-start when the parent flips `autostart` true (e.g.
  // after the workspace consumes `?autostart=1` from a handoff
  // navigation). Single-shot: parent clears the flag via
  // `onAutostartConsumed` so the effect can't loop. Gated paths and
  // non-idle phases short-circuit so we never start over a live or
  // already-failed session.
  useEffect(() => {
    if (!autostart) return
    if (gateReason) return
    if (phase !== 'idle') return
    if (!campaign?.id) return
    handleStart()
    onAutostartConsumed?.()
  }, [autostart, gateReason, phase, campaign?.id, handleStart, onAutostartConsumed])

  const remaining = phase === 'live' && session?.expires_at
    ? fmtRemaining(session.expires_at) || `${tick % 0}` // ref tick to keep effect honest
    : ''

  // PR AE — chip row reframed as "starter questions". The broker now
  // injects campaign-aware personality + startScript on session
  // create, so chips no longer need to "patch missing context" — they
  // are jumping-off questions the user can ask the brand-aware avatar.
  const chipRow = (
    <div
      className="flex flex-wrap gap-1"
      aria-label="starter questions for the campaign-aware spokesperson"
    >
      {promptChips.map((text, i) => {
        const copied = copiedChipIdx === i
        return (
          <button
            key={i}
            type="button"
            onClick={() => handleCopyChip(text, i)}
            className={`text-[10px] rounded-full px-2 py-0.5 border transition-colors ${
              copied
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/40'
                : 'bg-zinc-800 text-zinc-300 border-zinc-700 hover:border-fuchsia-400 hover:text-fuchsia-200'
            }`}
            title={copied ? 'Copied to clipboard' : 'Click to copy — ask the brand-aware avatar this once you start the conversation'}
          >
            {copied ? '✓ copied' : text}
          </button>
        )
      })}
    </div>
  )

  // Header: section heading + status pill
  const header = (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-zinc-300">
          Talk to Brand Spokesperson
        </span>
        <span
          className="text-[10px] text-zinc-500 font-mono"
          title="Realtime Runway Avatar session via /v1/realtime_sessions"
        >
          Realtime Runway Avatar
        </span>
      </div>
      {phase === 'live' && (
        <span
          className="text-[10px] rounded-full bg-fuchsia-500/20 text-fuchsia-300 px-2 py-0.5 font-mono"
          title="Session expires at this countdown"
        >
          live · {remaining || '0:00'}
        </span>
      )}
      {phase === 'failed' && (
        <span className="text-[10px] rounded-full bg-rose-500/20 text-rose-300 px-2 py-0.5 font-mono">
          failed
        </span>
      )}
    </div>
  )

  // Gated path — avatar not ready in real mode, or mock mode.
  if (gateReason) {
    return (
      <div className="border-t border-zinc-800/60 pt-2 space-y-1.5">
        {header}
        <p className="text-[10px] text-zinc-500 leading-relaxed">
          {/* PR AE — broker now injects campaign-aware personality +
              startScript into the session create body, so the avatar
              opens with brand context instead of a generic greeting. */}
          This avatar knows the campaign brief and saved script. Ask
          it about the product, audience, or pitch.
        </p>
        {chipRow}
        <button
          type="button"
          disabled
          className="rounded-md bg-fuchsia-500/30 text-zinc-300 text-xs px-2 py-1 cursor-not-allowed"
          title={gateReason}
        >
          Start Conversation (unavailable)
        </button>
        <p className="text-[10px] text-amber-300">{gateReason}</p>
      </div>
    )
  }

  // PR EM-f — Live path now renders as a Zoom-style overlay. Before,
  // the AvatarCall mounted INLINE inside the conversations tab and
  // pushed everything below it further down the page. That broke
  // focus during what's supposed to be a face-to-face conversation
  // with the avatar. New behaviour:
  //
  //   - When phase === 'live': a fixed-position overlay covers the
  //     viewport, dim backdrop, centered avatar tile, controls
  //     footer, and a collapsible right-side panel with prompt
  //     chips + campaign context.
  //   - Body scroll locked so the overlay feels modal.
  //   - The page beneath stays put — End Conversation closes the
  //     overlay and returns the operator to the tab they were on.
  if (phase === 'live' && session) {
    const campaignLabel =
      (campaign?.business || '').trim()
      || (campaign?.product || '').trim()
      || 'this campaign'
    return (
      <RealtimeOverlay
        spokespersonName={
          (campaign?.attached_character_name || 'Brand Spokesperson')
        }
        campaignLabel={campaignLabel}
        remaining={remaining}
        chipRow={chipRow}
        onEnd={handleEnd}
      >
        <Suspense
          fallback={
            <div className="text-[12px] text-zinc-400 italic px-4 py-8 rounded-lg border border-zinc-800 bg-zinc-950/40">
              Loading Runway Avatars SDK…
            </div>
          }
        >
          <AvatarCall
            sessionId={session.session_id}
            sessionKey={session.session_key}
            audio
            video={false}
            avatarImageUrl={campaign.host_avatar_image_url || undefined}
            onEnd={() => handleEnd()}
            onError={(err) => {
              setErrMsg(`Realtime SDK: ${err?.message || err || 'unknown'}`)
              setPhase('failed')
            }}
            // PR EE — receives client_event messages when the avatar
            // invokes a tool. dispatchRealtimeToolEvent routes by
            // name and announces the action via toast.
            onClientEvent={handleClientEvent}
            className="w-full max-w-3xl rounded-xl ring-1 ring-zinc-700/60 bg-zinc-950 p-2 shadow-2xl"
          />
        </Suspense>
      </RealtimeOverlay>
    )
  }

  // Idle / creating / failed
  return (
    <div className="border-t border-zinc-800/60 pt-2 space-y-1.5">
      {header}
      <p className="text-[10px] text-zinc-500 leading-relaxed">
        {/* PR AE — broker injects campaign personality + startScript so
            the avatar opens with brand context. The chips below are now
            starter questions, not context patches. */}
        This avatar knows the campaign brief and saved script. Ask
        it about the product, audience, or pitch.{' '}
        <span className="text-zinc-400">Mic required. Webcam optional.</span>
      </p>
      {chipRow}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={handleStart}
          disabled={phase === 'creating'}
          className="rounded-md bg-fuchsia-500/80 hover:bg-fuchsia-500 text-zinc-100 text-xs px-2 py-1 disabled:opacity-50"
        >
          {phase === 'creating'
            ? 'Connecting…'
            : phase === 'failed'
            ? 'Retry Conversation'
            : 'Start Conversation'}
        </button>
        {phase === 'creating' && (
          <span className="text-[10px] text-zinc-500">
            allow mic when prompted
          </span>
        )}
      </div>
      {phase === 'failed' && errMsg && (
        <p className="text-[10px] text-rose-300" title={errMsg}>
          {errMsg}
        </p>
      )}
    </div>
  )
}


/**
 * PR EM-f — Zoom-style overlay for the live realtime conversation.
 *
 * Renders as a fixed-position layer over the page with three zones:
 *
 *   1. Top bar: spokesperson name + 'live · countdown' pill + close
 *      button (close acts as End Conversation).
 *   2. Stage: large centered avatar video tile, dim backdrop, soft
 *      vignette. Self-view hidden (webcam off by default).
 *   3. Right side panel (collapsible): prompt chips, mic tips. Hidden
 *      by default so the avatar dominates; click "Tips" to show.
 *   4. Bottom controls bar: End Conversation, mic-status hint.
 *
 * Body scroll is locked while mounted so the page underneath doesn't
 * peek through scroll wheels / trackpad.
 */
function RealtimeOverlay({
  spokespersonName,
  campaignLabel,
  remaining,
  chipRow,
  children,
  onEnd,
}) {
  const [showPanel, setShowPanel] = useState(false)

  // Lock body scroll for the lifetime of the overlay; restore on
  // unmount so the page returns to its prior state cleanly.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  return (
    <div
      data-testid="realtime-conversation-overlay"
      data-phase="live"
      className="fixed inset-0 z-40 flex flex-col bg-black/85 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label="Live realtime conversation"
    >
      {/* Top bar */}
      <header className="shrink-0 px-4 sm:px-6 py-3 flex items-center justify-between gap-3 border-b border-zinc-800/60 bg-zinc-950/60">
        <div className="flex items-center gap-3 min-w-0">
          <span aria-hidden="true" className="text-base">🎙️</span>
          <div className="min-w-0 leading-tight">
            <div className="text-sm font-semibold text-zinc-100 truncate">
              {spokespersonName}
            </div>
            <div className="text-[10px] text-zinc-400 font-mono truncate">
              {campaignLabel} · Realtime Runway Avatar
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="text-[10px] rounded-full bg-fuchsia-500/20 text-fuchsia-200 px-2 py-0.5 font-mono ring-1 ring-fuchsia-400/40"
            title="Runway hard-caps realtime sessions at 5 minutes"
          >
            live · {remaining || '0:00'}
          </span>
          <button
            type="button"
            onClick={() => setShowPanel((v) => !v)}
            data-testid="realtime-overlay-tips-toggle"
            className="text-[11px] rounded-md px-2 py-1 ring-1 ring-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-zinc-200"
            title="Show prompt chips + mic tips"
          >
            {showPanel ? 'Hide tips' : 'Tips ▾'}
          </button>
          <button
            type="button"
            onClick={onEnd}
            data-testid="realtime-overlay-close"
            className="text-[14px] rounded-md w-8 h-8 ring-1 ring-zinc-700 bg-zinc-900 hover:bg-rose-500/30 hover:ring-rose-400/60 text-zinc-200"
            title="End conversation (Esc-equivalent)"
            aria-label="End conversation"
          >
            ×
          </button>
        </div>
      </header>

      {/* Stage + side panel */}
      <div className="flex-1 min-h-0 flex flex-row">
        <main className="flex-1 min-w-0 flex items-center justify-center p-4 sm:p-6">
          <div className="w-full max-w-3xl">
            {children}
          </div>
        </main>
        {showPanel && (
          <aside
            data-testid="realtime-overlay-panel"
            className="w-full sm:w-80 shrink-0 border-l border-zinc-800/60 bg-zinc-950/70 p-4 overflow-y-auto"
          >
            <h3 className="text-[11px] uppercase tracking-wide text-zinc-400 font-mono mb-2">
              Try saying
            </h3>
            <div className="space-y-1">{chipRow}</div>
            <h3 className="text-[11px] uppercase tracking-wide text-zinc-400 font-mono mt-4 mb-2">
              Mic tips
            </h3>
            <ul className="text-[11px] text-zinc-300 leading-snug space-y-1 list-disc pl-4">
              <li>Wait for the avatar to stop speaking before you reply — overlap pauses the session.</li>
              <li>Headphones avoid the audio loop into the mic.</li>
              <li>Close noisy apps (Slack, fans, browser tabs with autoplay).</li>
              <li>Session auto-ends at the 5-min countdown above.</li>
            </ul>
            <h3 className="text-[11px] uppercase tracking-wide text-zinc-400 font-mono mt-4 mb-2">
              Memory-aware commands
            </h3>
            <ul className="text-[11px] text-zinc-300 leading-snug space-y-1 list-disc pl-4">
              <li><span className="text-zinc-100">"What have we talked about?"</span> — recalls past sessions.</li>
              <li><span className="text-zinc-100">"Save what we just discussed."</span> — persists this conversation as memory on the active campaign.</li>
              <li><span className="text-zinc-100">"Render an ad about X."</span> — agentic loop: LLM drafts, Runway renders.</li>
            </ul>
          </aside>
        )}
      </div>

      {/* Bottom controls */}
      <footer className="shrink-0 px-4 sm:px-6 py-3 flex items-center justify-center gap-2 border-t border-zinc-800/60 bg-zinc-950/60">
        <button
          type="button"
          onClick={onEnd}
          data-testid="realtime-overlay-end"
          className="rounded-md bg-rose-500/80 hover:bg-rose-500 text-zinc-100 text-sm font-semibold px-4 py-2 transition-colors"
        >
          End Conversation
        </button>
        <span className="text-[10px] text-zinc-500 font-mono ml-2">
          mic on · webcam off · session auto-ends at 5:00
        </span>
      </footer>
    </div>
  )
}
