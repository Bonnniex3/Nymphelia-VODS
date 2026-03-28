import Thumbnail from "../assets/default_thumbnail.png";
import Chapters from "./ChaptersMenu";
import WatchMenu from "./WatchMenu";
import CustomWidthTooltip from "../utils/CustomToolTip";
import { useState } from "react";
import dayjs from "dayjs";
import localizedFormat from "dayjs/plugin/localizedFormat.js";
import { Play } from "lucide-react";

dayjs.extend(localizedFormat);

export default function Vod(props) {
  const { vod, isCdnAvailable } = props;
  const [anchorEl, setAnchorEl] = useState(null);
  const DEFAULT_THUMBNAIL = vod.thumbnail_url ? vod.thumbnail_url : Thumbnail;

  return (
    <div className="w-full h-full group">
      <div className="h-full flex flex-col rounded-2xl overflow-hidden bg-[#23151a]/80 backdrop-blur-md border border-pink-500/20 transition-all duration-300 ease-out hover:-translate-y-2 hover:shadow-[0_12px_30px_rgba(244,114,182,0.3)] hover:border-primary/50 relative transform-gpu">
        <div className="overflow-hidden relative aspect-video bg-black cursor-pointer" onClick={(e) => setAnchorEl(e.currentTarget)}>
          <img
            loading="lazy"
            decoding="async"
            className="absolute top-0 left-0 w-full h-full object-cover transition-transform duration-500 ease-out group-hover:scale-110 opacity-90 group-hover:opacity-100 transform-gpu"
            alt=""
            src={DEFAULT_THUMBNAIL}
          />
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-500 ease-out flex items-center justify-center">
            <div className="bg-primary/90 rounded-full p-4 transform scale-50 group-hover:scale-100 transition-all duration-500 ease-out shadow-[0_0_20px_rgba(168,85,247,0.6)]">
              <Play className="w-8 h-8 text-white ml-1" fill="currentColor" />
            </div>
          </div>
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent transition-opacity duration-500 ease-out">
            <div className="absolute bottom-2 left-2 flex gap-1">
              <span className="px-2.5 py-1 rounded-md bg-black/60 backdrop-blur-sm border border-pink-500/20 text-gray-200 text-xs font-medium shadow-sm">
                {dayjs(vod.createdAt).format("MMM D, YYYY")}
              </span>
            </div>
            <div className="absolute bottom-2 right-2">
              <span className="px-2.5 py-1 rounded-md bg-black/60 backdrop-blur-sm border border-pink-500/20 text-gray-200 text-xs font-medium shadow-sm">
                {vod.duration}
              </span>
            </div>
          </div>
        </div>
        <div className="p-4 flex flex-col flex-grow bg-gradient-to-b from-[#23151a]/50 to-[#130b0e]/50 relative z-10 -mt-[1px]">
          <div className="flex items-start mb-3">
            {vod.chapters && vod.chapters.length > 0 && (
              <div className="mr-2 mt-0.5 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                <Chapters vod={vod} isCdnAvailable={isCdnAvailable} />
              </div>
            )}
            <CustomWidthTooltip title={vod.title} placement="top">
              <span
                onClick={(e) => setAnchorEl(e.currentTarget)}
                className="cursor-pointer font-bold text-base leading-snug line-clamp-2 text-gray-100 group-hover:text-primary transition-colors duration-200"
              >
                {vod.title}
              </span>
            </CustomWidthTooltip>
          </div>
          <div className="mt-auto" onClick={(e) => e.stopPropagation()}>
            <WatchMenu vod={vod} anchorEl={anchorEl} setAnchorEl={setAnchorEl} isCdnAvailable={isCdnAvailable} />
          </div>
        </div>
      </div>
    </div>
  );
}
