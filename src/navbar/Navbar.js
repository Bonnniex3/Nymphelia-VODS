import React from "react";
import Logo from "../assets/logo.png";
import CustomLink from "../utils/CustomLink";
import TwitterIcon from "@mui/icons-material/Twitter";
import SvgIcon from "@mui/material/SvgIcon";
import YouTubeIcon from "@mui/icons-material/YouTube";
import Drawer from "./Drawer";
import OndemandVideoIcon from "@mui/icons-material/OndemandVideo";
import { motion } from "framer-motion";
import { Link as RouterLink } from "react-router-dom";

const socials = [
  {
    path: `https://discord.gg/minorikyun`,
    icon: (
      <SvgIcon viewBox="0 0 71 55" className="text-primary" sx={{ color: '#a855f7' }}>
        <path d="M60.1045 4.8978C55.5792 2.8214 50.7265 1.2916 45.6527 0.41542C45.5603 0.39851 45.468 0.440769 45.4204 0.525289C44.7963 1.6353 44.105 3.0834 43.6209 4.2216C38.1637 3.4046 32.7345 3.4046 27.3892 4.2216C26.905 3.0581 26.1886 1.6353 25.5617 0.525289C25.5141 0.443589 25.4218 0.40133 25.3294 0.41542C20.2584 1.2888 15.4057 2.8186 10.8776 4.8978C10.8384 4.9147 10.8048 4.9429 10.7825 4.9795C1.57795 18.7309 -0.943561 32.1443 0.293408 45.3914C0.299005 45.4562 0.335386 45.5182 0.385761 45.5576C6.45866 50.0174 12.3413 52.7249 18.1147 54.5195C18.2071 54.5477 18.305 54.5139 18.3638 54.4378C19.7295 52.5728 20.9469 50.6063 21.9907 48.5383C22.0523 48.4172 21.9935 48.2735 21.8676 48.2256C19.9366 47.4931 18.0979 46.6 16.3292 45.5858C16.1893 45.5041 16.1781 45.304 16.3068 45.2082C16.679 44.9293 17.0513 44.6391 17.4067 44.3461C17.471 44.2926 17.5606 44.2813 17.6362 44.3151C29.2558 49.6202 41.8354 49.6202 53.3179 44.3151C53.3935 44.2785 53.4831 44.2898 53.5502 44.3433C53.9057 44.6363 54.2779 44.9293 54.6529 45.2082C54.7816 45.304 54.7732 45.5041 54.6333 45.5858C52.8646 46.6197 51.0259 47.4931 49.0921 48.2228C48.9662 48.2707 48.9102 48.4172 48.9718 48.5383C50.038 50.6034 51.2554 52.5699 52.5959 54.435C52.6519 54.5139 52.7526 54.5477 52.845 54.5195C58.6464 52.7249 64.529 50.0174 70.6019 45.5576C70.6551 45.5182 70.6887 45.459 70.6943 45.3942C72.1747 30.0791 68.2147 16.7757 60.1968 4.9823C60.1772 4.9429 60.1437 4.9147 60.1045 4.8978ZM23.7259 37.3253C20.2276 37.3253 17.3451 34.1136 17.3451 30.1693C17.3451 26.225 20.1717 23.0133 23.7259 23.0133C27.308 23.0133 30.1626 26.2532 30.1066 30.1693C30.1066 34.1136 27.28 37.3253 23.7259 37.3253ZM47.3178 37.3253C43.8196 37.3253 40.9371 34.1136 40.9371 30.1693C40.9371 26.225 43.7636 23.0133 47.3178 23.0133C50.9 23.0133 53.7545 26.2532 53.6986 30.1693C53.6986 34.1136 50.9 37.3253 47.3178 37.3253Z" />
      </SvgIcon>
    ),
  },
  {
    path: `https://x.com/minorikyun`,
    icon: <TwitterIcon sx={{ color: '#a855f7' }} />,
  },
  {
    path: `https://www.twitch.tv/minorikyun`,
    icon: (
      <SvgIcon sx={{ color: '#a855f7' }}>
        <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z" />
      </SvgIcon>
    ),
  },
  { path: `https://www.youtube.com/@Minorikyun`, icon: <YouTubeIcon sx={{ color: '#a855f7' }} /> },
];

export default function Navbar() {
  return (
    <nav className="flex-none bg-dark-800/60 backdrop-blur-xl border-b border-white/10 w-full px-4 py-3 sticky top-0 z-50 shadow-lg shadow-black/20">
      <div className="flex items-center justify-between w-full max-w-7xl mx-auto">
        {/* Left side: Logo, Brand, Socials */}
        <div className="flex items-center space-x-3 flex-1">
          <div className="block md:hidden">
            <Drawer socials={socials} />
          </div>
          <motion.div 
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <RouterLink 
              to="/" 
              className="flex items-center gap-3 group"
            >
            <motion.img 
              alt="" 
              className="w-10 h-10 object-contain drop-shadow-[0_0_15px_rgba(168,85,247,0.5)]" 
              src={Logo} 
              animate={{ rotate: [0, 5, -5, 0] }}
              transition={{ repeat: Infinity, duration: 6, ease: "easeInOut" }}
            />
            <span className="hidden sm:block bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent text-xl font-black tracking-wide">
              Minorikyun
            </span>
            </RouterLink>
          </motion.div>
          <div className="hidden md:flex items-center space-x-4 pl-6 ml-4 border-l border-white/10 h-8">
            {socials.map(({ path, icon }) => (
              <motion.div key={path} whileHover={{ scale: 1.2, rotate: 5 }} whileTap={{ scale: 0.9 }}>
                <CustomLink href={path} rel="noopener noreferrer" target="_blank" className="flex items-center opacity-80 hover:opacity-100 hover:drop-shadow-[0_0_8px_rgba(168,85,247,0.8)] transition-all">
                  {icon}
                </CustomLink>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Center/Right side: Links */}
        <div className="hidden md:flex items-center justify-center flex-1">
          <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
            <CustomLink component={RouterLink} to="/vods" className="group relative px-6 py-2 rounded-full overflow-hidden">
              <div className="absolute inset-0 bg-primary/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-full blur-md"></div>
              <div className="relative flex items-center text-gray-200 group-hover:text-white transition-colors">
                <OndemandVideoIcon className="mr-2 text-primary group-hover:text-secondary transition-colors" />
                <span className="text-lg font-bold tracking-wide">Vods Archive</span>
              </div>
            </CustomLink>
          </motion.div>
        </div>

        {/* Right side spacer */}
        <div className="hidden md:flex flex-1 justify-end"></div>
      </div>
    </nav>
  );
}
