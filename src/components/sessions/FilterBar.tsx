import { useState } from "react";
import type { SearchFilters, SearchFacets } from "../../types";

interface FilterBarProps {
  facets: SearchFacets;
  filters: SearchFilters;
  onChange: (filters: SearchFilters) => void;
}

function FilterBar({ facets, filters, onChange }: FilterBarProps) {
  const [expanded, setExpanded] = useState(false);

  const update = (patch: Partial<SearchFilters>) => {
    onChange({ ...filters, ...patch });
  };

  return (
    <div className="sessions-filter-bar">
      <button
        className="sessions-filter-toggle"
        onClick={() => setExpanded(!expanded)}
      >
        Filters {expanded ? "-" : "+"}
      </button>
      {expanded && (
        <div className="sessions-filter-controls">
          <select
            className="sessions-filter-select"
            value={filters.project ?? ""}
            onChange={(e) =>
              update({ project: e.target.value || undefined })
            }
          >
            <option value="">All projects</option>
            {facets.projects.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name} ({p.count})
              </option>
            ))}
          </select>
          <select
            className="sessions-filter-select"
            value={filters.host ?? ""}
            onChange={(e) =>
              update({ host: e.target.value || undefined })
            }
          >
            <option value="">All hosts</option>
            {facets.hosts.map((h) => (
              <option key={h.name} value={h.name}>
                {h.name} ({h.count})
              </option>
            ))}
          </select>
          <select
            className="sessions-filter-select"
            value={filters.role ?? ""}
            onChange={(e) => {
              const val = e.target.value;
              update({
                role:
                  val === "user" || val === "assistant" ? val : undefined,
              });
            }}
          >
            <option value="">All roles</option>
            <option value="user">User</option>
            <option value="assistant">Assistant</option>
          </select>
          <input
            className="sessions-filter-date"
            type="date"
            value={filters.date_from ?? ""}
            onChange={(e) =>
              update({ date_from: e.target.value || undefined })
            }
            placeholder="From"
          />
          <input
            className="sessions-filter-date"
            type="date"
            value={filters.date_to ?? ""}
            onChange={(e) =>
              update({ date_to: e.target.value || undefined })
            }
            placeholder="To"
          />
        </div>
      )}
    </div>
  );
}

export default FilterBar;
