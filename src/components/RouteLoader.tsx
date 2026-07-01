type RouteLoaderProps = {
  isActive: boolean;
  label: string;
};

export default function RouteLoader({ isActive, label }: RouteLoaderProps) {
  return (
    <div className={`route-loader${isActive ? " route-loader-active" : ""}`} aria-hidden={!isActive}>
      <div className="route-loader-mark">
        <span>YOU</span>
      </div>
      <div className="route-loader-copy">
        <strong>{label}</strong>
        <span>Loading interface</span>
      </div>
    </div>
  );
}
