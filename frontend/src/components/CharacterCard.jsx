/**
 * Single character tile used by CharacterStudio (library grid) and the
 * Character picker that surfaces inside CampaignGallery's Brand
 * Spokesperson section.
 *
 * Renders portrait → name → template → voice → status pill, plus a
 * compact action row for Generate Portrait / Create Avatar / Attach
 * /  Delete depending on the character's current state. The
 * component is presentation-only — all mutations bubble up via
 * callbacks.
 */
export default function CharacterCard({
  character,
  onGeneratePortrait,
  onCreateAvatar,
  onAttach,
  onDelete,
  busyAction,
  attachedHere = false,
  compact = false,
}) {
  const c = character
  const portraitUrl = c.portrait_url
  const avatarStatus = c.runway_avatar_status
  const avatarReady = ['ready', 'mock'].includes(avatarStatus || '')
  const avatarMock = avatarStatus === 'mock'
  const avatarFailed = avatarStatus === 'failed'
  const hasPortrait = Boolean(portraitUrl)

  return (
    <div
      className={`rounded-lg p-2 space-y-1.5 transition-all duration-150 ${
        attachedHere
          ? 'ring-2 ring-pink-400 bg-pink-500/10 shadow-[0_0_0_1px_rgba(236,72,153,0.15)]'
          : 'ring-1 ring-zinc-800 bg-zinc-950/50 hover:ring-pink-400/40 hover:bg-pink-500/5'
      } ${compact ? 'text-[10px]' : 'text-xs'}`}
    >
      {/* Portrait */}
      <div className="aspect-square w-full rounded bg-zinc-900 overflow-hidden">
        {hasPortrait ? (
          <img
            src={portraitUrl}
            alt={c.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-zinc-600 text-[10px] italic">
            no portrait yet
          </div>
        )}
      </div>

      {/* Name + template */}
      <div className="min-w-0">
        <div className="text-zinc-100 truncate font-medium" title={c.name}>
          {c.name}
        </div>
        <div className="text-zinc-500 font-mono text-[9px]">
          {c.template} · {c.voice_preset}
        </div>
      </div>

      {/* Avatar status pill */}
      <div className="flex items-center gap-1 flex-wrap">
        {avatarReady && (
          <span
            className={`text-[9px] rounded-full px-1.5 py-0.5 font-mono ${
              avatarMock
                ? 'bg-amber-500/20 text-amber-300'
                : 'bg-emerald-500/20 text-emerald-300'
            }`}
          >
            avatar {avatarMock ? 'mock' : 'ready'}
          </span>
        )}
        {avatarFailed && (
          <span className="text-[9px] rounded-full bg-rose-500/20 text-rose-300 px-1.5 py-0.5 font-mono">
            avatar failed
          </span>
        )}
        {!avatarStatus && hasPortrait && (
          <span className="text-[9px] rounded-full bg-zinc-700/50 text-zinc-300 px-1.5 py-0.5 font-mono">
            avatar pending
          </span>
        )}
        {attachedHere && (
          <span className="text-[9px] rounded-full bg-pink-500/20 text-pink-300 px-1.5 py-0.5 font-mono">
            attached
          </span>
        )}
      </div>

      {/* Action row — context-aware */}
      <div className="flex items-center gap-1 flex-wrap pt-0.5">
        {!hasPortrait && onGeneratePortrait && (
          <button
            type="button"
            onClick={() => onGeneratePortrait(c)}
            disabled={busyAction === 'portrait' || Boolean(busyAction)}
            className="rounded bg-pink-500/80 hover:bg-pink-500 text-zinc-100 text-[10px] px-2 py-1 disabled:opacity-50"
          >
            {busyAction === 'portrait' ? 'Generating…' : 'Generate Portrait'}
          </button>
        )}
        {hasPortrait && !avatarReady && onCreateAvatar && (
          <button
            type="button"
            onClick={() => onCreateAvatar(c)}
            disabled={busyAction === 'avatar' || Boolean(busyAction)}
            className="rounded bg-pink-500/80 hover:bg-pink-500 text-zinc-100 text-[10px] px-2 py-1 disabled:opacity-50"
          >
            {busyAction === 'avatar' ? 'Creating Avatar…' : avatarFailed ? 'Retry Avatar' : 'Create Runway Avatar'}
          </button>
        )}
        {avatarReady && onAttach && !attachedHere && (
          <button
            type="button"
            onClick={() => onAttach(c)}
            disabled={busyAction === 'attach' || Boolean(busyAction)}
            className="rounded bg-pink-500/80 hover:bg-pink-500 text-zinc-100 text-[10px] px-2 py-1 disabled:opacity-50"
          >
            {busyAction === 'attach' ? 'Attaching…' : 'Use Character'}
          </button>
        )}
        {avatarReady && attachedHere && onAttach && (
          <button
            type="button"
            onClick={() => onAttach(null)}
            disabled={busyAction === 'attach' || Boolean(busyAction)}
            className="rounded border border-pink-400/50 text-pink-300 hover:bg-pink-500/10 text-[10px] px-2 py-1 disabled:opacity-50"
          >
            Detach
          </button>
        )}
        {onDelete && !compact && (
          <button
            type="button"
            onClick={() => onDelete(c)}
            disabled={Boolean(busyAction)}
            className="ml-auto text-[9px] text-zinc-500 hover:text-rose-300 disabled:opacity-50"
            title="Local delete only — does not remove the avatar from Runway"
          >
            delete
          </button>
        )}
      </div>
    </div>
  )
}
