import React, { useContext } from "react";

// ── In-depth mode context — lets any component make itself selectable ─────────
const DepthCtx=React.createContext({inDepthMode:false,onSelectItem:()=>{}});

// ── SelectableWrapper ─────────────────────────────────────────────────────────
// Reads from DepthCtx so no prop-drilling needed. Wrap any card/widget with this.
// item: {label, llmContext} — llmContext is the text appended to the Jarvis message.
function SelectableWrapper({item,children}){
  const {inDepthMode,onSelectItem}=React.useContext(DepthCtx);
  if(!inDepthMode) return children;
  return (
    <div
      onClick={e=>{e.stopPropagation();onSelectItem(item);}}
      style={{position:"relative",cursor:"crosshair",outline:"2px dashed #93c5fd",borderRadius:T.rCard,transition:"outline-color .15s",display:"flex",flexDirection:"column"}}
      onMouseEnter={e=>e.currentTarget.style.outlineColor="#0284C7"}
      onMouseLeave={e=>e.currentTarget.style.outlineColor="#93c5fd"}
    >
      {React.cloneElement(children,{style:{...(children.props.style||{}),flex:1}})}
      <div style={{position:"absolute",top:6,right:6,width:20,height:20,borderRadius:"50%",background:"#0284C7",color:"#fff",fontSize:13,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,pointerEvents:"none",zIndex:10,boxShadow:"0 2px 6px rgba(2,132,199,0.45)"}}>+</div>
    </div>
  );
}


export { DepthCtx, SelectableWrapper };
