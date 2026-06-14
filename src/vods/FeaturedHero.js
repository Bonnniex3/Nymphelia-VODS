import dayjs from "dayjs";
import { Play, ChevronDown } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { makeSlug } from "../utils/helpers";
import Thumbnail from "../assets/default_thumbnail.png";

export default function FeaturedHero({ vod, onScrollDown }) {
  const navigate = useNavigate();
  const poster = vod.thumbnail_url || Thumbnail;
  const vodPath = `/vod/${makeSlug(vod)}`;

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      role="link"
      tabIndex={0}
      onClick={() => navigate(vodPath)}
      onKeyDown={(e) => { if (e.key === "Enter") navigate(vodPath); }}
      className="group relative mx-2 md:mx-10 mt-4 mb-2 cursor-pointer rounded-3xl overflow-hidden border border-pink-500/20 shadow-[0_12px_40px_rgba(244,114,182,0.25)] aspect-[16/10] md:aspect-[21/7]"
    >
      <img
        src={poster}
        alt=""
        className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-105 transform-gpu"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-[#130b0e] via-[#130b0e]/60 to-transparent" />

      <span className="absolute top-4 left-4 px-3 py-1 rounded-full bg-primary/90 text-white text-xs font-bold tracking-wide shadow-[0_0_18px_rgba(168,85,247,0.7)]">
        ★ FEATURED
      </span>

      <div className="absolute bottom-0 left-0 right-0 p-6 md:p-10 flex flex-col gap-3">
        <h2 className="text-2xl md:text-4xl font-black text-white drop-shadow line-clamp-2">
          {vod.title}
        </h2>
        <div className="flex items-center gap-3 text-sm text-gray-300">
          <span>{dayjs(vod.createdAt).format("MMM D, YYYY")}</span>
          <span>•</span>
          <span>{vod.duration}</span>
        </div>
        <div>
          <span className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-primary text-white font-bold shadow-[0_0_24px_rgba(168,85,247,0.6)] group-hover:bg-pink-500 transition-colors">
            <Play className="w-5 h-5" fill="currentColor" /> Watch now
          </span>
        </div>
      </div>

      {onScrollDown && (
        <div className="absolute bottom-3 right-4 md:left-1/2 md:right-auto md:-translate-x-1/2 z-20">
          <motion.button
            type="button"
            onClick={(e) => { e.stopPropagation(); onScrollDown(); }}
            onKeyDown={(e) => e.stopPropagation()}
            aria-label="Scroll to VODs"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, y: [0, 8, 0] }}
            transition={{ y: { repeat: Infinity, duration: 1.6, ease: "easeInOut" }, opacity: { duration: 0.6 } }}
            className="flex flex-col items-center gap-1 text-white/90 hover:text-white"
          >
            <span className="hidden md:block text-xs font-semibold tracking-wide drop-shadow">Browse VODs</span>
            <span className="flex items-center justify-center w-9 h-9 rounded-full bg-black/40 border border-white/20 backdrop-blur-sm shadow-[0_0_18px_rgba(168,85,247,0.5)]">
              <ChevronDown className="w-5 h-5" />
            </span>
          </motion.button>
        </div>
      )}
    </motion.section>
  );
}
