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
export default function RealtimeSpokesperson({ campaign, character, gateReason }) {
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

  // Live path — SDK mounted.
  if (phase === 'live' && session) {
    return (
      <div className="border-t border-zinc-800/60 pt-2 space-y-2">
        {header}
        <p className="text-[10px] text-zinc-500">
          Mic required. Webcam disabled. Session ends automatically at the
          countdown above.
        </p>
        <Suspense
          fallback={
            <div className="text-[11px] text-zinc-500 italic px-2 py-3 rounded-md border border-zinc-800 bg-zinc-950/40">
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
            className="w-full max-w-sm rounded-lg border border-zinc-800 bg-zinc-950/40 p-2"
          />
        </Suspense>
        <button
          type="button"
          onClick={handleEnd}
          className="rounded-md border border-zinc-700 hover:border-fuchsia-400 text-xs px-2 py-1 text-zinc-200"
        >
          End Conversation
        </button>
      </div>
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
