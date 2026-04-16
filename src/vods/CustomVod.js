import { useEffect, useState, useRef } from "react";
import { Box, Typography, Tooltip, useMediaQuery, IconButton, Collapse, Paper } from "@mui/material";
import Loading from "../utils/Loading";
import { Link as RouterLink, useLocation, useParams } from "react-router-dom";
import DownloadIcon from "@mui/icons-material/Download";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import CustomPlayer from "./CustomPlayer";
import Chapters from "./VodChapters";
import ExpandMore from "../utils/CustomExpandMore";
import CustomWidthTooltip from "../utils/CustomToolTip";
import { toHMS, convertTimestamp, makeSlug } from "../utils/helpers";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import MOCK_VODS from "./data/vods.json";

export default function Vod(props) {
  const location = useLocation();
  const isPortrait = useMediaQuery("(orientation: portrait)");
  const { slug } = useParams();
  const { type } = props;
  const [vod, setVod] = useState(undefined);
  const [notFound, setNotFound] = useState(false);
  const [drive, setDrive] = useState(undefined);
  const [chapter, setChapter] = useState(undefined);
  const [showMenu, setShowMenu] = useState(true);
  const [currentTime, setCurrentTime] = useState(undefined);
  const [, setPlaying] = useState({ playing: false });
  const search = new URLSearchParams(location.search);
  const [timestamp, setTimestamp] = useState(search.get("t") !== null ? convertTimestamp(search.get("t")) : 0);
  const [delay, setDelay] = useState(0);
  const [userChatDelay] = useState(0);
  const playerRef = useRef(null);

  useEffect(() => {
    const foundVod = MOCK_VODS.find((v) => makeSlug(v) === slug);
    if (foundVod) {
      setVod(foundVod);
      setNotFound(false);
      document.title = `${foundVod.title} - VOD`;
    } else {
      setNotFound(true);
    }
  }, [slug]);

  useEffect(() => {
    if (!vod) return;
    setDrive(vod.drive ? vod.drive.filter((data) => data.type === "live") : []);
    setChapter(vod.chapters ? vod.chapters[0] : null);
    return;
  }, [vod, type, location.search]);

  useEffect(() => {
    if (!playerRef.current || !vod || !vod.chapters) return;
    for (let chapter of vod.chapters) {
      if (currentTime > chapter.start && currentTime < chapter.start + chapter.end) {
        setChapter(chapter);
        break;
      }
    }
    return;
  }, [currentTime, vod, playerRef]);

  const handleExpandClick = () => {
    setShowMenu(!showMenu);
  };

  useEffect(() => {
    if (delay === undefined) return;
    console.info(`Chat Delay: ${userChatDelay + delay} seconds`);
    return;
  }, [userChatDelay, delay]);

  useEffect(() => {
    if (!playerRef.current) return;
    if (timestamp >= 0) {
      //need to pause/play to reset chat position.
      playerRef.current.pause();
      playerRef.current.currentTime(timestamp);
      playerRef.current.play();
    }
  }, [timestamp, playerRef]);

  const copyTimestamp = () => {
    navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}?t=${toHMS(currentTime)}`);
  };

  if (notFound) {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 2, p: 4, textAlign: "center" }}>
        <Typography variant="h5" sx={{ color: "#fce7f3" }}>VOD not found</Typography>
        <Typography variant="body2" sx={{ color: "#9ca3af" }}>This link may be broken or the VOD has been removed.</Typography>
        <RouterLink to="/" style={{ color: "#ec4899", fontWeight: 600, textDecoration: "underline" }}>Back to VODs</RouterLink>
      </Box>
    );
  }

  if (vod === undefined || drive === undefined) return <Loading />;

  return (
    <Box sx={{ height: "100%", width: "100%" }}>
      <Box sx={{ display: "flex", flexDirection: isPortrait ? "column" : "row", height: "100%", width: "100%" }}>
        <Box sx={{ display: "flex", height: "100%", width: "100%", flexDirection: "column", alignItems: "flex-start", minWidth: 0, overflow: "hidden", position: "relative" }}>
          <Tooltip title="Back to VODs">
            <IconButton
              component={RouterLink}
              to="/"
              aria-label="Back to VODs"
              className="back-to-vods-btn"
              sx={{
                position: "absolute",
                top: 12,
                left: 12,
                zIndex: 10,
                bgcolor: "rgba(19,11,14,0.72)",
                color: "#fce7f3",
                border: "1px solid rgba(236,72,153,0.35)",
                backdropFilter: "blur(6px)",
                transition: "background-color 0.2s ease, border-color 0.2s ease, transform 0.2s ease",
                "&:hover": {
                  bgcolor: "rgba(236,72,153,0.25)",
                  borderColor: "#ec4899",
                  transform: "translateX(-2px)",
                },
              }}
            >
              <ArrowBackIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <CustomPlayer playerRef={playerRef} setCurrentTime={setCurrentTime} setPlaying={setPlaying} delay={delay} setDelay={setDelay} type={type} vod={vod} timestamp={timestamp} />
          <Box sx={{ position: "absolute", bottom: 0, left: "50%" }}>
            <Tooltip title={showMenu ? "Collapse" : "Expand"}>
              <ExpandMore expand={showMenu} onClick={handleExpandClick} aria-expanded={showMenu} aria-label="show menu">
                <ExpandMoreIcon />
              </ExpandMore>
            </Tooltip>
          </Box>
          <Collapse in={showMenu} timeout="auto" unmountOnExit sx={{ minHeight: "auto !important", width: "100%" }}>
            <Paper elevation={3} sx={{ display: "flex", p: 1, alignItems: "center", borderRadius: "0 0 12px 12px", borderTop: "none" }}>
              {chapter && <Chapters chapters={vod.chapters} chapter={chapter} setChapter={setChapter} setTimestamp={setTimestamp} />}
              <CustomWidthTooltip title={vod.title}>
                <Typography fontWeight={550} variant="body1" noWrap={true}>{`${vod.title}`}</Typography>
              </CustomWidthTooltip>
              <Box sx={{ marginLeft: "auto", display: "flex", alignItems: "center" }}>
                <Box sx={{ ml: 0.5 }}>
                  {drive && drive[0] && (
                    <Tooltip title={`Download Vod`}>
                      <IconButton href={`https://drive.google.com/u/2/open?id=${drive[0].id}`} color="secondary" aria-label="Download Vod" rel="noopener noreferrer" target="_blank">
                        <DownloadIcon />
                      </IconButton>
                    </Tooltip>
                  )}
                </Box>
                <Box sx={{ ml: 0.5 }}>
                  <Tooltip title={`Copy Current Timestamp`}>
                    <IconButton onClick={copyTimestamp} color="primary" aria-label="Copy Current Timestamp" rel="noopener noreferrer" target="_blank">
                      <ContentCopyIcon />
                    </IconButton>
                  </Tooltip>
                </Box>
              </Box>
            </Paper>
          </Collapse>
        </Box>
      </Box>
    </Box>
  );
}
