import HalftoneField from "../fx/HalftoneField";

// Fixed layers behind every page: aurora glows, the live dot-matrix field, scanlines, vignette.
export default function Backdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 50% at 8% 0%, rgb(247 143 196 / 0.13), transparent 70%)," +
            "radial-gradient(45% 45% at 100% 30%, rgb(143 122 230 / 0.10), transparent 70%)," +
            "radial-gradient(60% 45% at 60% 110%, rgb(195 166 255 / 0.08), transparent 70%)",
        }}
      />
      <HalftoneField />
      <div className="absolute inset-0 scanlines opacity-50" />
      <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_40%,transparent_55%,rgb(10_4_8/0.85))]" />
    </div>
  );
}
