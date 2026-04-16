import Thumbnail from "../assets/default_thumbnail.png";
import Chapters from "./ChaptersMenu";
import CustomWidthTooltip from "../utils/CustomToolTip";
import dayjs from "dayjs";
import localizedFormat from "dayjs/plugin/localizedFormat.js";
import { Play } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { makeSlug } from "../utils/helpers";

dayjs.extend(localizedFormat);

export default function Vod(props) {
  const { vod, isCdnAvailable } = props;
  const navigate = useNavigate();
  const DEFAULT_THUMBNAIL = vod.thumbnail_url ? vod.thumbnail_url : Thumbnail;

  const vodPath = `/vod/${makeSlug(vod)}`;

  const goToVod = (e) => {
    if (!isCdnAvailable) return;
    // Ignore clicks from chapters menu or its descendants
    if (e.target.closest("[data-no-nav]")) return;
    e.preventDefault();
    navigate(vodPath);
  };

  return (
    <div
      role="link"
      tabIndex={isCdnAvailable ? 0 : -1}
      onClick={goToVod}
      onKeyDown={(e) => { if (e.key === "Enter") goToVod(e); }}
      className="group relative block w-full h-full cursor-pointer rounded-2xl overflow-hidden bg-[#23151a]/80 backdrop-blur-md border border-pink-500/20 transition-all duration-300 ease-out hover:-translate-y-2 hover:shadow-[0_12px_30px_rgba(244,114,182,0.3)] hover:border-primary/50 transform-gpu"
    >
      {/* Thumbnail */}
      <div className="relative aspect-video overflow-hidden">
        <img
          loading="lazy"
          decoding="async"
          src={DEFAULT_THUMBNAIL}
          alt=""
          className="absolute inset-0 w-full h-full object-cover transition-[transform,filter] duration-500 ease-out group-hover:scale-110 group-hover:brightness-[0.55] transform-gpu"
        />

        {/* Play button (no background overlay — image itself darkens via brightness filter) */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-500 ease-out">
          <div className="bg-primary/90 rounded-full p-4 transform scale-75 group-hover:scale-100 transition-transform duration-500 ease-out shadow-[0_0_20px_rgba(168,85,247,0.6)]">
            <Play className="w-8 h-8 text-white ml-1" fill="currentColor" />
          </div>
        </div>

        {/* Date + duration badges */}
        <div className="pointer-events-none absolute bottom-2 left-2 right-2 flex items-center justify-between gap-2">
          <span className="px-2.5 py-1 rounded-md bg-black/70 backdrop-blur-sm border border-white/10 text-gray-200 text-xs font-medium shadow-sm">
            {dayjs(vod.createdAt).format("MMM D, YYYY")}
          </span>
          <span className="px-2.5 py-1 rounded-md bg-black/70 backdrop-blur-sm border border-white/10 text-gray-200 text-xs font-medium shadow-sm">
            {vod.duration}
          </span>
        </div>
      </div>

      {/* Info */}
      <div className="p-4 flex items-start gap-2">
        {vod.chapters && vod.chapters.length > 0 && (
          <div
            data-no-nav
            className="flex-shrink-0 mt-0.5"
            onClick={(e) => e.stopPropagation()}
          >
            <Chapters vod={vod} isCdnAvailable={isCdnAvailable} />
          </div>
        )}
        <CustomWidthTooltip title={vod.title} placement="top">
          <Link
            to={vodPath}
            onClick={(e) => { if (!isCdnAvailable) e.preventDefault(); e.stopPropagation(); }}
            className="font-bold text-base leading-snug line-clamp-2 text-gray-100 group-hover:text-primary transition-colors duration-200"
          >
            {vod.title}
          </Link>
        </CustomWidthTooltip>
      </div>
    </div>
  );
}
