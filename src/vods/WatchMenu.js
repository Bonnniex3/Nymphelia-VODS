import { Menu, Button, Box } from "@mui/material";
import OndemandVideo from "@mui/icons-material/OndemandVideo";
import { Link } from "react-router-dom";
import { makeSlug } from "../utils/helpers";

export default function WatchMenu(props) {
  const { vod, anchorEl, setAnchorEl, isCdnAvailable } = props;

  return (
    <Menu anchorEl={anchorEl} keepMounted open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)} disableScrollLock>
      <Box sx={{ pl: 1 }}>
        <Box>
          <Button
            component={Link}
            to={`/vod/${makeSlug(vod)}`}
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
