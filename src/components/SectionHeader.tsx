interface SectionHeaderProps {
  label: string;
  listeners?: Record<string, unknown>;
  attributes?: Record<string, unknown>;
}

function SectionHeader({ label, listeners, attributes }: SectionHeaderProps) {
  return (
    <div className="section-header">
      <span className="section-header-grip" {...listeners} {...attributes}>
        &#10303;
      </span>
      <span className="section-header-label">{label}</span>
    </div>
  );
}

export default SectionHeader;
