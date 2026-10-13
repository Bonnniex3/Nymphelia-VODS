import PFP from "../assets/pfp.png";

// Boot screen shown while a route chunk loads.
export default function Loading({ label = "loading" }) {
  return (
    <div className="grid flex-1 place-items-center py-24" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-5">
        <div className="relative size-20 animate-float">
          <div className="absolute -inset-1.5 rounded-full holo-bg opacity-80 blur-[2px]" />
          <img src={PFP} alt="" className="relative size-20 rounded-full border-2 border-void" />
        </div>
        <div className="w-44">
          <div className="mb-2 flex justify-between font-dot text-xs text-blush/80">
            <span>{label}</span>
            <span className="animate-blink">▮</span>
          </div>
          <div className="relative h-2.5 overflow-hidden rounded-full border border-line-strong bg-ink p-[2px]">
            <div className="h-full w-2/5 animate-boot rounded-full holo-bg" />
          </div>
        </div>
      </div>
    </div>
  );
}
