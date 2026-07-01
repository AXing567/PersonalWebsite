type SectionHeaderProps = {
  eyebrow: string;
  title: string;
  summary?: string;
};

export default function SectionHeader({ eyebrow, title, summary }: SectionHeaderProps) {
  return (
    <div className="section-header">
      <span>{eyebrow}</span>
      <h2>{title}</h2>
      {summary ? <p>{summary}</p> : null}
    </div>
  );
}
