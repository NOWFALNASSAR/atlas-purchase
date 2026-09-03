import { useEntity } from '../App'

/**
 * Entity switcher. Staff locked to one entity never see it.
 * Anyone with more than one gets each entity plus a mixed view.
 */
export default function EntityBar() {
  const { entities, entityId, setEntityId } = useEntity()

  if (entities.length <= 1) {
    return entities.length === 1 ? (
      <div className="text-xs font-medium text-slate2">{entities[0].name}</div>
    ) : null
  }

  const opts = [{ id: 'mixed', label: 'All' },
                ...entities.map(e => ({ id: e.id, label: e.code }))]

  return (
    <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
      <div className="inline-flex rounded-md border border-line bg-white p-0.5 shadow-card">
        {opts.map(o => (
          <button key={o.id} onClick={() => setEntityId(o.id)}
            title={o.id === 'mixed' ? 'All entities together' : entities.find(e => e.id === o.id)?.name}
            className={'whitespace-nowrap rounded px-3 py-1.5 text-sm font-semibold transition ' +
              (entityId === o.id
                ? 'bg-ink text-white'
                : 'text-slate2 hover:bg-paper hover:text-ink')}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}
