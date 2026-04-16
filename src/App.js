import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { createTheme, ThemeProvider, responsiveFontSizes } from "@mui/material/styles";
import { CssBaseline } from "@mui/material";
import Loading from "./utils/Loading";
import { LocalizationProvider } from "@mui/x-date-pickers";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";

const Vods = lazy(() => import("./vods/Vods"));
const CustomVod = lazy(() => import("./vods/CustomVod"));
const Navbar = lazy(() => import("./navbar/Navbar"));
const NotFound = lazy(() => import("./utils/NotFound"));

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

export default function App() {
  return (
    <ThemeProvider theme={darkTheme}>
      <CssBaseline />
      <BrowserRouter>
        <LocalizationProvider dateAdapter={AdapterDayjs}>
          <div className="absolute inset-0 overflow-hidden flex flex-col bg-[#130b0e] text-pink-50">
            {/* Animated Background Layers */}
            <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
               <div className="bg-blob blob-primary w-[800px] h-[800px] -top-1/4 -left-1/4 rounded-full" />
               <div className="bg-blob blob-secondary w-[600px] h-[600px] top-1/2 -right-1/4 rounded-full" />
               <div className="bg-blob blob-primary w-[700px] h-[700px] -bottom-1/4 left-1/3 rounded-full opacity-40" />
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
                  <Route exact path="/vod/:slug" element={<CustomVod type="cdn" />} />
                </Routes>
              </Suspense>
            </div>
          </div>
        </LocalizationProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}
