import { useEntity } from '../App'

/**
 * Entity switcher. Staff locked to one entity never see it.
 * Anyone with more than one gets each entity plus a mixed view.
 */
export default function EntityBar() {
  const { entities, entityId, setEntityId } = useEntity()

  if (entities.length <= 1) {
    return entities.length === 1 ? (
      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate2">
        {entities[0].name}
      </div>
    ) : null
  }

  const opts = [{ id: 'mixed', label: 'Mixed' },
                ...entities.map(e => ({ id: e.id, label: e.code }))]

  return (
    <div className="flex gap-1 overflow-x-auto pb-1">
      {opts.map(o => (
        <button key={o.id} onClick={() => setEntityId(o.id)}
          title={o.id === 'mixed' ? 'All entities together' : entities.find(e => e.id === o.id)?.name}
          className={'whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-semibold ' +
            (entityId === o.id ? 'bg-ink text-white' : 'border border-line bg-white text-slate2')}>
          {o.label}
        </button>
      ))}
    </div>
  )
}
