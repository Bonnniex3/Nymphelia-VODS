import { useEffect } from "react";
import { CHANNEL } from "../lib/channel";
import Footer from "../shell/Footer";
import Archive from "./Archive";

export default function ArchivePage() {
  useEffect(() => {
    document.title = `Archive - ${CHANNEL.name} VODs`;
  }, []);

  return (
    <>
      <main className="gutter-x flex-1 pt-8 pb-20">
        <Archive headingAs="h1" />
      </main>
      <Footer />
    </>
  );
}
