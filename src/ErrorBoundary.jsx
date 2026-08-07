import { Component } from "react";
import { buildBackup } from "./lib/backup-io.js";

// A render crash used to leave a blank white page (see CLAUDE.md: "A blank page in the app is almost
// always a React crash"). This boundary catches it and shows a recovery screen instead, so a user's
// first instinct isn't "the app ate my fits." Fits live only in this browser's localStorage, so the
// two things that matter here are: (1) let them rescue that data, (2) let them send us the error.
//
// Kept deliberately dependency-light and inline-styled: whatever broke below must not be able to
// break the recovery UI too.

const S = {
  wrap: { minHeight: "100vh", background: "#0e0e10", color: "#e6e6e6", display: "flex",
          alignItems: "center", justifyContent: "center", padding: 20, boxSizing: "border-box",
          fontFamily: "system-ui, -apple-system, sans-serif" },
  card: { width: "100%", maxWidth: 460, background: "#17171a", border: "1px solid #2a2a2e",
          borderRadius: 14, padding: "24px 22px" },
  h: { fontSize: 18, fontWeight: 700, margin: "0 0 8px" },
  p: { fontSize: 13, lineHeight: 1.55, color: "#b7b7bd", margin: "0 0 18px" },
  row: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 },
  btn: (primary) => ({ padding: "10px 15px", borderRadius: 9, fontSize: 13, fontWeight: 700,
          cursor: "pointer", flex: "1 1 auto",
          background: primary ? "#4da3ff" : "#1f1f23", color: primary ? "#0e0e10" : "#d0d0d6",
          border: `1px solid ${primary ? "#4da3ff" : "#33333a"}` }),
  note: { fontSize: 11, color: "#8a8a90", lineHeight: 1.5, marginTop: 4 },
  det: { marginTop: 14, fontSize: 11, color: "#8a8a90" },
  pre: { whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 10.5, color: "#c98b8b",
         background: "#111114", border: "1px solid #2a2a2e", borderRadius: 8, padding: 10,
         maxHeight: 180, overflow: "auto", marginTop: 8, fontFamily: "monospace" },
};

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null, copied: false, saved: false };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    // Surface it in the console too, for anyone with devtools open.
    console.error("Visviva crashed:", error, info?.componentStack);
  }

  report() {
    const { error, info } = this.state;
    const lines = [
      `Visviva error report`,
      `time: ${new Date().toISOString()}`,
      `ua: ${navigator.userAgent}`,
      `url: ${location.href}`,
      ``,
      `${error?.name ?? "Error"}: ${error?.message ?? String(error)}`,
      error?.stack ?? "",
      `--- component stack ---`,
      info?.componentStack ?? "(unavailable)",
    ];
    return lines.join("\n");
  }

  async copyReport() {
    try {
      await navigator.clipboard.writeText(this.report());
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2500);
    } catch {
      this.setState({ copied: false });
    }
  }

  // Same three-way path as BackupPanel.download, and for the same reason: a WKWebView ignores
  // <a download>, so the anchor click silently produced nothing while this reported saved:true.
  // This is the post-crash recovery button, so a false "Fits saved" is the worst possible lie —
  // it is exactly when someone decides it is safe to clear site data.
  async saveFits() {
    const json = buildBackup();
    const name = `visviva-backup-${new Date().toISOString().slice(0, 10)}.json`;
    const done = () => {
      this.setState({ saved: true });
      setTimeout(() => this.setState({ saved: false }), 2500);
    };
    try {
      const file = new File([json], name, { type: "application/json" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "Visviva backup" });
        done();
        return;
      }
    } catch (e) {
      if (e?.name === "AbortError") return;   // user dismissed the sheet
    }
    const a = document.createElement("a");
    if (typeof a.download === "string" && !window.Capacitor?.isNativePlatform?.()) {
      try {
        const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
        a.href = url; a.download = name;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        done();
        return;
      } catch (e) { /* fall through to the clipboard */ }
    }
    navigator.clipboard?.writeText(json).then(done, () => {});
  }

  render() {
    if (!this.state.error) return this.props.children;
    const { error, info, copied, saved } = this.state;
    return (
      <div style={S.wrap}>
        <div style={S.card}>
          <h1 style={S.h}>Something went wrong</h1>
          <p style={S.p}>
            Visviva hit an error and couldn't finish drawing. Your saved fits are still in this
            browser's storage — nothing was deleted. Back them up below before reloading, just in case.
          </p>

          <div style={S.row}>
            <button style={S.btn(true)} onClick={() => this.saveFits()}>
              {saved ? "✓ Fits saved" : "Download my fits"}
            </button>
            <button style={S.btn(false)} onClick={() => window.location.reload()}>
              Reload app
            </button>
          </div>

          <div style={S.row}>
            <button style={S.btn(false)} onClick={() => this.copyReport()}>
              {copied ? "✓ Report copied" : "Copy error report"}
            </button>
          </div>
          <div style={S.note}>
            Copy the error report and send it to the developer so this can be fixed. It contains the
            error message and your device/browser — no fit data.
          </div>

          <details style={S.det}>
            <summary style={{ cursor: "pointer" }}>Technical details</summary>
            <div style={S.pre}>
              {(error?.name ?? "Error") + ": " + (error?.message ?? String(error))}
              {info?.componentStack ? "\n" + info.componentStack : ""}
            </div>
          </details>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
