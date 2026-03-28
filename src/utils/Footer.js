import { styled, Typography, Box } from "@mui/material";
// import CustomLink from "./CustomLink";
// import xqcL from "../assets/xqcL.png";
// import GitInfo from 'react-git-info/macro';

// const gitInfo = { commit: { shortHash: "dev" } }; // Placeholder since not a git repo

const Footer = styled((props) => (
  <Box {...props}>
    <Box sx={{ mt: 0.5, textAlign: "center" }}>
      <Typography variant="caption" color="textSecondary" display="block">
        {`Nymphelia © ${new Date().getFullYear()}`}
      </Typography>
      <Typography variant="caption" color="textSecondary" display="block" sx={{ mt: 0.5 }}>
        Made with ❤️ by Bonnniex3
      </Typography>
    </Box>
  </Box>
))`
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding-bottom: 1rem;
`;

export default Footer;
