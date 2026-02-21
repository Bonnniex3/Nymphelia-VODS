import { styled, Typography, Box } from "@mui/material";
// import CustomLink from "./CustomLink";
// import xqcL from "../assets/xqcL.png";
// import GitInfo from 'react-git-info/macro';

// const gitInfo = { commit: { shortHash: "dev" } }; // Placeholder since not a git repo

const Footer = styled((props) => (
  <Box {...props}>
    <Box sx={{ mt: 0.5 }}>
      <Typography variant="caption" color="textSecondary">
        {`Minorikyun © ${new Date().getFullYear()}`}
      </Typography>
    </Box>
  </Box>
))`
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
`;

export default Footer;
