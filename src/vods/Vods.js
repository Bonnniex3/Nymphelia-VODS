import { useEffect, useState, useMemo, useRef } from "react";
import { Pagination, useMediaQuery, PaginationItem, TextField, InputAdornment } from "@mui/material";
import SimpleBar from "simplebar-react";
// import AdSense from "react-adsense";
import Footer from "../utils/Footer";
import Loading from "../utils/Loading";
import Vod from "./Vod";
import FeaturedHero from "./FeaturedHero";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";
import { LocalizationProvider } from "@mui/x-date-pickers";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import dayjs from "dayjs";
import debounce from "lodash.debounce";
import MOCK_VODS from "./data/vods.json";
import { motion, AnimatePresence } from "framer-motion";
import { Filter as FilterIcon, MonitorPlay, ChevronDown, Search, Tag } from "lucide-react";

const FILTERS = ["Default", "Date", "Title", "Category"];
const PLATFORMS = ["All", "Twitch"];
const CATEGORIES = ["Gaming", "ASMR"];
const START_DATE = process.env.REACT_APP_START_DATE;

const CustomDropdown = ({ value, options, onChange, label, icon: Icon }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative flex-1 w-full min-w-[12rem]" ref={dropdownRef}>
      <div 
        className={`flex items-center justify-between w-full px-4 py-3.5 bg-[#130b0e]/50 border ${isOpen ? 'border-primary' : 'border-pink-500/20'} rounded-xl hover:border-primary/50 transition-all cursor-pointer shadow-inner`}
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-2">
          {Icon && <Icon className="w-5 h-5 text-primary" />}
          <span className="text-gray-400 text-sm font-medium">{label}: <span className="text-gray-100 font-bold ml-1">{value}</span></span>
        </div>
        <ChevronDown className={`w-5 h-5 text-gray-400 transition-transform duration-300 ${isOpen ? "rotate-180 text-primary" : ""}`} />
      </div>
      
      <AnimatePresence>
        {isOpen && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="absolute z-50 w-full mt-2 bg-[#23151a]/95 backdrop-blur-xl border border-pink-500/20 rounded-xl shadow-[0_8px_30px_rgba(244,114,182,0.2)] overflow-hidden"
          >
            {options.map((opt) => (
              <div 
                key={opt}
                className={`px-4 py-3 cursor-pointer transition-colors text-sm flex items-center gap-2 ${value === opt ? "bg-primary/20 text-white font-semibold" : "text-gray-300 hover:bg-white/5 hover:text-white"}`}
                onClick={() => {
                  onChange(opt);
                  setIsOpen(false);
                }}
              >
                <div className={`w-1.5 h-1.5 rounded-full ${value === opt ? "bg-primary shadow-[0_0_8px_rgba(168,85,247,0.8)]" : "bg-transparent"}`} />
                {opt}
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default function Vods() {
  const navigate = useNavigate();
  const location = useLocation();
  const query = new URLSearchParams(location.search);
  const isMobile = useMediaQuery("(max-width: 900px)");
  const [vods, setVods] = useState(null);
  const [totalVods, setTotalVods] = useState(null);
  const [filter, setFilter] = useState(FILTERS[0]);
  const [filterStartDate, setFilterStartDate] = useState(dayjs(START_DATE));
  const [filterEndDate, setFilterEndDate] = useState(dayjs());
  const [filterTitle, setFilterTitle] = useState("");
  const [filterCategory, setFilterCategory] = useState(CATEGORIES[0]);
  const [platform, setPlatform] = useState(PLATFORMS[0]);
  const page = parseInt(query.get("page") || "1", 10);
  const limit = isMobile ? 10 : 20;

  const featuredVod = useMemo(() => MOCK_VODS.find((v) => v.featured) || null, []);
  const archiveVods = useMemo(() => MOCK_VODS.filter((v) => !v.featured), []);
  const isHome = location.pathname === "/";
  const vodsSectionRef = useRef(null);
  const scrollToVods = () => {
    const target = vodsSectionRef.current;
    if (!target) return;
    const scrollEl = target.closest(".simplebar-content-wrapper");
    if (!scrollEl) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const top = scrollEl.scrollTop + target.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top;
    scrollEl.scrollTo({ top, behavior: "smooth" });
  };

  useEffect(() => {
    const fetchVods = async () => {
      // Client-side filtering simulation
      let filtered = [...archiveVods];

      if (filterTitle) {
        filtered = filtered.filter(v => v.title.toLowerCase().includes(filterTitle.toLowerCase()));
      }

      if (filter === "Category") {
        filtered = filtered.filter(v => {
          const isGaming = (v.item_id || "").toUpperCase().includes("GAMING");
          return filterCategory === "Gaming" ? isGaming : !isGaming;
        });
      }

      // Simple pagination
      const start = (page - 1) * limit;
      const end = start + limit;

      setVods(filtered.slice(start, end));
      setTotalVods(filtered.length);
    };
    fetchVods();
  }, [limit, page, filter, filterStartDate, filterEndDate, filterTitle, filterCategory, platform, archiveVods]);

  const changeFilter = (value) => {
    setFilter(value);
    //reset page to 1 when filter changes
    navigate(`${location.pathname}?page=1`);
  };

  const changePlatform = (value) => {
    setPlatform(value);
    //reset page to 1 when platform changes
    navigate(`${location.pathname}?page=1`);
  };

  const handleSubmit = (e) => {
    const value = e.target.value;
    if (e.key === "Enter" && !isNaN(value) && value > 0) {
      navigate(`${location.pathname}?page=${value}`);
    }
  };

  const handleTitleChange = useMemo(
    () =>
      debounce((evt) => {
        setFilterTitle(evt.target.value);
      }, 1000),
    []
  );

  const changeCategory = (value) => {
    setFilterCategory(value);
    //reset page to 1 when category changes
    navigate(`${location.pathname}?page=1`);
  };

  const totalPages = Math.ceil(totalVods / limit);
  const isCdnAvailable = true;

  return (
    <SimpleBar style={{ minHeight: 0, height: "100%" }}>
      {isHome && featuredVod && <FeaturedHero vod={featuredVod} onScrollDown={scrollToVods} />}
      <div className="p-4" ref={vodsSectionRef}>
        <div className="mt-2 text-center">
          {/*
          <ErrorBoundary>
            <AdSense.Google client="ca-pub-8093490837210586" slot="3667265818" style={{ display: "block" }} format="auto" responsive="true" layoutKey="-gw-1+2a-9x+5c" />
          </ErrorBoundary>
          */}
        </div>
        <div className="flex justify-center mt-4 flex-col items-center">
          {totalVods && (
            <h1 className="text-3xl font-bold uppercase text-primary mb-4 tracking-wide">
              {`${totalVods} Vods`}
            </h1>
          )}
        </div>
        <div className="p-4 mb-4 mx-2 md:mx-10 flex flex-col md:flex-row items-center gap-4 rounded-xl bg-[#23151a]/80 backdrop-blur-md border border-pink-500/20 shadow-lg relative z-20">
          <CustomDropdown 
            label="Filter"
            value={filter}
            options={FILTERS}
            onChange={changeFilter}
            icon={FilterIcon}
          />
          {filter === "Date" && (
            <LocalizationProvider dateAdapter={AdapterDayjs}>
              <div className="flex flex-wrap gap-4 flex-1 w-full">
                <DatePicker
                  minDate={dayjs(START_DATE)}
                  maxDate={dayjs()}
                  label="Start Date"
                  defaultValue={filterStartDate}
                  onAccept={(newDate) => setFilterStartDate(newDate)}
                  views={["year", "month", "day"]}
                  sx={{ flex: 1, '& .MuiInputBase-root': { color: '#e5e7eb', backgroundColor: 'rgba(15, 15, 15, 0.5)', borderRadius: '0.75rem' } }}
                />
                <DatePicker
                  minDate={dayjs(START_DATE)}
                  maxDate={dayjs()}
                  label="End Date"
                  defaultValue={filterEndDate}
                  onAccept={(newDate) => setFilterEndDate(newDate)}
                  views={["year", "month", "day"]}
                  sx={{ flex: 1, '& .MuiInputBase-root': { color: '#e5e7eb', backgroundColor: 'rgba(15, 15, 15, 0.5)', borderRadius: '0.75rem' } }}
                />
              </div>
            </LocalizationProvider>
          )}
          {filter === "Title" && (
            <div className="flex-1 w-full relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                placeholder="Search by Title..."
                className="w-full pl-12 pr-4 py-3.5 bg-[#130b0e]/50 border border-pink-500/20 rounded-xl focus:outline-none focus:border-primary/50 text-pink-50 text-sm transition-colors shadow-inner"
                onChange={handleTitleChange}
                onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
                defaultValue={filterTitle}
              />
            </div>
          )}
          {filter === "Category" && (
            <CustomDropdown
              label="Category"
              value={filterCategory}
              options={CATEGORIES}
              onChange={changeCategory}
              icon={Tag}
            />
          )}
          <CustomDropdown 
            label="Platform"
            value={platform}
            options={PLATFORMS}
            onChange={changePlatform}
            icon={MonitorPlay}
          />
        </div>
        {vods ? (
          <motion.div 
            className="mt-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-6 w-full"
            key={page} // Forces re-animation when page changes
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, staggerChildren: 0.05 }}
          >
            <AnimatePresence mode="popLayout">
              {vods.map((vod, _) => (
                <motion.div
                  key={vod.id}
                  layout
                  initial={{ opacity: 0, y: 30, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ 
                    duration: 0.4, 
                    type: "spring", 
                    stiffness: 200, 
                    damping: 20 
                  }}
                >
                  <Vod gridSize={2.1} vod={vod} isMobile={isMobile} isCdnAvailable={isCdnAvailable} />
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        ) : (
          <Loading />
        )}
      </div>
      <div className="flex justify-center mt-4 mb-8 items-center flex-col md:flex-row gap-4">
        {totalPages !== null && (
          <>
            <Pagination
              shape="rounded"
              variant="outlined"
              count={totalPages}
              disabled={totalPages <= 1}
              color="primary"
              page={page}
              siblingCount={isMobile ? 0 : 1}
              boundaryCount={isMobile ? 1 : 1}
              renderItem={(item) => <PaginationItem component={Link} to={`${location.pathname}${item.page === 1 ? "" : `?page=${item.page}`}`} {...item} />}
            />
            <TextField
              inputProps={{ inputMode: "numeric", pattern: "[0-9]*" }}
              InputProps={{
                startAdornment: <InputAdornment position="start">Page</InputAdornment>,
              }}
              sx={{ width: "100px" }}
              size="small"
              type="text"
              onKeyDown={handleSubmit}
            />
          </>
        )}
      </div>
      <Footer />
    </SimpleBar>
  );
}
