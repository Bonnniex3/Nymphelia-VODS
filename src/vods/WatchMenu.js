import { Menu, Button, Box } from "@mui/material";
import OndemandVideo from "@mui/icons-material/OndemandVideo";
import { Link } from "react-router-dom";

export default function WatchMenu(props) {
  const { vod, anchorEl, setAnchorEl, isCdnAvailable } = props;

  return (
    <Menu anchorEl={anchorEl} keepMounted open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
      <Box sx={{ pl: 1 }}>
        <Box>
          <Button
            component={Link}
            to={`/cdn/${vod.id}`}
            color="primary"
            disabled={!isCdnAvailable}
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
