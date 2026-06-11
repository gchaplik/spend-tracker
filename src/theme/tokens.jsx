import React from "react";

export const T = {
  bg:"#f9f9f9",surface:"#ffffff",overlay:"#f2f2f2",
  border:"#e4e4e4",
  tx1:"#111111",tx2:"#555555",tx3:"#aaaaaa",
  accent:"#111111",accentBg:"#f2f2f2",accentMid:"#888888",
  green:"#059669",greenBg:"#f0fdf4",
  red:"#dc2626",redBg:"#fef2f2",
  amber:"#d97706",amberBg:"#fffbeb",
  shadow:"0 1px 3px rgba(0,0,0,0.07),0 1px 2px rgba(0,0,0,0.04)",
  shadowMd:"0 4px 16px rgba(0,0,0,0.09)",
  r:8,rCard:12,
};

export const IS={width:"100%",padding:"9px 12px",borderRadius:T.r,border:"1px solid "+T.border,fontSize:13,outline:"none",boxSizing:"border-box",fontFamily:"inherit",background:T.surface,color:T.tx1,transition:"border-color 0.15s"};
export const CA={background:T.surface,borderRadius:T.rCard,border:"none",padding:20,boxShadow:T.shadow};

export function Fld({label,children,style}){
  return <div style={{marginBottom:14,...style}}>{label&&<label style={{display:"block",fontSize:11,fontWeight:500,color:T.tx2,marginBottom:5}}>{label}</label>}{children}</div>;
}

export function Btn({children,onClick,v,disabled,full,sm,style}){
  const vv=v||"primary";
  const variants={
    primary:{background:T.accent,color:"#fff",border:"none",boxShadow:"none"},
    secondary:{background:T.overlay,color:T.tx1,border:"1px solid "+T.border,boxShadow:"none"},
    danger:{background:T.redBg,color:T.red,border:"1px solid #fecaca",boxShadow:"none"},
    success:{background:T.greenBg,color:T.green,border:"1px solid #bbf7d0",boxShadow:"none"},
  };
  const s=variants[vv]||variants.primary;
  return <button onClick={onClick} disabled={!!disabled} style={{padding:sm?"5px 12px":"8px 16px",borderRadius:T.r,cursor:disabled?"not-allowed":"pointer",fontSize:sm?12:13,fontWeight:500,opacity:disabled?0.45:1,width:full?"100%":"auto",fontFamily:"inherit",...s,...style}}>{children}</button>;
}
