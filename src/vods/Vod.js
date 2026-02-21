import { Box, Typography, Grid, Paper } from "@mui/material";
import Thumbnail from "../assets/default_thumbnail.png";
import Chapters from "./ChaptersMenu";
import WatchMenu from "./WatchMenu";
import CustomWidthTooltip from "../utils/CustomToolTip";
import { useState } from "react";
import dayjs from "dayjs";
import localizedFormat from "dayjs/plugin/localizedFormat.js";
import { alpha } from "@mui/material/styles";

dayjs.extend(localizedFormat);

export default function Vod(props) {
  const { vod, gridSize, isCdnAvailable } = props;
  const [anchorEl, setAnchorEl] = useState(null);
  const DEFAULT_THUMBNAIL = vod.youtube.length > 0 ? vod.youtube[0].thumbnail_url : vod.games.length > 0 ? vod.games[0].thumbnail_url : vod.thumbnail_url ? vod.thumbnail_url : Thumbnail;

  return (
    <Grid size={{ xs: gridSize }} sx={{ maxWidth: "20rem", flexBasis: "20rem", p: 1 }}>
      <Paper
        elevation={3}
        sx={{
          height: "100%",
          display: "flex",
          flexDirection: "column",
          borderRadius: "16px",
          overflow: "hidden",
          transition: "transform 0.2s ease-in-out, box-shadow 0.2s ease-in-out",
          backgroundColor: (theme) => alpha(theme.palette.background.paper, 0.6),
          backdropFilter: "blur(10px)",
          border: "1px solid rgba(255, 255, 255, 0.1)",
          "&:hover": {
            transform: "translateY(-4px)",
            boxShadow: "0 8px 24px rgba(233, 193, 227, 0.25)",
            "& .thumbnail": {
              transform: "scale(1.05)",
            },
          },
        }}
      >
        <Box
          sx={{
            overflow: "hidden",
            height: 0,
            paddingTop: "56.25%",
            position: "relative",
          }}
        >
          <img
            style={{
              cursor: "pointer",
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              transition: "transform 0.3s ease",
            }}
            onClick={(e) => setAnchorEl(e.currentTarget)}
            className="thumbnail"
            alt=""
            src={DEFAULT_THUMBNAIL}
          />
          <Box sx={{ pointerEvents: "none", position: "absolute", top: 0, left: 0, width: "100%", height: "100%", background: "linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0) 40%)" }}>
            <Box sx={{ position: "absolute", bottom: 8, left: 8, display: "flex", gap: 0.5 }}>
              <Typography variant="caption" sx={{ px: 0.8, py: 0.2, borderRadius: "4px", backgroundColor: "rgba(0,0,0,0.7)", color: "#fff", fontWeight: "bold" }}>
                {`${dayjs(vod.createdAt).format("MMM D, YYYY")}`}
              </Typography>
            </Box>
            <Box sx={{ position: "absolute", bottom: 8, right: 8 }}>
              <Typography variant="caption" sx={{ px: 0.8, py: 0.2, borderRadius: "4px", backgroundColor: "rgba(0,0,0,0.7)", color: "#fff", fontWeight: "bold" }}>
                {`${vod.duration}`}
              </Typography>
            </Box>
          </Box>
        </Box>
        <Box sx={{ p: 1.5, display: "flex", flexDirection: "column", flexGrow: 1 }}>
          <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
            {vod.chapters && vod.chapters.length > 0 && <Chapters vod={vod} isCdnAvailable={isCdnAvailable} />}
            <CustomWidthTooltip title={vod.title} placement="top">
              <Typography
                onClick={(e) => setAnchorEl(e.currentTarget)}
                sx={{
                  cursor: "pointer",
                  fontWeight: 600,
                  fontSize: "0.95rem",
                  lineHeight: 1.2,
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                  color: "primary.main",
                  "&:hover": {
                    textDecoration: "underline",
                  },
                }}
              >
                {vod.title}
              </Typography>
            </CustomWidthTooltip>
          </Box>
          <Box sx={{ mt: "auto" }}>
             <WatchMenu vod={vod} anchorEl={anchorEl} setAnchorEl={setAnchorEl} isCdnAvailable={isCdnAvailable} />
          </Box>
        </Box>
      </Paper>
    </Grid>
  );
}
