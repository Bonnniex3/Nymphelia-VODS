// Placeholder archive, used while the real vods.json is empty and by
// `npm run dev:mock` (see vite.config.mjs). Every sample VOD plays the bundled
// 30s test clip. Once real VODs exist, builds stop importing this file.
import SAMPLE_VODS from "./vods.mock.json";
import SAMPLE_CLIP from "./sample.mp4";

export default SAMPLE_VODS.map((vod) => ({ ...vod, video_url: SAMPLE_CLIP }));
