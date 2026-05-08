export default function ConceptCards({ concepts, recommendedIndex, selectedIndex, onSelect }) {
  if (!concepts?.length) return null
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {concepts.map((c, i) => {
        const isSelected = i === selectedIndex
        const isRecommended = i === recommendedIndex
        return (
          <button
            key={i}
            type="button"
            onClick={() => onSelect(i)}
            className={`text-left rounded-2xl border p-5 bg-zinc-900/60 transition
              ${isSelected ? 'border-spark ring-2 ring-spark/40' : 'border-zinc-800 hover:border-zinc-600'}`}
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-zinc-100">{c.title}</h3>
              {isRecommended && (
                <span className="text-xs rounded-full bg-spark/20 text-spark px-2 py-0.5">
                  recommended
                </span>
              )}
            </div>
            <p className="text-sm text-zinc-300 italic mb-2">"{c.hook}"</p>
            <p className="text-sm text-zinc-400 mb-3">{c.visual}</p>
            <div className="text-xs text-zinc-500 space-y-1">
              <div><span className="text-zinc-400">Caption:</span> {c.caption}</div>
              <div><span className="text-zinc-400">CTA:</span> {c.cta}</div>
            </div>
          </button>
        )
      })}
    </div>
  )
}
