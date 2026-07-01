type ProgressBarProps = {
  value: number;
  label: string;
};

export default function ProgressBar({ value, label }: ProgressBarProps) {
  return (
    <div className="progress">
      <div className="progress-top">
        <span>{label}</span>
        <strong>{value}%</strong>
      </div>
      <div className="progress-track" aria-hidden="true">
        <div style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}
