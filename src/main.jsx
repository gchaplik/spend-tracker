import React from "react";
import { createRoot } from "react-dom/client";
import App from "./SpendTracker.jsx";

// Catch any unhandled errors before React mounts
window.onerror = (msg, src, line, col, err) => {
  document.body.innerHTML = `<div style="padding:40px;font-family:monospace;color:#dc2626;background:#fff;height:100vh;overflow:auto">
    <div style="font-size:18px;font-weight:700;margin-bottom:16px">⚠ JS Error: ${msg}</div>
    <div style="font-size:12px;color:#555">Source: ${src} line ${line}</div>
    <pre style="font-size:12px;color:#555;margin-top:12px;white-space:pre-wrap">${err?.stack||""}</pre>
  </div>`;
};

class RootErrorBoundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(e) { return { err: e }; }
  render() {
    if (this.state.err) return (
      <div style={{padding:40,fontFamily:"monospace",color:"#dc2626",background:"#fff",height:"100vh",overflow:"auto"}}>
        <div style={{fontSize:18,fontWeight:700,marginBottom:16}}>⚠ React crash: {this.state.err.message}</div>
        <pre style={{fontSize:12,whiteSpace:"pre-wrap",color:"#555"}}>{this.state.err.stack}</pre>
        <button onClick={()=>this.setState({err:null})} style={{marginTop:20,padding:"8px 16px",background:"#111",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontSize:13}}>Retry</button>
      </div>
    );
    return this.props.children;
  }
}

createRoot(document.getElementById("root")).render(
  <RootErrorBoundary>
    <App />
  </RootErrorBoundary>
);
