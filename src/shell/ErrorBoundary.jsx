import { Component } from "react";
import { Button } from "../ui/Button";

export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error(error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="grid flex-1 place-items-center p-8 text-center">
        <div>
          <p className="font-dot text-sm text-petal">!! FATAL EXCEPTION 0x0D ♡</p>
          <h1 className="mt-3 font-display text-2xl font-bold">something glitched</h1>
          <p className="mt-2 text-mute">Reload the page to reboot the archive.</p>
          <Button className="mt-6" onClick={() => window.location.reload()}>
            reboot
          </Button>
        </div>
      </div>
    );
  }
}
