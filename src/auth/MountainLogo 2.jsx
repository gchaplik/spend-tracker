import React from "react";
import { T } from "../theme/tokens.jsx";

function MountainLogo({size=56}){
  return(
    <svg viewBox="0 0 80 80" width={size} height={size} style={{display:"block"}}>
      <rect width={80} height={80} rx={16} fill="#111"/>
      <polygon points="6,62 18,44 22,48 28,36 34,44 40,16 46,44 52,36 58,48 62,44 74,62" fill="#fff"/>
      <rect x={6} y={62} width={68} height={4} fill="#fff"/>
    </svg>
  );
}


export { MountainLogo };
