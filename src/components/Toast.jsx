import React from "react";
import { T } from "../theme/tokens.jsx";

function Toast({msg,undoFn,onClose}){
  return(
    <div style={{position:"fixed",bottom:24,left:"50%",transform:"translateX(-50%)",zIndex:300,background:"#1E293B",color:"#fff",borderRadius:12,padding:"12px 20px",display:"flex",alignItems:"center",gap:14,boxShadow:"0 8px 32px rgba(15,23,42,0.25)",fontSize:13,fontWeight:500,minWidth:260,maxWidth:420,whiteSpace:"nowrap"}}>
      <span style={{flex:1,overflow:"hidden",textOverflow:"ellipsis"}}>{msg}</span>
      {undoFn&&<button onClick={()=>{undoFn();onClose();}} style={{background:"rgba(255,255,255,0.18)",border:"none",cursor:"pointer",padding:"4px 12px",borderRadius:7,color:"#fff",fontSize:12,fontWeight:600,fontFamily:"inherit",flexShrink:0}}>Undo</button>}
      <button onClick={onClose} style={{background:"none",border:"none",cursor:"pointer",color:"rgba(255,255,255,0.5)",fontSize:16,padding:0,fontFamily:"inherit",lineHeight:1,flexShrink:0}}>×</button>
    </div>
  );
}


export { Toast };
