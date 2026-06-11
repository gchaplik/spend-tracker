import React, { useContext } from "react";
import { T, CA } from "../theme/tokens.jsx";
import { fmt } from "./formatters.js";

// ── Discrete Mode ─────────────────────────────────────────────────────────────
// When active, all financial numbers are hidden and shown as relative percentages
const DiscreteModeCtx = React.createContext(false);
// Module-level nfmt: works everywhere without prop drilling
// nfmt(value)         → "●●●"  (standalone, no denominator)
// nfmt(value, total)  → "34%"  (shown as share of total)
const nfmt = (v, total=null) => {
  if(!window.__discreteMode) return fmt(v);
  if(total!=null && total>0) return ((v/total)*100).toFixed(0)+"%";
  return "●●●";
};
// Hook version (for components that need reactivity without re-render)
function useNfmt(){ return nfmt; }

const DISCRETE_MODE_BLOCKED_MESSAGE = "discrete mode is protecting you data please disable to continue";

function DiscreteModeBlockedCard(){
  return (
    <div style={{...CA,padding:"24px 20px",display:"flex",alignItems:"center",justifyContent:"center",textAlign:"center"}}>
      <div style={{maxWidth:360,fontSize:14,fontWeight:600,lineHeight:1.6,color:T.tx1}}>{DISCRETE_MODE_BLOCKED_MESSAGE}</div>
    </div>
  );
}

export { DiscreteModeCtx, nfmt, useNfmt, DISCRETE_MODE_BLOCKED_MESSAGE, DiscreteModeBlockedCard };
