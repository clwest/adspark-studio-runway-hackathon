import { useEffect, useState } from 'react'
import { api } from '../api'
import { friendlyError } from '../errors'

/**
 * Pick an existing Runway avatar (or in mock mode, a fake preset) for
 * a saved campaign.  Selecting one populates the campaign's
 * ``selected_avatar_id`` field so downstream features (Avatar Host
 * Clip + Talk to Brand Spokesperson) prefer the selection over any
 * per-campaign custom avatar.
 *
 * Designed to coexist with the existing "Create Custom Brand
 * Spokesperson" flow — the picker is shown above the create button.
 * If the picker has no usable avatars (real mode + empty list +
 * non-mock), the section quietly hides and the create flow stays the
 * primary path.
 */
export default function AvatarPicker({ campaign, onUpdated }) {
  const [phase, setPhase] = useState('loading') // 'loading' | 'idle' | 'selecting' | 'failed' | 'empty'
  const [avatars, setAvatars] = useState([])
  const [mockMode, setMockMode] = useState(false)
  const [errMsg, setErrMsg] = useState('')

  useEffect(() => {
    let cancelled = false
    api
      .listAvatars()
      .then((resp) => {
        if (cancelled) return
        const data = resp?.data || []
        setAvatars(data)
        setMockMode(Boolean(resp?.mock_mode))
        setPhase(data.length === 0 ? 'empty' : 'idle')
      })
      .catch((e) => {
        if (cancelled) return
        setErrMsg(friendlyError(e, 'Couldn’t load avatars'))
        setPhase('failed')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const selectedId = campaign.selected_avatar_id || ''

  const handleSelect = async (avatar) => {
    setErrMsg('')
    setPhase('selecting')
    try {
      const updated = await api.selectAvatar(campaign.id, {
        avatar_id: avatar.id,
        avatar_name: avatar.name,
        avatar_source: avatar.source,
        thumbnail_url: avatar.thumbnail_url,
      })
      onUpdated?.(updated)
      setPhase('idle')
    } catch (e) {
      setErrMsg(friendlyError(e, `Couldn’t select ${avatar.name}`))
      setPhase('idle')
    }
  }

  const handleClear = async () => {
    setErrMsg('')
    setPhase('selecting')
    try {
      const updated = await api.selectAvatar(campaign.id, { avatar_id: null })
      onUpdated?.(updated)
      setPhase('idle')
    } catch (e) {
      setErrMsg(friendlyError(e, 'Couldn’t clear selection'))
      setPhase('idle')
    }
  }

  // Real-mode + empty list = nothing to pick. Hide the section so
  // the Create Custom Brand Spokesperson flow stays the only path.
  if (phase === 'empty' && !mockMode) {
    return null
  }
  if (phase === 'loading') {
    return (
      <div className="text-[11px] text-zinc-500 italic">
        Loading Runway avatars…
      </div>
    )
  }
  if (phase === 'failed') {
    return (
      <p className="text-[10px] text-rose-300" title={errMsg}>
        {errMsg}
      </p>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-zinc-300">
          Choose Existing Runway Avatar
        </span>
        {mockMode && (
          <span
            className="text-[10px] rounded-full bg-amber-500/20 text-amber-300 px-2 py-0.5 font-mono"
            title="Mock preset list — real mode lists your created avatars"
          >
            mock presets
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {avatars.map((a) => {
          const isSelected = a.id === selectedId
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => handleSelect(a)}
              disabled={phase === 'selecting'}
              className={`text-left rounded-md border p-1.5 space-y-1 transition disabled:opacity-50 ${
                isSelected
                  ? 'border-sky-400 bg-sky-500/10'
                  : 'border-zinc-800 hover:border-zinc-600 bg-zinc-950/40'
              }`}
              title={`${a.name} · ${a.source} · ${a.status.toLowerCase()}`}
            >
              {a.thumbnail_url ? (
                <img
                  src={a.thumbnail_url}
                  alt={a.name}
                  className="w-full aspect-square object-cover rounded bg-zinc-950"
                />
              ) : (
                <div className="w-full aspect-square rounded bg-zinc-800" />
              )}
              <div className="text-[10px] text-zinc-200 truncate">
                {a.name}
              </div>
              <div className="text-[9px] text-zinc-500 font-mono">
                {a.source === 'preset' ? 'Preset' : 'Custom'}
                {a.voice_preset_name ? ` · ${a.voice_preset_name}` : ''}
              </div>
            </button>
          )
        })}
      </div>
      {selectedId && (
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-sky-300">
            Selected Runway Avatar: {campaign.selected_avatar_name || selectedId.slice(0, 12) + '…'}
          </span>
          <button
            type="button"
            onClick={handleClear}
            disabled={phase === 'selecting'}
            className="text-zinc-500 hover:text-zinc-300 disabled:opacity-50"
            title="Clear the selection and revert to per-campaign custom avatar"
          >
            clear
          </button>
        </div>
      )}
      {errMsg && <p className="text-[10px] text-rose-300">{errMsg}</p>}
    </div>
  )
}
