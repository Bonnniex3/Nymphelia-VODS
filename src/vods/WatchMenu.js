import { Menu, Button, Box } from "@mui/material";
import OndemandVideo from "@mui/icons-material/OndemandVideo";

export default function WatchMenu(props) {
  const { vod, anchorEl, setAnchorEl, isCdnAvailable } = props;

  return (
    <Menu anchorEl={anchorEl} keepMounted open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
      <Box sx={{ pl: 1 }}>
        <Box>
          <Button
            color="primary"
            disabled={!isCdnAvailable}
            href={`/cdn/${vod.id}`}
            startIcon={<OndemandVideo />}
            size="large"
            fullWidth
            sx={{ justifyContent: "flex-start" }}
          >
            Internet Archive
          </Button>
        </Box>
      </Box>
    </Menu>
  );
}
