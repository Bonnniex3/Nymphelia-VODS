import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { createTheme, ThemeProvider, responsiveFontSizes } from "@mui/material/styles";
import { CssBaseline } from "@mui/material";
import Loading from "./utils/Loading";
import { LocalizationProvider } from "@mui/x-date-pickers";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { motion } from "framer-motion";

const Vods = lazy(() => import("./vods/Vods"));
const YoutubeVod = lazy(() => import("./vods/YoutubeVod"));
const CustomVod = lazy(() => import("./vods/CustomVod"));
const Games = lazy(() => import("./games/Games"));
const Navbar = lazy(() => import("./navbar/Navbar"));
const NotFound = lazy(() => import("./utils/NotFound"));

export default function App() {
  let darkTheme = createTheme({
    palette: {
      mode: "dark",
      background: {
        default: "transparent",
      },
      primary: {
        main: "#a855f7",
      },
      secondary: {
        main: "#ec4899",
      },
    },
    components: {
      MuiDrawer: {
        styleOverrides: {
          paper: {
            color: "white",
            backgroundImage: "none",
            backgroundColor: "rgba(10, 10, 10, 0.95)",
            backdropFilter: "blur(20px)",
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundColor: "rgba(10, 10, 10, 0.6)",
            backdropFilter: "blur(20px)",
            backgroundImage: "none",
            border: "1px solid rgba(255, 255, 255, 0.1)",
            color: "#e5e7eb",
          },
        },
      },
      MuiMenu: {
        styleOverrides: {
          paper: {
            backgroundColor: "rgba(10, 10, 10, 0.95) !important",
            border: "1px solid rgba(255, 255, 255, 0.1)",
          }
        }
      }
    },
  });

  darkTheme = responsiveFontSizes(darkTheme);

  return (
    <ThemeProvider theme={darkTheme}>
      <CssBaseline />
      <BrowserRouter>
        <LocalizationProvider dateAdapter={AdapterDayjs}>
          <div className="absolute inset-0 overflow-hidden flex flex-col bg-dark-900 text-gray-200">
            {/* Animated Background Layers */}
            <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
               <motion.div 
                 className="bg-blob blob-primary w-[800px] h-[800px] -top-1/4 -left-1/4 rounded-full"
                 animate={{ rotate: 360 }}
                 transition={{ duration: 150, repeat: Infinity, ease: "linear" }}
               />
               <motion.div 
                 className="bg-blob blob-secondary w-[600px] h-[600px] top-1/2 -right-1/4 rounded-full"
                 animate={{ rotate: -360 }}
                 transition={{ duration: 120, repeat: Infinity, ease: "linear" }}
               />
               <motion.div 
                 className="bg-blob blob-primary w-[700px] h-[700px] -bottom-1/4 left-1/3 rounded-full opacity-40"
                 animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.6, 0.3] }}
                 transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
               />
            </div>

            {/* Main Content App Context */}
            <div className="relative z-10 flex flex-col h-full w-full">
              <Suspense fallback={<Loading />}>
                <Routes>
                  <Route path="*" element={<NotFound />} />
                  <Route
                    exact
                    path="/"
                    element={
                      <>
                        <Navbar />
                        <Vods />
                      </>
                    }
                  />
                  <Route
                    exact
                    path="/vods"
                    element={
                      <>
                        <Navbar />
                        <Vods />
                      </>
                    }
                  />
                  <Route exact path="/youtube/:vodId" element={<YoutubeVod />} />
                  <Route exact path="/cdn/:collectionId/:vodId" element={<CustomVod type="cdn" />} />
                  <Route exact path="/games/:vodId" element={<Games />} />
                </Routes>
              </Suspense>
            </div>
          </div>
        </LocalizationProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}
